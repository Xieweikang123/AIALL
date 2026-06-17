import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  AGENT_AI_MAX_RETRIES,
  chatCompletionWithTools,
  resolveFirstByteTimeoutMs,
  type ChatCompletionMessage,
  type ChatToolCall,
  type ModelStreamProgress,
} from "./aiForward";
import {
  TextToolCallStreamFilter,
  hasTextToolCallMarkup,
  stripTextToolCallMarkup,
  synthesizeToolCallsFromText,
} from "./textToolCalls";
import {
  AGENT_SAFETY_MAX_TURNS,
  buildAgentTurnsLowNudge,
  buildSegmentContinueNudge,
  extendSegmentMaxTurns,
  resolveAgentMaxTurns,
} from "./agentTurnBudget";
import {
  buildExploreBudgetNudge,
  buildExploreSoftCapNudge,
  buildFileBreadthNudge,
  buildForceOutputNudge,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
  MAX_TOTAL_EXPLORE_TURNS,
  MAX_TOTAL_EXPLORE_TURNS_SOFT,
  MAX_UNIQUE_READ_FILES_BEFORE_NUDGE,
  PLAN_EXPLORE_TURN_BUDGET,
} from "./agentExplorationBudget";
import { buildConsultativeBuildHint, isConsultativeUserPrompt } from "./agentUserIntent";
import {
  buildExecutePlanSystemHint,
  buildTargetFileManifest,
  normalizeRunProfile,
  type AgentRunProfileInput,
} from "./agentRunProfile";
import {
  buildProjectContext,
  formatProjectContextForBuild,
  formatProjectContextForPrompt,
  invalidateProjectContextCache,
} from "./vibeProjectContext";
import { formatProjectMemoryForPrompt, readProjectMemory } from "./vibeProjectMemory";
import {
  applyUniquePatch,
  grepInProject,
  listDirectory,
  readFileContent,
  resolveProjectPath,
  searchFiles,
  sliceFileLines,
  writeFileContent,
  type RunExtractOutcome,
} from "./vibeFs";
import { runWebExtract, runWebSearch } from "./webExtract";
import {
  buildModelIdentityHint,
  buildVisionConsultativeContinueHint,
  buildVisionFirstTurnContinueHint,
  buildVisionFirstTurnPrematureCompletionRetryHint,
  buildVisionFirstTurnRetryHint,
  buildVisionUserContent,
  contentCharSize,
  contentDisplayText,
  isAdequateVisionFirstTurnDescription,
  isPrematureVisionCompletionClaim,
  isVisionUnsupportedError,
  sanitizeImageDataUrls,
  shouldRequireVisionFirstTurn,
} from "./visionMessage";

export type VibeAgentEvent =
  | {
      type: "status";
      data: {
        phase: string;
        turn?: number;
        maxTurns?: number;
        openFile?: string;
        model?: string;
        retryAttempt?: number;
        retryMaxAttempts?: number;
        retryError?: string;
        detail?: string;
        contextMessages?: number;
        contextChars?: number;
        streamChars?: number;
        streamChunks?: number;
        toolCallCount?: number;
        elapsedMs?: number;
      };
    }
  | { type: "tool_start"; data: { id: string; name: string; args: Record<string, unknown> } }
  | { type: "tool_end"; data: { id: string; name: string; ok: boolean; summary: string; result?: string } }
  | { type: "message"; data: { text: string } }
  | { type: "message_delta"; data: { delta: string } }
  | { type: "file_diff"; data: { path: string; before: string; after: string; deleted?: boolean; created?: boolean } }
  | {
      type: "agent_context";
      data: {
        mode: VibeChatMode;
        systemPrompt: string;
        history: Array<{ role: string; content: string }>;
        projectContext?: string;
        maxTurns?: number;
        model?: string;
        openFile?: string;
      };
    }
  | {
      type: "turn_trace";
      data: { turn: number; maxTurns?: number; assistantText: string; hasToolCalls: boolean };
    }
  | {
      type: "turn_request";
      data: {
        turn: number;
        maxTurns?: number;
        model?: string;
        contextMessages: number;
        contextChars: number;
        messages: Array<{ role: string; content: string; toolCalls?: string }>;
      };
    }
  | {
      type: "turn_response";
      data: {
        turn: number;
        maxTurns?: number;
        assistantText: string;
        toolCalls: Array<{ id: string; name: string; arguments: string }>;
        hasToolCalls: boolean;
        isFinal: boolean;
      };
    }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: { writtenFiles: string[]; pendingFiles: string[]; turns: number } };

export type VibeChatMode = "ask" | "build" | "plan";

export type VibeChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export interface RunVibeAgentParams {
  projectRoot: string;
  prompt: string;
  history?: VibeChatHistoryMessage[];
  openFilePath?: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  mode?: VibeChatMode;
  maxTurns?: number;
  imageDataUrls?: string[];
  /** Run orchestration profile (interactive vs plan execution). */
  runProfile?: AgentRunProfileInput;
  /** @deprecated Use runProfile.kind === "execute_plan" */
  executionMode?: boolean;
  onEvent: (event: VibeAgentEvent) => void;
  signal?: AbortSignal;
}

const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARS = 120_000;
const MAX_SSE_TEXT_CHARS = 24_000;
const MAX_TOOL_RESULT_SSE_CHARS = 16_000;
const MAX_TOOL_RESULT_MODEL_CHARS = 10_000;
const MAX_AGENT_CONTEXT_CHARS = 200_000;
export const EXECUTE_PLAN_MAX_CONTEXT_CHARS = 100_000;
const PLAN_MAX_CONTEXT_CHARS = 150_000;
const PROTECTED_RECENT_TOOL_RESULTS = 2;

