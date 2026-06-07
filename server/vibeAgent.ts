import fs from "node:fs";
import path from "node:path";
import { chatCompletionWithTools, type ChatCompletionMessage, type ChatToolCall, type ModelStreamProgress } from "./aiForward";
import {
  TextToolCallStreamFilter,
  hasTextToolCallMarkup,
  stripTextToolCallMarkup,
  synthesizeToolCallsFromText,
} from "./textToolCalls";
import { AGENT_SAFETY_MAX_TURNS } from "./agentTurnBudget";
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
import {
  grepInProject,
  listDirectory,
  readFileContent,
  resolveProjectPath,
  searchFiles,
  sliceFileLines,
  writeFileContent,
} from "./vibeFs";

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

export type VibeChatMode = "ask" | "build";

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
  let size = String(message.content || "").length;
  if (message.tool_calls?.length) {
    size += JSON.stringify(message.tool_calls).length;
  }
  return size;
}

export function compactMessagesForModel(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
  const result = messages.map((message) => {
    if (message.role !== "tool" || !message.content) return { ...message };
    return { ...message, content: truncateToolResultForModel(String(message.content)) };
  });

  let total = result.reduce((sum, message) => sum + messageCharSize(message), 0);
  if (total <= MAX_AGENT_CONTEXT_CHARS) return result;

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
    if (total <= MAX_AGENT_CONTEXT_CHARS) break;
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
      content: truncateForSse(String(message.content || ""), TURN_DISPLAY_MESSAGE_CHARS),
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
];

const READ_ONLY_AGENT_TOOLS = VIBE_AGENT_TOOLS.filter((t) =>
  ["list_dir", "read_file", "grep", "search_files"].includes(t.function.name),
);

const READ_ONLY_AGENT_TOOL_NAMES = new Set(["list_dir", "read_file", "grep", "search_files"]);
const WRITE_AGENT_TOOL_NAMES = new Set(["write_file", "patch_file", "delete_file"]);

function canParallelizeToolBatch(calls: ChatToolCall[]): boolean {
  if (calls.length <= 1) return false;
  const names = calls.map((call) => call.function.name);
  if (names.every((name) => READ_ONLY_AGENT_TOOL_NAMES.has(name))) return true;
  if (!names.every((name) => WRITE_AGENT_TOOL_NAMES.has(name))) return false;
  const paths = calls.map((call) => String(parseToolArgs(call.function.arguments || "{}").path || "").trim());
  if (!paths.every(Boolean)) return false;
  return new Set(paths).size === paths.length;
}