function truncateText(text: string, max: number, suffix: string): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n${suffix.replace("{n}", String(text.length))}`;
}

function truncateForSse(text: string, max = MAX_SSE_TEXT_CHARS): string {
  return truncateText(text, max, "…（已截断，共 {n} 字符）");
}

function truncateToolResultForModel(text: string): string {
  return truncateText(
    text,
    MAX_TOOL_RESULT_MODEL_CHARS,
    "…（内容已截断，共 {n} 字符。如需更多请用 read_file 的 offset/limit 分段读取）",
  );
}

function messageCharSize(message: ChatCompletionMessage): number {
  let size = contentCharSize(message.content);
  if (message.tool_calls?.length) {
    size += JSON.stringify(message.tool_calls).length;
  }
  return size;
}

export function compactMessagesForModel(
  messages: ChatCompletionMessage[],
  maxContextChars = MAX_AGENT_CONTEXT_CHARS,
): ChatCompletionMessage[] {
  const result = messages.map((message) => {
    if (message.role !== "tool" || !message.content) return { ...message };
    return { ...message, content: truncateToolResultForModel(String(message.content)) };
  });

  let total = result.reduce((sum, message) => sum + messageCharSize(message), 0);
  if (total <= maxContextChars) return result;

  const toolIndexes = result
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const compressible = Math.max(0, toolIndexes.length - PROTECTED_RECENT_TOOL_RESULTS);

  for (let ti = 0; ti < compressible; ti += 1) {
    const index = toolIndexes[ti];
    const raw = String(result[index].content || "");
    const lineHint = raw.match(/lines \d+-\d+/)?.[0] || "";
    result[index] = {
      ...result[index],
      content: `（较早的工具输出已压缩${lineHint ? `，${lineHint}` : ""}，约 ${raw.length} 字符）`,
    };
    total = result.reduce((sum, message) => sum + messageCharSize(message), 0);
    if (total <= maxContextChars) break;
  }

  return result;
}

function historyForDisplay(history?: VibeChatHistoryMessage[]): Array<{ role: string; content: string }> {
  return buildHistoryMessages(history).map((m) => ({
    role: m.role,
    content: truncateForSse(String(m.content || ""), 4000),
  }));
}

const TURN_DISPLAY_MESSAGE_CHARS = 2_400;

function messagesForTurnDisplay(messages: ChatCompletionMessage[]): Array<{ role: string; content: string; toolCalls?: string }> {
  return messages.map((message) => {
    const item: { role: string; content: string; toolCalls?: string } = {
      role: message.role,
      content: truncateForSse(contentDisplayText(message.content), TURN_DISPLAY_MESSAGE_CHARS),
    };
    if (message.tool_calls?.length) {
      item.toolCalls = message.tool_calls
        .map((call) => {
          const args = call.function.arguments || "{}";
          const argsPreview = args.length > 600 ? `${args.slice(0, 600)}…` : args;
          return `${call.function.name}(${argsPreview})`;
        })
        .join("\n");
    }
    return item;
  });
}

function emitAgentContext(
  onEvent: RunVibeAgentParams["onEvent"],
  data: Extract<VibeAgentEvent, { type: "agent_context" }>["data"],
) {
  onEvent({
    type: "agent_context",
    data: {
      ...data,
      systemPrompt: truncateForSse(data.systemPrompt),
      projectContext: data.projectContext ? truncateForSse(data.projectContext) : undefined,
    },
  });
}

function buildHistoryMessages(history?: VibeChatHistoryMessage[]): ChatCompletionMessage[] {
  if (!history?.length) return [];

  const trimmed = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES);

  let totalChars = 0;
  const result: ChatCompletionMessage[] = [];
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const item = trimmed[i];
    const len = item.content.length;
    if (totalChars + len > MAX_HISTORY_CHARS && result.length > 0) break;
    totalChars += len;
    result.unshift({ role: item.role, content: item.content });
  }
  return result;
}

function formatCharCount(chars: number): string {
  if (chars >= 10_000) return `${(chars / 10_000).toFixed(1)} 万字符`;
  if (chars >= 1000) return `${(chars / 1000).toFixed(1)}k 字符`;
  return `${chars} 字符`;
}

function formatElapsedMs(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    read_file: "读取文件",
    list_dir: "列出目录",
    grep: "搜索内容",
    search_files: "搜索文件",
    write_file: "写入文件",
    patch_file: "局部修改",
    delete_file: "删除文件",
    web_search: "联网搜索",
    web_extract: "抓取网页",
  };
  return map[name] || name;
}

function streamProgressDetail(progress: ModelStreamProgress): string {
  const elapsed = formatElapsedMs(progress.elapsedMs);
  if (progress.phase === "request_sent") return "正在发送请求…";
  if (progress.phase === "waiting_first_byte") return `等待模型首包 · ${elapsed}`;
  if (progress.phase === "planning_tools") {
    const names = progress.toolNames.map(toolDisplayName).join("、");
    return names
      ? `规划工具：${names}${progress.toolCallCount > progress.toolNames.length ? "…" : ""} · ${elapsed}`
      : `规划工具调用 · ${elapsed}`;
  }
  if (progress.streamChars > 0) {
    return `流式输出 ${progress.streamChars} 字 · ${progress.streamChunks} 包 · ${elapsed}`;
  }
  if (progress.phase === "streaming") {
    return `流式通道已连接 · 等待内容 · ${elapsed}`;
  }
  return `已等待 ${elapsed}`;
}

function streamProgressPhase(progress: ModelStreamProgress): string {
  if (progress.phase === "request_sent") return "sending_request";
  if (progress.phase === "waiting_first_byte") return "waiting_model";
  if (progress.phase === "planning_tools") return "planning_tools";
  if (progress.streamChars > 0) return "streaming_model";
  return "waiting_model";
}

const VIBE_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "列出目录下的文件和子目录。path 为相对项目根的路径，空字符串表示根目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的路径，默认 ''" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文本文件。支持 offset/limit 按行读取大文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
          offset: { type: "number", description: "起始行号，从 1 开始，默认 1" },
          limit: { type: "number", description: "读取行数，默认 500，最大 800" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "在项目内搜索文本（正则或关键词）。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "搜索模式" },
          max_matches: { type: "number", description: "最大匹配数，默认 40" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "按文件名关键词搜索文件。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "文件名关键词" },
          max_results: { type: "number", description: "最大结果数，默认 30" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "写入或覆盖整个文件（Build 模式下立即落盘）。大文件优先用 patch_file。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
          content: { type: "string", description: "完整文件内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "patch_file",
      description:
        "对文件做精确局部替换（old_string 须在文件中唯一匹配）。适合大文件的小改动，比 write_file 更快。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
          old_string: { type: "string", description: "要被替换的原文（须精确匹配且唯一）" },
          new_string: { type: "string", description: "替换后的内容" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "删除文件（Build 模式下立即执行）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对项目根的文件路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "在项目目录中执行 shell 命令（如 npm run dev、python main.py、go test）。返回 stdout 和 stderr。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的 shell 命令" },
          timeout_ms: { type: "number", description: "超时时间（毫秒），默认 30000，最大 120000" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "联网搜索，获取最新信息。返回搜索结果列表（标题、链接、摘要）。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          engine: { type: "string", enum: ["google", "bing", "baidu"], description: "搜索引擎，默认 google" },
          max_results: { type: "number", description: "最大结果数，默认 5，最大 10" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_extract",
      description: "抓取指定 URL 的网页内容，返回标题和正文。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要抓取的网页 URL（http/https）" },
          mode: { type: "string", enum: ["auto", "html", "browser"], description: "抓取模式，默认 auto" },
        },
        required: ["url"],
      },
    },
  },
];

const READ_ONLY_AGENT_TOOLS = VIBE_AGENT_TOOLS.filter((t) =>
  ["list_dir", "read_file", "grep", "search_files", "web_search", "web_extract"].includes(t.function.name),
);

const READ_ONLY_AGENT_TOOL_NAMES = new Set(["list_dir", "read_file", "grep", "search_files", "web_search", "web_extract"]);
const WRITE_AGENT_TOOL_NAMES = new Set(["write_file", "patch_file", "delete_file"]);

const LARGE_FILE_LINE_THRESHOLD = 500;

function requirePriorRead(stage: WriteStage, relative: string, existsOnDisk: boolean): string | null {
  if (!existsOnDisk) return null;
  if (stage.readPaths.has(relative)) return null;
  return `错误：请先 read_file 核对 ${relative} 的真实内容，再修改该文件`;
}

function canParallelizeToolBatch(calls: ChatToolCall[]): boolean {
  if (calls.length <= 1) return false;
  const names = calls.map((call) => call.function.name);
  if (names.every((name) => READ_ONLY_AGENT_TOOL_NAMES.has(name))) return true;
  if (!names.every((name) => WRITE_AGENT_TOOL_NAMES.has(name))) return false;
  const paths = calls.map((call) => String(parseToolArgs(call.function.arguments || "{}").path || "").trim());
  if (!paths.every(Boolean)) return false;
  return new Set(paths).size === paths.length;
}

function buildSystemPrompt(projectRoot: string, openFilePath?: string, model?: string): string {
  const lines = [
    "你是一个专业的编程 Agent（Build 模式），可以调用工具探索并修改本地项目。",
    "回答请使用中文。",
    "用户可能在消息中附带截图或图片；若已附带，请结合图片内容理解需求并回答，不要声称无法查看图片。",
    "用户附截图询问界面/功能时：先描述截图所见，再判断是否属于本项目（优先查 src/views、src/components），勿默认是 GitHub Desktop、VS Code 等外部应用。",
    "用户针对截图局部提问（配色、按钮、某块区域）时：讨论阶段只谈其所指可见范围，勿擅自扩大到整页/全项目样式盘点；若用户明确要求修改，可在该范围内 grep/read 对应组件后 patch_file；用户明确说「整个/整页/全面板」时可按扩大后的范围实施。",
    "若用户仅为提问/解释（如「是什么」「为什么」「点哪里」「怎么工作」）且未明确要求改代码：只读探索后用自然语言回答，禁止 patch_file / write_file / delete_file；需要改代码时请用户明确说明改什么。",
    "用户要求「点击输入框任意位置可输入/聚焦」时：先 read_file 核对父容器（如 chat-input-box）与 contenteditable 子元素的 DOM 层级与命中区域；常见修复为外层 mousedown 转发 focus 或子元素 min-height:100% 填满，勿默认只加 padding。",
    "工作流程：先 grep / search_files 快速定位（通常 1 轮），read_file 读关键片段，然后 patch_file / write_file 修改。",
    "Bug 修复：当用户报告问题（如「点击没反应」「不工作」「没效果」「报错了」等）时，默认理解为「帮我修复」，分析后直接 patch_file / write_file 执行修改，不要停下来问「需要我实施吗？」。",
    "区分问题类型：「按钮跑好远」「位置不对」是布局问题（检查 CSS 定位/flex）；「点击没反应」「不工作」是功能问题（检查事件处理/JS 逻辑）。同一组件在连续消息中被提及时，每条消息是独立问题，不要因为上一条修了布局就假设这一条也是布局问题。",
    "效率：探索不超过 2 轮；在已确认要改代码的任务中，信息足够后必须写入，不要连续多轮只读；同一轮可并行多个 read_file / grep。",
    "用户选择执行：当你提供了多个方案/选项让用户选择时，用户选定后必须立即执行该方案（如 patch_file / write_file 落盘），不得自行改变方向或跳过执行去做其他调查。执行完毕并报告结果后，若需进一步排查再提出下一步建议。",
    "探索时：read_file 用 offset/limit 分段读取（单次约 200 行）；不要重复读取已读过的文件；用中文简短说明后立即调用工具。",
    "修改前必须先 read_file 核对目标文件；patch_file 前 old_string 须与磁盘内容完全一致。",
    "解释项目时：从 package.json、README、入口文件等关键文件入手，不要臆测。",
    "修改代码时：小范围改动优先 patch_file（old_string 须唯一匹配）；全文件重写或新文件才用 write_file；大文件禁止 write_file 整文件覆盖。",
    "需要确认现状时 read_file 用 offset/limit 读相关片段即可，不要读整个大文件。",
    "write_file / patch_file / delete_file 会立即写入磁盘，无需用户确认。",
    "删除文件时：使用 delete_file 工具，不要用 write_file 清空内容来替代删除。",
    "重要：必须通过 API 工具接口调用 list_dir、read_file 等，禁止在正文里输出 <function>、<parameter> 等标记。",
    "工具 path 参数使用相对项目根的路径（如 package.json、src/main.ts），不要用绝对路径。",
    "run_command 可在项目目录执行 shell 命令（如 npm run dev、python main.py、go test），超时默认 30 秒，长时间命令请设置 timeout_ms；不要执行危险命令。",
    "联网搜索：当需要最新信息、外部文档、API 用法时，使用 web_search 搜索；使用 web_extract 抓取指定链接内容。搜索结果可能较多，优先关注前 3 条结果，避免大量内容占用上下文。",
    "如果系统提示你上一次回复被截断，请从截断处继续输出，不要重复已输出的内容。",
    "附截图时：首轮输出截图描述后，后续轮次禁止再次描述同一张截图。若需追问用户意见，应在代码探索后给出具体方案对比，而非仅提问。",
    `项目根目录：${projectRoot}`,
  ];
  if (model?.trim()) {
    lines.push("", buildModelIdentityHint(model));
  }
  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  if (openFile) {
    lines.push(`用户当前打开的文件：${openFile.relative}`);
  }
  return lines.join("\n");
}

function resolveOpenFileInProject(projectRoot: string, openFilePath?: string): { path: string; relative: string } | null {
  if (!openFilePath?.trim()) return null;
  const resolved = resolveProjectPath(projectRoot, openFilePath.trim());
  if (!resolved.ok || !resolved.relative) return null;
  return { path: resolved.path, relative: resolved.relative };
}

function buildAskSystemPrompt(
  projectRoot: string,
  openFilePath?: string,
  openFileSnippet?: string,
  model?: string,
): string {
  const lines = [
    "你是一个编程问答助手（Ask 模式）。",
    "回答请使用中文。",
    "用户可能在消息中附带截图或图片；若已附带，请结合图片内容理解需求并回答，不要声称无法查看图片。",
    "用户附截图询问界面/功能时：先描述截图所见，再判断是否属于本项目（优先查 src/views、src/components），勿默认是外部应用。",
    "用户针对截图局部提问（配色、按钮、某块区域）时：讨论阶段只谈其所指可见范围，勿擅自扩大到整页/全项目样式盘点；若用户明确要求修改，可在该范围内定位源码并说明改法；用户明确说「整个/整页/全面板」时可按扩大后的范围回答。",
    "你可以使用 list_dir、read_file、grep、search_files 工具来探索项目、读取文件，但不能修改任何文件。",
    "你可以使用 web_search 搜索外部信息，使用 web_extract 抓取指定链接内容。",
    "若信息不足，请主动使用工具查找相关内容，而不是要求用户打开文件。",
    "读取文件时：优先 grep / search_files 定位，再用 read_file 的 offset/limit 分段读取（单次约 200 行）；避免连续大块读取同一文件。",
    "收集到足够信息后立即用自然语言回答，不要无意义地继续读文件。",
    `项目根目录：${projectRoot}`,
  ];
  if (model?.trim()) {
    lines.push("", buildModelIdentityHint(model));
  }
  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  if (openFile) {
    lines.push(`用户当前打开的文件：${openFile.relative}`);
    if (openFileSnippet?.trim()) {
      lines.push("", "当前打开文件内容（节选）：", "```", openFileSnippet.trim(), "```");
    }
  }
  return lines.join("\n");
}

function buildPlanSystemPrompt(
  projectRoot: string,
  openFilePath?: string,
  openFileSnippet?: string,
  model?: string,
): string {
  const lines = [
    "你是一个编程架构师（Plan 模式），负责分析项目并输出结构化的修改方案。",
    "回答请使用中文。",
    "用户可能在消息中附带截图或图片；若已附带，请结合图片内容理解需求并回答，不要声称无法查看图片。",
    "用户附截图询问界面/功能时：先描述截图所见，再判断是否属于本项目（优先查 src/views、src/components），勿默认是外部应用。",
    "你可以使用 list_dir、read_file、grep、search_files 工具来探索项目、读取文件，但不能修改任何文件。",
    "你可以使用 web_search 搜索外部信息，使用 web_extract 抓取指定链接内容。",
    "工作流程：先全面探索相关代码，理解现有架构，然后输出结构化的修改方案。",
    "输出格式要求：",
    "1. 先概述需求和当前状态；",
    "2. 列出涉及的文件清单（相对路径）；",
    "3. 对每个文件给出具体改动说明和代码块（标明修改前/修改后或新增内容）；",
    "4. 说明改动顺序和依赖关系。",
    "探索时：read_file 用 offset/limit 分段读取（单次约 200 行）；不要重复读取已读过的文件；用中文简短说明后立即调用工具。",
    "收集到足够信息后立即输出方案，不要无意义地继续读文件。",
    "重要：必须通过 API 工具接口调用 list_dir、read_file 等，禁止在正文里输出 <function>、<parameter> 等标记。",
    "工具 path 参数使用相对项目根的路径（如 package.json、src/main.ts），不要用绝对路径。",
    `项目根目录：${projectRoot}`,
  ];
  if (model?.trim()) {
    lines.push("", buildModelIdentityHint(model));
  }
  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  if (openFile) {
    lines.push(`用户当前打开的文件：${openFile.relative}`);
    if (openFileSnippet?.trim()) {
      lines.push("", "当前打开文件内容（节选）：", "```", openFileSnippet.trim(), "```");
    }
  }
  return lines.join("\n");
}

function buildDoneData(stage: WriteStage | null, turns: number) {
  if (!stage) {
    return { writtenFiles: [] as string[], pendingFiles: [] as string[], turns };
  }
  return {
    writtenFiles: [...stage.writtenList],
    pendingFiles: [] as string[],
    turns,
  };
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolveToolCallsFromAssistant(content: string, apiToolCalls: ChatToolCall[]): ChatToolCall[] {
  if (apiToolCalls.length) return apiToolCalls;
  if (!hasTextToolCallMarkup(content)) return [];
  return synthesizeToolCallsFromText(content);
}

function toolSummary(name: string, result: string): string {
  if (result.startsWith("错误：")) {
    return result.replace(/^错误：/, "").trim();
  }

  if (name === "list_dir") {
    if (result === "（空目录）") return "空目录";
    const lines = result.split("\n").filter(Boolean);
    const dirs = lines.filter((l) => l.startsWith("[dir]")).length;
    const files = lines.filter((l) => l.startsWith("[file]")).length;
    return `${dirs} 个目录，${files} 个文件`;
  }

  if (name === "read_file") {
    const lineCount = result.split("\n").filter((l) => l.length > 0).length;
    return `读取 ${lineCount} 行内容`;
  }

  if (name === "grep") {
    if (result === "（无匹配）") return "未找到匹配";
    const n = result.split("\n").filter(Boolean).length;
    return `找到 ${n} 处匹配`;
  }

  if (name === "search_files") {
    if (result === "（无匹配文件）") return "未找到文件";
    const n = result.split("\n").filter(Boolean).length;
    return `找到 ${n} 个文件`;
  }

  if (name === "write_file") {
    const m = result.match(/已写入\s+(.+?)（(\d+)\s*字符）/);
    if (m) return `已写入 ${m[1]}（${m[2]} 字符）`;
    return result;
  }

  if (name === "patch_file") {
    const m = result.match(/已修改\s+(.+?)（/);
    if (m) return `已修改 ${m[1]}`;
    return result;
  }

  if (name === "delete_file") {
    const m = result.match(/已删除\s+(.+)$/);
    if (m) return `已删除 ${m[1]}`;
    return result;
  }

  if (name === "run_command") {
    if (result.startsWith("错误：") || result.startsWith("命令执行失败")) return `执行失败`;
    const outMatch = result.match(/^stdout:\n(.+)/m);
    const oneLine = (outMatch?.[1] || result).replace(/\s+/g, " ").trim();
    return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine || "执行完成";
  }

  if (name === "web_search") {
    const n = result.split("\n").filter((l) => l.match(/^\d+\./)).length;
    return n > 0 ? `找到 ${n} 条结果` : "搜索完成";
  }

  if (name === "web_extract") {
    const m = result.match(/标题：(.+)/);
    return m ? `抓取「${m[1].slice(0, 30)}」` : "抓取网页";
  }

  const oneLine = result.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

type WriteStage = {
  files: Map<string, string>;
  deletions: Set<string>;
  writtenList: string[];
  readPaths: Set<string>;
};

export function createWriteStage(): WriteStage {
  return { files: new Map(), deletions: new Set(), writtenList: [], readPaths: new Set() };
}

function trackWrittenFile(stage: WriteStage, relative: string) {
  if (!stage.writtenList.includes(relative)) {
    stage.writtenList.push(relative);
  }
}

async function readStagedFileContent(
  root: string,
  relative: string,
  absPath: string,
  stage: WriteStage | null,
): Promise<string | null> {
  if (stage?.files.has(relative)) return stage.files.get(relative)!;
  const result = await readFileContent(absPath).catch(() => null);
  return result?.ok ? result.content : null;
}

export async function executeTool(
  projectRoot: string,
  name: string,
  args: Record<string, unknown>,
  stage: WriteStage | null,
  mode: VibeChatMode = "build",
  readCache?: Map<string, string>,
  readSliceCache?: Map<string, string>,
  grepCache?: Map<string, string>,
): Promise<string> {
  if (mode === "ask" && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return "Ask 模式下不支持文件修改，请仅使用只读工具查询项目。";
  }
  if (mode === "plan" && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return "Plan 模式下不支持文件修改，请仅输出修改方案。";
  }
  if (!stage && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return "错误：当前模式不支持写文件";
  }
  const root = path.resolve(projectRoot);

  if (name === "list_dir") {
    const rel = String(args.path ?? "").trim();
    const resolved = rel ? resolveProjectPath(root, rel) : { ok: true as const, path: root, relative: "" };
    if (!resolved.ok) return `错误：${resolved.error}`;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!stat?.isDirectory()) return `错误：不是目录 ${resolved.relative || "."}`;
    const items = await listDirectory(resolved.path);
    const baseRel = resolved.relative;
    const lines = items.map((item) => {
      const rel = baseRel ? `${baseRel}/${item.name}` : item.name;
      return `${item.isDirectory ? "[dir]" : "[file]"} ${rel}`;
    });
    return lines.length ? lines.join("\n") : "（空目录）";
  }

  if (name === "read_file") {
    const filePath = String(args.path || "").trim();
    if (!filePath) return "错误：缺少 path";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    let content = readCache?.get(resolved.relative) ?? null;
    if (content === null) {
      content = await readStagedFileContent(root, resolved.relative, resolved.path, stage);
      if (content !== null) readCache?.set(resolved.relative, content);
    }
    if (content === null) return `错误：${resolved.relative} 不存在或无法读取`;
    const offset = Number(args.offset) || 1;
    const defaultLimit = mode === "ask" ? 200 : mode === "plan" ? 300 : 200;
    const maxLimit = mode === "ask" ? 400 : mode === "plan" ? 500 : 350;
    const limit = Math.min(maxLimit, Math.max(1, Number(args.limit) || defaultLimit));
    const sliceKey = `${resolved.relative}:${offset}:${limit}`;
    const cachedSlice = readSliceCache?.get(sliceKey);
    if (cachedSlice) {
      return `${cachedSlice}\n（与上次 read_file 相同，已省略重复读取）`;
    }
    const sliced = sliceFileLines(content, offset, limit);
    readSliceCache?.set(sliceKey, sliced);
    stage?.readPaths.add(resolved.relative);
    return sliced;
  }

  if (name === "grep") {
    const pattern = String(args.pattern || "").trim();
    if (!pattern) return "错误：缺少 pattern";
    const maxMatches = Math.min(80, Math.max(1, Number(args.max_matches) || 40));
    const grepKey = `${pattern}:${maxMatches}`;
    const cached = grepCache?.get(grepKey);
    if (cached) {
      return `${cached}\n（与上次 grep 相同，已省略重复搜索）`;
    }
    const result = await grepInProject(root, pattern, maxMatches);
    if (!result.ok) return `错误：${result.error}`;
    if (!result.matches.length) {
      const empty = "（无匹配）";
      grepCache?.set(grepKey, empty);
      return empty;
    }
    const output = result.matches
      .map((m) => `${m.relative}:${m.line}: ${m.text}`)
      .join("\n");
    grepCache?.set(grepKey, output);
    return output;
  }

  if (name === "search_files") {
    const query = String(args.query || "").trim();
    if (!query) return "错误：缺少 query";
    const maxResults = Math.min(50, Math.max(1, Number(args.max_results) || 30));
    const results = await searchFiles(root, query, maxResults);
    if (!results.length) return "（无匹配文件）";
    return results.map((r) => `${r.isDirectory ? "[dir]" : "[file]"} ${r.relative}`).join("\n");
  }

  if (name === "write_file") {
    if (!stage) return "错误：当前模式不支持写文件";
    const filePath = String(args.path || "").trim();
    const content = args.content;
    if (!filePath) return "错误：缺少 path";
    if (typeof content !== "string") return "错误：缺少 content";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    const existsOnDisk = !!stat?.isFile();
    const readErr = requirePriorRead(stage, resolved.relative, existsOnDisk);
    if (readErr) return readErr;
    if (existsOnDisk) {
      const existing =
        stage.files.get(resolved.relative) ??
        readCache?.get(resolved.relative) ??
        (await readFileContent(resolved.path).catch(() => null))?.content ??
        "";
      const existingLines = existing ? existing.split(/\r?\n/).length : 0;
      const newLines = content.split(/\r?\n/).length;
      if (existingLines >= LARGE_FILE_LINE_THRESHOLD || newLines >= LARGE_FILE_LINE_THRESHOLD) {
        return `错误：${resolved.relative} 为大文件（${existingLines || newLines} 行），请用 patch_file 局部修改`;
      }
    }
    stage.deletions.delete(resolved.relative);
    stage.files.set(resolved.relative, content);
    readCache?.set(resolved.relative, content);
    try {
      await writeFileContent(resolved.path, content);
    } catch (error) {
      return `错误：写入 ${resolved.relative} 失败：${error instanceof Error ? error.message : String(error)}`;
    }
    trackWrittenFile(stage, resolved.relative);
    invalidateProjectContextCache(root);
    return `已写入 ${resolved.relative}（${content.length} 字符）`;
  }

  if (name === "patch_file") {
    if (!stage) return "错误：当前模式不支持写文件";
    const filePath = String(args.path || "").trim();
    const oldString = args.old_string;
    const newString = args.new_string;
    if (!filePath) return "错误：缺少 path";
    if (typeof oldString !== "string" || !oldString) return "错误：缺少 old_string";
    if (typeof newString !== "string") return "错误：缺少 new_string";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    const readErr = requirePriorRead(stage, resolved.relative, !!stat?.isFile());
    if (readErr) return readErr;
    let content = stage.files.get(resolved.relative) ?? readCache?.get(resolved.relative) ?? null;
    if (content === null) {
      content = await readStagedFileContent(root, resolved.relative, resolved.path, stage);
      if (content !== null) readCache?.set(resolved.relative, content);
    }
    if (content === null) return `错误：${resolved.relative} 不存在或无法读取`;
    const patchResult = applyUniquePatch(content, oldString, newString);
    if (!patchResult.ok) return patchResult.error;
    const patched = patchResult.patched;
    stage.deletions.delete(resolved.relative);
    stage.files.set(resolved.relative, patched);
    readCache?.set(resolved.relative, patched);
    try {
      await writeFileContent(resolved.path, patched);
    } catch (error) {
      return `错误：写入 ${resolved.relative} 失败：${error instanceof Error ? error.message : String(error)}`;
    }
    trackWrittenFile(stage, resolved.relative);
    invalidateProjectContextCache(root);
    return `已修改 ${resolved.relative}（${oldString.length} → ${newString.length} 字符）`;
  }

  if (name === "delete_file") {
    if (!stage) return "错误：当前模式不支持删除文件";
    const filePath = String(args.path || "").trim();
    if (!filePath) return "错误：缺少 path";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!stat?.isFile()) return `错误：${resolved.relative} 不是文件或不存在`;
    stage.files.delete(resolved.relative);
    stage.deletions.add(resolved.relative);
    readCache?.delete(resolved.relative);
    try {
      await fs.promises.unlink(resolved.path);
    } catch (error) {
      return `错误：删除 ${resolved.relative} 失败：${error instanceof Error ? error.message : String(error)}`;
    }
    trackWrittenFile(stage, resolved.relative);
    invalidateProjectContextCache(root);
    return `已删除 ${resolved.relative}`;
  }

  if (name === "run_command") {
    if (mode === "ask") return "Ask 模式下不支持执行命令。";
    if (mode === "plan") return "Plan 模式下不支持执行命令。";
    const command = String(args.command || "").trim();
    if (!command) return "错误：缺少 command";
    const dangerous = /rm\s+-rf\s+[\/~]|format\s+[a-z]:|del\s+\/[sfq]/i;
    if (dangerous.test(command)) return "错误：禁止执行危险命令";

    const timeoutMs = Math.min(120000, Math.max(5000, Number(args.timeout_ms) || 30000));
    const execFileAsync = promisify(execFile);
    const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    const shellFlag = process.platform === "win32" ? "-Command" : "-c";
    try {
      const { stdout, stderr } = await execFileAsync(shell, [shellFlag, command], {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      const out = String(stdout || "").trim();
      const err = String(stderr || "").trim();
      if (!out && !err) return "（命令执行完成，无输出）";
      const parts: string[] = [];
      if (out) parts.push(`stdout:\n${out}`);
      if (err) parts.push(`stderr:\n${err}`);
      return parts.join("\n\n");
    } catch (error: any) {
      if (error.killed) return `错误：命令超时（${timeoutMs}ms）`;
      const out = String(error.stdout || "").trim();
      const err = String(error.stderr || "").trim();
      const parts: string[] = [];
      if (out) parts.push(`stdout:\n${out}`);
      if (err) parts.push(`stderr:\n${err}`);
      if (error.status !== undefined) parts.push(`exit code: ${error.status}`);
      return parts.length ? `命令执行失败：\n${parts.join("\n\n")}` : `错误：${error.message}`;
    }
  }

  if (name === "web_search") {
    const query = String(args.query || "").trim();
    if (!query) return "错误：缺少 query";
    const engine = String(args.engine || "google").trim();
    const maxResults = Math.min(10, Math.max(1, Number(args.max_results) || 5));
    const result = await runWebSearch(query, engine, maxResults);
    if (!result.ok) return `错误：${result.error}`;
    return result.text || "（无结果）";
  }

  if (name === "web_extract") {
    const url = String(args.url || "").trim();
    if (!url) return "错误：缺少 url";
    if (!/^https?:\/\//.test(url)) return "错误：url 必须以 http:// 或 https:// 开头";
    const mode = String(args.mode || "auto").trim();
    const outcome = await runWebExtract({ url, mode }, () => {});
    const payload = outcome.payload as Record<string, unknown>;
    if (!payload.ok) {
      return `错误：${payload.error || "抓取失败"}`;
    }
    const title = String(payload.title || "无标题");
    const text = String(payload.text || "").slice(0, 120000);
    return `网页抓取成功\n标题：${title}\n正文：\n${text}`;
  }

  return `错误：未知工具 ${name}`;
}

export async function runVibeAgent(params: RunVibeAgentParams): Promise<void> {
  const mode = params.mode ?? "build";
  const isAsk = mode === "ask";
  const isPlan = mode === "plan";
  const runProfile = normalizeRunProfile(
    params.runProfile ||
      (params.executionMode
        ? { kind: "execute_plan", targetFiles: params.runProfile?.targetFiles }
        : undefined),
  );
  const isExecutePlan = !isAsk && !isPlan && runProfile.kind === "execute_plan";
  const {
    projectRoot,
    prompt,
    openFilePath,
    endpoint,
    apiKey,
    model,
    onEvent,
    signal,
  } = params;
  const readOnlyBuildRun = !isAsk && !isPlan && !isExecutePlan && isConsultativeUserPrompt(prompt);
  const imageDataUrls = sanitizeImageDataUrls(params.imageDataUrls);

  const segmentBudget = resolveAgentMaxTurns(mode, runProfile);
  let segmentMaxTurns = params.maxTurns ?? segmentBudget;
  let segmentIndex = 1;
  const exploreTurnBudget = isExecutePlan ? EXECUTE_PLAN_EXPLORE_TURN_BUDGET : isPlan ? PLAN_EXPLORE_TURN_BUDGET : INTERACTIVE_EXPLORE_TURN_BUDGET;
  const maxContextChars = isExecutePlan ? EXECUTE_PLAN_MAX_CONTEXT_CHARS : isPlan ? PLAN_MAX_CONTEXT_CHARS : MAX_AGENT_CONTEXT_CHARS;

  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  const openFileRel = openFile?.relative;

  onEvent({
    type: "status",
    data: {
      phase: "preparing",
      ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
      model,
      ...(openFileRel ? { openFile: openFileRel } : {}),
    },
  });

  const targetManifest = isExecutePlan
    ? await buildTargetFileManifest(projectRoot, runProfile.targetFiles || [])
    : [];
  let openFileSnippet = "";
  if (!isExecutePlan && openFile) {
    onEvent({
      type: "status",
      data: {
        phase: "building_context",
        model,
        detail: openFileRel ? `读取当前文件 ${openFileRel}…` : "扫描项目结构与关键文件…",
        ...(openFileRel ? { openFile: openFileRel } : {}),
      },
    });
    const result = await readFileContent(openFile.path).catch(() => null);
    if (result?.ok) {
      openFileSnippet = sliceFileLines(result.content, 1, 400);
    }
  } else if (!isExecutePlan) {
    onEvent({
      type: "status",
      data: {
        phase: "building_context",
        model,
        detail: "扫描项目结构与关键文件…",
      },
    });
  }

  let projectContextBlock = "";
  if (isExecutePlan) {
    projectContextBlock = `\n\n项目根：${projectRoot}（方案执行阶段，已跳过全项目扫描）`;
    projectContextBlock += buildExecutePlanSystemHint(targetManifest, runProfile.userIntent);
  } else {
    const projectContext = await buildProjectContext(projectRoot);
    if (projectContext.ok) {
      projectContextBlock = isAsk
        ? formatProjectContextForPrompt(projectContext)
        : formatProjectContextForBuild(projectContext);
    }
  }

  const projectMemoryResult = await readProjectMemory(projectRoot);
  const projectMemoryBlock =
    projectMemoryResult.ok && projectMemoryResult.content.trim()
      ? formatProjectMemoryForPrompt(projectMemoryResult.content, projectMemoryResult.truncated)
      : "";

  const systemPrompt =
    (isAsk
      ? buildAskSystemPrompt(projectRoot, openFilePath, openFileSnippet, model)
      : isPlan
      ? buildPlanSystemPrompt(projectRoot, openFilePath, openFileSnippet, model)
      : buildSystemPrompt(projectRoot, openFilePath, model) +
        (readOnlyBuildRun ? buildConsultativeBuildHint() : "")) +
    projectContextBlock +
    projectMemoryBlock;

  const writeStage = isAsk || isPlan || readOnlyBuildRun ? null : createWriteStage();
  const readCache = new Map<string, string>();
  const readSliceCache = new Map<string, string>();
  const grepCache = new Map<string, string>();
  let consecutiveExploreTurns = 0;
  let totalExploreTurns = 0;
  let turnsLowNudgeSent = false;
  /** Track unique files read in explore-only turns to detect breadth sprawl. */
  const exploreFilesRead = new Set<string>();
  let fileBreadthNudgeSent = false;
  const activeTools = isAsk || isPlan || readOnlyBuildRun ? READ_ONLY_AGENT_TOOLS : VIBE_AGENT_TOOLS;
  const userContent = buildVisionUserContent(prompt, imageDataUrls);
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: systemPrompt },
    ...buildHistoryMessages(params.history),
    { role: "user", content: userContent },
  ];
  let visionFallbackApplied = false;
  let visionFirstTurnPending = shouldRequireVisionFirstTurn(imageDataUrls.length, false);
  let visionFirstTurnRetries = 0;
  const MAX_VISION_FIRST_TURN_RETRIES = 2;
  let truncationRetried = false;
  const consultativeVisionRun = imageDataUrls.length > 0 && (isAsk || readOnlyBuildRun);

  emitAgentContext(onEvent, {
    mode,
    systemPrompt,
    history: historyForDisplay(params.history),
    projectContext: [projectContextBlock, projectMemoryBlock].filter(Boolean).join("") || undefined,
    ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
    model,
    ...(openFileRel ? { openFile: openFileRel } : {}),
  });

  if (signal?.aborted) {
    onEvent({ type: "status", data: { phase: "aborted" } });
    onEvent({ type: "done", data: buildDoneData(writeStage, 0) });
    return;
  }

  for (let turn = 1; ; turn += 1) {
    if (turn > AGENT_SAFETY_MAX_TURNS) {
      onEvent({
        type: "status",
        data: { phase: "finished", turn: AGENT_SAFETY_MAX_TURNS, maxTurns: AGENT_SAFETY_MAX_TURNS },
      });
      onEvent({
        type: "error",
        data: { message: `已达安全上限（${AGENT_SAFETY_MAX_TURNS} 轮），任务可能未完成。` },
      });
      onEvent({ type: "done", data: buildDoneData(writeStage, AGENT_SAFETY_MAX_TURNS) });
      return;
    }

    if (signal?.aborted) {
      onEvent({
        type: "status",
        data: {
          phase: "aborted",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        },
      });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn - 1) });
      return;
    }

    if (
      !isAsk &&
      !readOnlyBuildRun &&
      segmentMaxTurns !== undefined &&
      !turnsLowNudgeSent &&
      turn >= segmentMaxTurns - 3
    ) {
      messages.push({ role: "system", content: buildAgentTurnsLowNudge(turn, segmentMaxTurns, mode) });
      turnsLowNudgeSent = true;
    }

    // Progressive exploration restriction:
    //   Soft cap (6): strip grep/search_files — model can still read_file
    //   Hard cap (10): strip ALL tools — model must output text only
    const forceTextOutput = !isAsk && !readOnlyBuildRun && totalExploreTurns >= MAX_TOTAL_EXPLORE_TURNS;
    const stripWideSearch = !forceTextOutput && !isAsk && !readOnlyBuildRun && totalExploreTurns >= MAX_TOTAL_EXPLORE_TURNS_SOFT;

    if (forceTextOutput) {
      messages.push({ role: "system", content: buildForceOutputNudge(totalExploreTurns, mode) });
    } else if (stripWideSearch) {
      messages.push({ role: "system", content: buildExploreSoftCapNudge(totalExploreTurns, mode) });
    }

    if (!fileBreadthNudgeSent && exploreFilesRead.size >= MAX_UNIQUE_READ_FILES_BEFORE_NUDGE) {
      const files = Array.from(exploreFilesRead);
      messages.push({ role: "system", content: buildFileBreadthNudge(files, mode) });
      fileBreadthNudgeSent = true;
    }

    onEvent({
      type: "status",
      data: {
        phase: visionFirstTurnPending ? "vision_first_turn" : "waiting_model",
        turn,
        ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        model,
        ...(visionFirstTurnPending
          ? { detail: "先查看附图并描述所见（本轮不调用工具）" }
          : {}),
      },
    });

    const toolsForTurn = (() => {
      if (visionFirstTurnPending || forceTextOutput) return [];
      if (stripWideSearch) {
        // Keep only read_file (and list_dir); remove grep / search_files / run_command / web_*
        return activeTools.filter(
          (t) => !["grep", "search_files", "run_command", "web_search", "web_extract"].includes(t.function.name),
        );
      }
      return activeTools;
    })();

    let streamedChars = 0;
    const streamFilter = new TextToolCallStreamFilter();
    let modelStatusPhase: "waiting_model" | "retrying_model" | "sending_request" | "streaming_model" | "planning_tools" =
      "waiting_model";
    const modelWaitStartedAt = Date.now();
    const heartbeat = setInterval(() => {
      if (signal?.aborted) return;
      if (modelStatusPhase === "streaming_model" || modelStatusPhase === "planning_tools") return;
      onEvent({
        type: "status",
        data: {
          phase: modelStatusPhase,
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          model,
          detail: `已等待 ${formatElapsedMs(Date.now() - modelWaitStartedAt)}`,
          elapsedMs: Date.now() - modelWaitStartedAt,
        },
      });
    }, 2000);
    const compactedMessages = compactMessagesForModel(messages, maxContextChars);
    const contextChars = compactedMessages.reduce((sum, message) => sum + messageCharSize(message), 0);
    onEvent({
      type: "status",
      data: {
        phase: "compacting_context",
        turn,
        ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        model,
        detail: `${compactedMessages.length} 条消息 · ${formatCharCount(contextChars)} 上下文`,
        contextMessages: compactedMessages.length,
        contextChars,
      },
    });
    onEvent({
      type: "turn_request",
      data: {
        turn,
        ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        model,
        contextMessages: compactedMessages.length,
        contextChars,
        messages: messagesForTurnDisplay(compactedMessages),
      },
    });
    let completion: Awaited<ReturnType<typeof chatCompletionWithTools>>;
    try {
      completion = await chatCompletionWithTools({
        endpoint,
        apiKey,
        model,
        messages: compactedMessages,
        tools: toolsForTurn,
        signal,
        maxRetries: AGENT_AI_MAX_RETRIES,
        firstByteTimeoutMs: resolveFirstByteTimeoutMs(contextChars),
        onStreamProgress: (progress) => {
          modelStatusPhase = streamProgressPhase(progress) as typeof modelStatusPhase;
          onEvent({
            type: "status",
            data: {
              phase: modelStatusPhase,
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
              detail: streamProgressDetail(progress),
              streamChars: progress.streamChars,
              streamChunks: progress.streamChunks,
              toolCallCount: progress.toolCallCount,
              elapsedMs: progress.elapsedMs,
              contextMessages: compactedMessages.length,
              contextChars,
            },
          });
        },
        onContentDelta: (delta) => {
          const userDelta = streamFilter.push(delta);
          if (userDelta) {
            streamedChars += userDelta.length;
            onEvent({ type: "message_delta", data: { delta: userDelta } });
          }
        },
        onAttemptStart: () => {
          modelStatusPhase = "waiting_model";
          onEvent({
            type: "status",
            data: {
              phase: "waiting_model",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
            },
          });
        },
        onRetry: ({ attempt, maxAttempts, error }) => {
          modelStatusPhase = "retrying_model";
          onEvent({
            type: "status",
            data: {
              phase: "retrying_model",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
              retryAttempt: attempt,
              retryMaxAttempts: maxAttempts,
              retryError: error,
            },
          });
        },
      });
    } finally {
      clearInterval(heartbeat);
    }

    if (!completion.ok || !completion.message) {
      if (
        !visionFallbackApplied &&
        imageDataUrls.length > 0 &&
        isVisionUnsupportedError(completion.error)
      ) {
        visionFallbackApplied = true;
        visionFirstTurnPending = false;
        const userIndex = messages.findIndex((message) => message.role === "user");
        if (userIndex >= 0) {
          messages[userIndex] = {
            role: "user",
            content: `${prompt}\n\n（注：当前模型不支持图片输入，已忽略 ${imageDataUrls.length} 张附带图片，请仅根据文字继续。）`,
          };
        }
        onEvent({
          type: "status",
          data: {
            phase: "vision_fallback",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "当前模型不支持视觉输入，已降级为纯文本请求",
          },
        });
        turn -= 1;
        continue;
      }
      onEvent({ type: "error", data: { message: completion.error || "模型请求失败" } });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn) });
      return;
    }

    // --- 检测模型输出被截断（finish_reason === "length"）---
    if (
      completion.finish_reason === "length" &&
      !completion.message.tool_calls?.length &&
      !truncationRetried
    ) {
      truncationRetried = true;
      onEvent({
        type: "status",
        data: {
          phase: "streaming_model",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          model,
          detail: "模型输出被截断（达到 token 上限），正在重试…",
        },
      });
      // 将已截断的内容作为 assistant 消息推入上下文，让模型继续
      const truncatedText = String(completion.message.content || "");
      if (truncatedText.trim()) {
        messages.push({ role: "assistant", content: truncatedText });
        messages.push({
          role: "user",
          content:
            "你的上一次回复被截断了（达到输出 token 上限）。请从被截断的地方继续，不要重复已输出的内容。",
        });
      }
      continue;
    }

    const assistant = completion.message;
    const rawContent = String(assistant.content || "");
    const toolCalls = resolveToolCallsFromAssistant(rawContent, assistant.tool_calls || []);
    const visibleContent = stripTextToolCallMarkup(rawContent);

    const completeVisionFirstTurn = (text: string, isFinalTurn: boolean) => {
      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          assistantText: text,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: isFinalTurn,
        },
      });
      if (text && !streamedChars) {
        onEvent({ type: "message", data: { text } });
      }
      messages.push({ role: "assistant", content: text });
    };

    if (visionFirstTurnPending) {
      const text = visibleContent.trim();
      if (toolCalls.length) {
        onEvent({
          type: "turn_trace",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: text || "（模型试图在附图首轮调用工具，已忽略）",
            hasToolCalls: false,
          },
        });
      }
      if (!isAdequateVisionFirstTurnDescription(text)) {
        visionFirstTurnRetries += 1;
        if (text) {
          messages.push({ role: "assistant", content: text });
        }
        if (visionFirstTurnRetries > MAX_VISION_FIRST_TURN_RETRIES) {
          visionFirstTurnPending = false;
          messages.push({
            role: "system",
            content:
              "【读图轮次结束】模型未能充分描述附图，已跳过强制读图轮次。请结合用户文字与附图继续完成任务。",
          });
          onEvent({
            type: "status",
            data: {
              phase: "vision_first_turn_skipped",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
            },
          });
          continue;
        }
        messages.push({
          role: "system",
          content: isPrematureVisionCompletionClaim(text)
            ? buildVisionFirstTurnPrematureCompletionRetryHint()
            : buildVisionFirstTurnRetryHint(),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: text,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        if (text && !streamedChars) {
          onEvent({ type: "message", data: { text } });
        }
        continue;
      }

      visionFirstTurnPending = false;
      completeVisionFirstTurn(text, false);
      if (consultativeVisionRun) {
        messages.push({ role: "system", content: buildVisionConsultativeContinueHint() });
        if (segmentMaxTurns !== undefined) {
          segmentMaxTurns = Math.min(segmentMaxTurns, turn + 4);
        }
      } else {
        messages.push({ role: "system", content: buildVisionFirstTurnContinueHint() });
      }
      onEvent({
        type: "status",
        data: {
          phase: "vision_first_turn_done",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          model,
          detail: consultativeVisionRun ? "读图描述完成，准备简要核对后回答" : "读图描述完成，开始定位与修改",
        },
      });
      continue;
    }

    if (!toolCalls.length) {
      const text = visibleContent.trim();
      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          assistantText: text,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: true,
        },
      });
      if (text && !streamedChars) {
        onEvent({ type: "message", data: { text } });
      }
      onEvent({
        type: "status",
        data: {
          phase: "finished",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        },
      });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn) });
      return;
    }

    if (visibleContent.trim()) {
      onEvent({
        type: "turn_trace",
        data: {
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          assistantText: visibleContent.trim(),
          hasToolCalls: true,
        },
      });
    }

    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        assistantText: visibleContent.trim(),
        toolCalls: toolCalls.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments || "{}",
        })),
        hasToolCalls: true,
        isFinal: false,
      },
    });

    messages.push({
      role: "assistant",
      content: visibleContent || null,
      tool_calls: toolCalls,
    });

    type ToolOutcome = {
      call: ChatToolCall;
      result: string;
      pendingDiff: Extract<VibeAgentEvent, { type: "file_diff" }> | null;
    };

    const runToolCall = async (call: ChatToolCall): Promise<ToolOutcome> => {
      const toolName = call.function.name;
      const toolArgs = parseToolArgs(call.function.arguments || "{}");

      let pendingDiff: Extract<VibeAgentEvent, { type: "file_diff" }> | null = null;
      if (writeStage && WRITE_AGENT_TOOL_NAMES.has(toolName)) {
        const filePath = String(toolArgs.path || "").trim();
        if (filePath) {
          const resolved = resolveProjectPath(projectRoot, filePath);
          if (resolved.ok) {
            const staged = await readStagedFileContent(
              projectRoot,
              resolved.relative,
              resolved.path,
              writeStage,
            );
            const before = staged ?? "";
            let after = before;
            if (toolName === "delete_file") {
              after = "";
            } else if (toolName === "write_file") {
              after = String(toolArgs.content ?? "");
            } else if (toolName === "patch_file") {
              const oldString = String(toolArgs.old_string ?? "");
              const newString = String(toolArgs.new_string ?? "");
              if (oldString) {
                const patchPreview = applyUniquePatch(before, oldString, newString);
                if (patchPreview.ok) after = patchPreview.patched;
              }
            }
            pendingDiff = {
              type: "file_diff",
              data: {
                path: resolved.relative,
                before,
                after,
                deleted: toolName === "delete_file",
                created: toolName === "write_file" && staged === null,
              },
            };
          }
        }
      }

      let result = "";
      try {
        result = await executeTool(projectRoot, toolName, toolArgs, writeStage, mode, readCache, readSliceCache, grepCache);
      } catch (error) {
        result = `错误：${error instanceof Error ? error.message : String(error)}`;
      }

      return { call, result, pendingDiff };
    };

    const emitToolOutcome = (outcome: ToolOutcome) => {
      const toolName = outcome.call.function.name;
      if (outcome.pendingDiff && !outcome.result.startsWith("错误：")) {
        onEvent(outcome.pendingDiff);
      }
      onEvent({
        type: "tool_end",
        data: {
          id: outcome.call.id,
          name: toolName,
          ok: !outcome.result.startsWith("错误："),
          summary: toolSummary(toolName, outcome.result),
          result: truncateForSse(outcome.result, MAX_TOOL_RESULT_SSE_CHARS),
        },
      });
      messages.push({
        role: "tool",
        tool_call_id: outcome.call.id,
        content: truncateToolResultForModel(outcome.result),
      });
    };

    for (let index = 0; index < toolCalls.length; ) {
      if (signal?.aborted) break;

      let end = index + 1;
      while (end < toolCalls.length && canParallelizeToolBatch(toolCalls.slice(index, end + 1))) {
        end += 1;
      }

      const batch = toolCalls.slice(index, end);
      const canParallel = canParallelizeToolBatch(batch);
      for (const call of batch) {
        onEvent({
          type: "tool_start",
          data: { id: call.id, name: call.function.name, args: parseToolArgs(call.function.arguments || "{}") },
        });
      }

      if (canParallel && batch.length > 1) {
        const outcomes = await Promise.all(batch.map((call) => runToolCall(call)));
        for (const outcome of outcomes) emitToolOutcome(outcome);
      } else {
        for (const call of batch) {
          const outcome = await runToolCall(call);
          emitToolOutcome(outcome);
        }
      }

      index = end;
    }

    const turnHadWrite = toolCalls.some((call) => WRITE_AGENT_TOOL_NAMES.has(call.function.name));
    const turnExploreOnly =
      toolCalls.length > 0 && toolCalls.every((call) => READ_ONLY_AGENT_TOOL_NAMES.has(call.function.name));
    if (turnHadWrite) {
      consecutiveExploreTurns = 0;
      // Reset file-breadth tracking when the model finally writes (it found the target).
      exploreFilesRead.clear();
      fileBreadthNudgeSent = false;
    } else if (turnExploreOnly) {
      consecutiveExploreTurns += 1;
      totalExploreTurns += 1;
      // Track which files were read this turn for breadth monitoring.
      for (const call of toolCalls) {
        if (call.function.name === "read_file") {
          try {
            const args = JSON.parse(call.function.arguments || "{}");
            if (args.path) exploreFilesRead.add(String(args.path));
          } catch { /* ignore parse errors */ }
        }
      }
    }
    if (!isAsk && !readOnlyBuildRun && consecutiveExploreTurns >= exploreTurnBudget) {
      messages.push({ role: "system", content: buildExploreBudgetNudge(consecutiveExploreTurns, mode) });
      consecutiveExploreTurns = 0;
    }

    if (segmentMaxTurns !== undefined && turn >= segmentMaxTurns) {
      if (turn >= AGENT_SAFETY_MAX_TURNS) {
        onEvent({
          type: "status",
          data: { phase: "finished", turn, maxTurns: AGENT_SAFETY_MAX_TURNS },
        });
        if (!isAsk) {
          onEvent({
            type: "error",
            data: { message: `已达安全上限（${AGENT_SAFETY_MAX_TURNS} 轮），任务可能未完成。` },
          });
        }
        onEvent({ type: "done", data: buildDoneData(writeStage, turn) });
        return;
      }

      segmentIndex += 1;
      segmentMaxTurns = extendSegmentMaxTurns(turn, segmentBudget);
      turnsLowNudgeSent = false;
      if (!readOnlyBuildRun) {
        messages.push({ role: "system", content: buildSegmentContinueNudge(turn, segmentIndex, mode) });
      }
      onEvent({
        type: "status",
        data: {
          phase: "continuing",
          turn,
          maxTurns: segmentMaxTurns,
          detail: `自动续跑第 ${segmentIndex} 段（累计 ${turn} 轮）…`,
        },
      });
    }
  }
}