function buildSystemPrompt(projectRoot: string, openFilePath?: string): string {
  const lines = [
    "你是一个专业的编程 Agent（Build 模式），可以调用工具探索并修改本地项目。",
    "回答请使用中文。",
    "工作流程：先 list_dir / grep / search_files 定位，再按需 read_file 读取关键片段，最后 write_file / delete_file 修改。",
    "探索时：优先 grep / search_files 缩小范围，read_file 用 offset/limit 分段读取（单次约 200 行）；不要重复读取已读过的文件；信息足够后立即进入修改或回答，避免无意义地连续读文件。",
    "解释项目时：从 package.json、README、入口文件等关键文件入手，不要臆测。",
    "修改代码时：小范围改动优先 patch_file（old_string 须唯一匹配）；全文件重写或新文件才用 write_file；大文件禁止 write_file 整文件覆盖。",
    "需要确认现状时 read_file 用 offset/limit 读相关片段即可，不要读整个大文件。",
    "write_file / patch_file / delete_file 会立即写入磁盘，无需用户确认。",
    "删除文件时：使用 delete_file 工具，不要用 write_file 清空内容来替代删除。",
    "重要：必须通过 API 工具接口调用 list_dir、read_file 等，禁止在正文里输出 <function>、<parameter> 等标记。",
    "工具 path 参数使用相对项目根的路径（如 package.json、src/main.ts），不要用绝对路径。",
    `项目根目录：${projectRoot}`,
  ];
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
): string {
  const lines = [
    "你是一个编程问答助手（Ask 模式）。",
    "回答请使用中文。",
    "你可以使用 list_dir、read_file、grep、search_files 工具来探索项目、读取文件，但不能修改任何文件。",
    "若信息不足，请主动使用工具查找相关内容，而不是要求用户打开文件。",
    "读取文件时：优先 grep / search_files 定位，再用 read_file 的 offset/limit 分段读取（单次约 200 行）；避免连续大块读取同一文件。",
    "收集到足够信息后立即用自然语言回答，不要无意义地继续读文件。",
    `项目根目录：${projectRoot}`,
  ];
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

  const oneLine = result.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

type WriteStage = {
  files: Map<string, string>;
  deletions: Set<string>;
  writtenList: string[];
};

export function createWriteStage(): WriteStage {
  return { files: new Map(), deletions: new Set(), writtenList: [] };
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
): Promise<string> {
  if (mode === "ask" && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return "Ask 模式下不支持文件修改，请仅使用只读工具查询项目。";
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
    const defaultLimit = mode === "ask" ? 200 : 500;
    const maxLimit = mode === "ask" ? 400 : 800;
    const limit = Math.min(maxLimit, Math.max(1, Number(args.limit) || defaultLimit));
    return sliceFileLines(content, offset, limit);
  }

  if (name === "grep") {
    const pattern = String(args.pattern || "").trim();
    if (!pattern) return "错误：缺少 pattern";
    const maxMatches = Math.min(80, Math.max(1, Number(args.max_matches) || 40));
    const result = await grepInProject(root, pattern, maxMatches);
    if (!result.ok) return `错误：${result.error}`;
    if (!result.matches.length) return "（无匹配）";
    return result.matches
      .map((m) => `${m.relative}:${m.line}: ${m.text}`)
      .join("\n");
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
    let content = stage.files.get(resolved.relative) ?? readCache?.get(resolved.relative) ?? null;
    if (content === null) {
      content = await readStagedFileContent(root, resolved.relative, resolved.path, stage);
      if (content !== null) readCache?.set(resolved.relative, content);
    }
    if (content === null) return `错误：${resolved.relative} 不存在或无法读取`;
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) return "错误：old_string 在文件中未找到，请检查空格与缩进是否完全一致";
    if (occurrences > 1) {
      return `错误：old_string 在文件中出现 ${occurrences} 次，请扩大 old_string 使匹配唯一`;
    }
    const patched = content.replace(oldString, newString);
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

  return `错误：未知工具 ${name}`;
}

export async function runVibeAgent(params: RunVibeAgentParams): Promise<void> {
  const mode = params.mode ?? "build";
  const isAsk = mode === "ask";
  const runProfile = normalizeRunProfile(
    params.runProfile ||
      (params.executionMode
        ? { kind: "execute_plan", targetFiles: params.runProfile?.targetFiles }
        : undefined),
  );
  const isExecutePlan = !isAsk && runProfile.kind === "execute_plan";
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

  const explicitMaxTurns = params.maxTurns;
  const statusMaxTurns = explicitMaxTurns;

  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  const openFileRel = openFile?.relative;

  onEvent({
    type: "status",
    data: {
      phase: "preparing",
      ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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

  const systemPrompt =
    (isAsk
      ? buildAskSystemPrompt(projectRoot, openFilePath, openFileSnippet)
      : buildSystemPrompt(projectRoot, openFilePath)) + projectContextBlock;

  const writeStage = isAsk ? null : createWriteStage();
  const readCache = new Map<string, string>();
  const activeTools = isAsk ? READ_ONLY_AGENT_TOOLS : VIBE_AGENT_TOOLS;
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: systemPrompt },
    ...buildHistoryMessages(params.history),
    { role: "user", content: prompt },
  ];

  emitAgentContext(onEvent, {
    mode,
    systemPrompt,
    history: historyForDisplay(params.history),
    projectContext: projectContextBlock || undefined,
    ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
          ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
        },
      });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn - 1) });
      return;
    }

    onEvent({
      type: "status",
      data: {
        phase: "waiting_model",
        turn,
        ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
        model,
      },
    });

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
          ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
          model,
          detail: `已等待 ${formatElapsedMs(Date.now() - modelWaitStartedAt)}`,
          elapsedMs: Date.now() - modelWaitStartedAt,
        },
      });
    }, 2000);
    const compactedMessages = compactMessagesForModel(messages);
    const contextChars = compactedMessages.reduce((sum, message) => sum + messageCharSize(message), 0);
    onEvent({
      type: "status",
      data: {
        phase: "compacting_context",
        turn,
        ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
        ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
        tools: activeTools,
        signal,
        onStreamProgress: (progress) => {
          modelStatusPhase = streamProgressPhase(progress) as typeof modelStatusPhase;
          onEvent({
            type: "status",
            data: {
              phase: modelStatusPhase,
              turn,
              ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
              ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
              ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
      onEvent({ type: "error", data: { message: completion.error || "模型请求失败" } });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn) });
      return;
    }

    const assistant = completion.message;
    const rawContent = String(assistant.content || "");
    const toolCalls = resolveToolCallsFromAssistant(rawContent, assistant.tool_calls || []);
    const visibleContent = stripTextToolCallMarkup(rawContent);

    if (!toolCalls.length) {
      const text = visibleContent.trim();
      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
          ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
          ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
          assistantText: visibleContent.trim(),
          hasToolCalls: true,
        },
      });
    }

    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(statusMaxTurns !== undefined ? { maxTurns: statusMaxTurns } : {}),
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
              if (oldString && before.split(oldString).length === 2) {
                after = before.replace(oldString, newString);
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
        result = await executeTool(projectRoot, toolName, toolArgs, writeStage, mode, readCache);
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

    if (explicitMaxTurns !== undefined && turn >= explicitMaxTurns) {
      onEvent({
        type: "status",
        data: { phase: "finished", turn, maxTurns: explicitMaxTurns },
      });
      if (!isAsk && writeStage?.writtenList.length) {
        onEvent({
          type: "error",
          data: { message: `已达最大轮次（${explicitMaxTurns}），任务可能未完成。` },
        });
      }
      onEvent({ type: "done", data: buildDoneData(writeStage, turn) });
      return;
    }
  }
}
