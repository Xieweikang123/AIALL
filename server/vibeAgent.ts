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
  buildAskSystemPromptLines,
  buildFileAccessPathHint,
  buildSearchFilesEmptyHint,
} from "./agentAskPrompt";
import {
  ASK_EXPLORE_TURN_BUDGET,
  ASK_MAX_TOTAL_EXPLORE_HARD,
  ASK_MAX_TOTAL_EXPLORE_SOFT,
  buildAskExploreBudgetNudge,
  buildAskExploreSoftCapNudge,
  buildAskForceAnswerNudge,
  buildConsultativeExploreBudgetNudge,
  buildExploreBudgetNudge,
  buildExploreInterimDiagnosisNudge,
  buildExploreSoftCapNudge,
  buildFileBreadthNudge,
  buildBuildExploreForcePatchNudge,
  buildForceOutputNudge,
  buildGrepEmptyRecoveryNudge,
  buildPatchAnchorForcePatchNudge,
  buildPatchRequiredRetryNudge,
  buildImplementPasteBlockedNudge,
  buildUiDefectForcePatchNudge,
  buildUserNegationNudge,
  buildEmptyReplyRetryNudge,
  buildPrematureCompletionRetryNudge,
  buildCodeReviewHonestyNudge,
  buildUserErrorQuoteHint,
  buildUserFailureReportNudge,
  buildSameIssueFollowUpHint,
  buildSameIssueFollowUpForceSummaryNudge,
  buildPatchFailureCompletionRetryNudge,
  buildExplorationArchiveWriteBlockedMessage,
  buildAlternateUiPatchStrategyNudge,
  isExplorationArchivePath,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  EXPLORE_INTERIM_DIAGNOSIS_TURN,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
  CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET,
  isProductiveWritePath,
  MAX_READ_SLICE_REPEATS,
  MAX_TOTAL_EXPLORE_TURNS,
  MAX_TOTAL_EXPLORE_TURNS_SOFT,
  MAX_UNIQUE_READ_FILES_BEFORE_NUDGE,
  PLAN_EXPLORE_TURN_BUDGET,
  PLAN_MAX_TOTAL_EXPLORE_HARD,
  PLAN_MAX_TOTAL_EXPLORE_SOFT,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT,
} from "./agentExplorationBudget";
import { buildReplyAccuracyHint } from "../src/services/agentReplyAccuracy";
import { buildBehaviorContradictionHint, buildConsultativeBuildHint, buildAgentStepClarificationHint, buildAgentStepClarifyContinueHint, buildBuildWriteBlockedHint, buildImplementFollowUpHint, buildImplementationStatusHint, buildSessionAuditHint, buildUiDefectBuildHint, buildWriteToolBlockedMessage, isAgentStepClarificationPrompt, isBehaviorContradictionPrompt, isCodeReviewPrompt, isConsultativeUserPrompt, isImplementationStatusPrompt, isImplementFollowUpRun, isSameIssueFollowUpRun, isSessionAuditPrompt, isUiDefectReportPrompt, isUserErrorQuotePrompt, historySuggestsActiveImplementation, historySuggestsQuotePositionFix } from "../src/services/agentUserIntent";
import { detectProjectRuntimeProfile, buildRuntimeAwarenessHint } from "./agentRuntimeHint";
import { detectUserNegation, detectUserFailureReport, historyRecentUserFailureReport } from "../src/services/agentContinuation";
import { resolveOriginalTaskFromResumePrompt } from "../src/services/agentRecovery";
import { buildAgentSuggestionsPromptHint } from "../src/services/agentSuggestions";
import {
  buildBlockedGrepAfterLocateMessage,
  buildBlockedGrepMessage,
  buildEnglishPlanningNudge,
  buildOverlyBroadVisionGrepMessage,
  buildPatchAnchorLocatedNudge,
  buildSearchFilesContentQueryMessage,
  checkOverlappingRead,
  checkPatchOldStringFromReads,
  claimsPrematureCompletion,
  claimsSuccessDespitePatchFailures,
  shouldNudgeAlternateUiPatchStrategy,
  invalidateFileReadState,
  markPatchRecoveryFile,
  consumePatchRecoveryRead,
  isEmptyOrInsufficientFinalReply,
  isAnalysisOnlyReplyUnderForcePatch,
  isBlockedGrepAfterLocate,
  isBlockedGrepAfterVisionMisread,
  isOverlyBroadVisionGrep,
  isSearchFilesContentQuery,
  readLineRangeFromArgs,
  recordReadRange,
  sanitizeAgentUserVisibleText,
  shouldForcePatchAfterAnchorLocated,
  shouldNudgeEnglishPlanning,
  textConfirmsTeleportToBody,
  textIndicatesPatchAnchor,
  type ToolGuardContext,
} from "./agentExploreGuard";
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
  formatProjectMemoryForPrompt,
  isProjectMemorySection,
  readProjectMemory,
} from "./vibeProjectMemory";
import { formatAgentsGuideForPrompt, readProjectAgentsGuide } from "./vibeProjectAgentsGuide";
import { buildMemoryProposalToolResult } from "./projectMemoryProposal";
import { buildSkillProposalToolResult } from "./projectSkillProposal";
import {
  buildExplorationArchivePromptBlock,
  buildProjectSkillsPromptBlock,
  listProjectSkills,
  readProjectSkill,
} from "./vibeProjectSkills";
import {
  applyUniquePatch,
  grepInProject,
  listDirectory,
  readFileContent,
  resolveProjectPath,
  resolveReadablePath,
  searchFiles,
  sliceFileLines,
  writeFileContent,
  type RunExtractOutcome,
} from "./vibeFs";
import { runWebExtract, runWebSearch } from "./webExtract";
import {
  buildModelIdentityHint,
  buildVisionConsultativeContinueHint,
  buildVisionBuildContinueHint,
  buildVisionFirstTurnPrematureCompletionRetryHint,
  buildVisionFirstTurnRetryHint,
  buildVisionUserContent,
  contentCharSize,
  contentDisplayText,
  extractVisibleAnchorQuotes,
  isAdequateVisionFirstTurnDescription,
  isPrematureVisionCompletionClaim,
  isVisionUnsupportedError,
  sanitizeImageDataUrls,
  shouldRequireVisionFirstTurn,
  suggestsEmbeddedLayoutMisread,
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
  | { type: "done"; data: { writtenFiles: string[]; pendingFiles: string[]; turns: number; truncated?: boolean } };

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
export const ASK_MAX_CONTEXT_CHARS = 80_000;
/** Proactively compress older tool outputs above this size to reduce model latency. */
export const SOFT_COMPACT_CONTEXT_CHARS = 36_000;
const PLAN_MAX_CONTEXT_CHARS = 150_000;
const PROTECTED_RECENT_TOOL_RESULTS = 2;

function truncateText(text: string, max: number, suffix: string): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n${suffix.replace("{n}", String(text.length))}`;
}

function truncateForSse(text: string, max = MAX_SSE_TEXT_CHARS): string {
  return truncateText(text, max, "…（内容较长，已自动续跑中…）");
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
  const needsHardCompact = total > maxContextChars;
  const needsSoftCompact = total > SOFT_COMPACT_CONTEXT_CHARS;
  if (!needsHardCompact && !needsSoftCompact) return result;

  const compressTarget = needsHardCompact ? maxContextChars : SOFT_COMPACT_CONTEXT_CHARS;

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
    if (total <= compressTarget) break;
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
      description: "列出目录下的文件和子目录。空 path 表示项目根；相对路径限于项目内；绝对路径可读本机任意目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径：''=项目根，相对=项目内，绝对=本机任意目录" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文本文件。支持 offset/limit 按行读取大文件。相对路径限于项目内；绝对路径可读本机任意文件（如 AppData 下的配置/会话 JSON）。建议一次读取 200-500 行连续代码，避免小窗口（<80 行）反复读取同一文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径：相对项目根，或本机绝对路径" },
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
      name: "append_memory",
      description:
        "向项目记忆（.aiall/project-memory.md）追加一条记录（自动写入，无需确认）。section 为 术语|导航|偏好。仅在遇到重要的项目约定、术语、导航信息时调用，不要滥用。",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["术语", "导航", "偏好"],
            description: "写入分区：术语 / 导航 / 偏好",
          },
          content: { type: "string", description: "单条要点（勿带 leading -），1–200 字" },
        },
        required: ["section", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description: "列出 .aiall/skills/ 下的 skill（slug、kind、title）。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_skill",
      description: "读取指定 slug 的 skill 完整 Markdown 内容。",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "skill 文件名（不含 .md），如 ui-screenshot-locate" },
        },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_skill",
      description:
        "提议写入/更新 .aiall/skills/ 下的 skill 文件；须经用户确认。kind 为 fact|heuristic|preference。",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "skill 标识（kebab-case）" },
          kind: { type: "string", enum: ["fact", "heuristic", "preference"] },
          title: { type: "string", description: "短标题" },
          content: { type: "string", description: "Markdown 正文（不含 frontmatter）" },
        },
        required: ["slug", "kind", "title", "content"],
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
  ["list_dir", "read_file", "grep", "search_files", "web_search", "web_extract", "list_skills", "read_skill"].includes(
    t.function.name,
  ),
);

const READ_ONLY_AGENT_TOOL_NAMES = new Set([
  "list_dir",
  "read_file",
  "grep",
  "search_files",
  "web_search",
  "web_extract",
  "list_skills",
  "read_skill",
]);
const WRITE_AGENT_TOOL_NAMES = new Set(["write_file", "patch_file", "delete_file"]);

const LARGE_FILE_LINE_THRESHOLD = 500;

function requirePriorRead(stage: WriteStage, relative: string, existsOnDisk: boolean): string | null {
  if (!existsOnDisk) return null;
  if (stage.readPaths.has(relative)) return null;
  return `错误：请先 read_file 核对 ${relative} 的真实内容，再修改该文件`;
}

function isEnglishToolNarration(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(?:Now let me|Let me|I'll|I need to|First,?\s+I)\b/i.test(trimmed)) return true;
  const cjk = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (trimmed.match(/[a-zA-Z]/g) || []).length;
  return latin >= 24 && cjk < 8 && trimmed.length <= 220;
}

function isSubstantiveChineseToolPreamble(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isEnglishToolNarration(trimmed)) return false;
  return (trimmed.match(/[\u4e00-\u9fff]/g) || []).length >= 8;
}

function emitUserVisibleAssistantMessage(
  onEvent: RunVibeAgentParams["onEvent"],
  text: string,
  streamedChars: number,
): void {
  const visible = sanitizeAgentUserVisibleText(text);
  if (visible && !streamedChars) {
    onEvent({ type: "message", data: { text: visible } });
  }
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

function callIsProductiveWrite(call: ChatToolCall): boolean {
  if (!WRITE_AGENT_TOOL_NAMES.has(call.function.name)) return false;
  const filePath = String(parseToolArgs(call.function.arguments || "{}").path || "").trim();
  return isProductiveWritePath(filePath);
}

function buildSystemPrompt(projectRoot: string, openFilePath?: string, model?: string): string {
  const lines = [
    "你是一个专业的编程 Agent（Build 模式），可以调用工具探索并修改本地项目。",
    "回答请使用中文。",
    "用户可能在消息中附带截图或图片；若已附带，请结合图片内容理解需求并回答，不要声称无法查看图片。",
    "用户附截图询问界面/功能时：先描述截图所见，再判断是否属于本项目（优先查 views/components 或项目惯用 UI 目录），勿默认是外部 IDE/桌面应用。",
    "截图中有可见文字/图标/按钮时：先 grep 图中可见原文的最短可识别片段（通常 ≥3 字），而非猜 CSS class 名或 SVG 路径；从 grep 命中定位 template/组件。",
    "用户针对截图局部提问（配色、按钮、某块区域）时：讨论阶段只谈其所指可见范围，勿擅自扩大到整页/全项目样式盘点；若用户明确要求修改，可在该范围内 grep/read 对应组件后 patch_file；用户明确说「整个/整页/全面板」时可按扩大后的范围实施。",
    "截图中内联 chip/标签/元信息样式（含聚合 badge）：grep 该 chip 的 class 名或 read 承载它的组件 `<style>` 段，勿用全局 theme 变量臆断局部配色。",
    "若系统标注【咨询任务·只读】：用户本条仅为提问/解释，只读探索后自然语言回答，禁止 patch_file / write_file / delete_file。",
    "其余 Build 任务：一旦你判断须改代码才能满足用户（含 bug、实测与描述不符、功能/体验需求），探索完成后同一轮立即 patch_file / write_file，禁止只输出方案并问「需要我执行吗」。",
    "用户要求「点击输入区域任意位置可聚焦/输入」时：read_file 核对父容器与内层 contenteditable/textarea 的 DOM 层级与命中区域；常见修复为外层 mousedown 转发 focus 或子元素 min-height:100% 填满，勿默认只加 padding。",
    "工作流程：先 grep / search_files 快速定位（通常 1 轮），read_file 读关键片段，然后 patch_file / write_file 修改。",
    "Bug / 实测不符：用户报告行为不对、没效果、试了不行等，默认理解为须修复；定位后直接 patch，勿停下来征求确认。",
    "区分问题类型：「按钮跑别处/位置不对」若控件与选区在空间上分离，优先查 position:fixed/absolute 或 Teleport 浮层定位，勿默认只改 flex；「点击没反应」「不工作」查事件处理/JS 逻辑。同一组件在连续消息中被提及时，每条消息是独立问题，不要因为上一条修了布局就假设这一条也是布局问题。",
    "短追问（如「需要吗」「要不要」「对吗」且未指明新对象）必须承接上一条助手回复的话题作答，勿因会话更早主题偏离；若意图仍不清晰，用一句话澄清，禁止回顾已完成工作清单或擅自改代码。",
    "在已确认须改代码后，探索够了同一轮即 patch/write，勿连续多轮只 read；同一轮可并行 grep/read。",
    "CSS/SCSS 样式定位：禁止 grep 推测出的全局 layout 选择器；应 read_file 已定位组件文件的 `<style>` 或 scoped 样式段。",
    "CSS class 重命名时：修改前先 grep 旧 class 名在该文件中的所有出现次数，然后一次性补全所有匹配（如同时改 `.old-class`、`.old-class:hover`、`.old-class:active`、`.old-class-icon` 等）。改完后 grep 验证零残留，确认全部替换完毕再宣布完成。",
    "用户选择执行：当你提供了多个方案/选项让用户选择时，用户选定后必须立即执行该方案（如 patch_file / write_file 落盘），不得自行改变方向或跳过执行去做其他调查。执行完毕并报告结果后，若需进一步排查再提出下一步建议。",
    "Build 模式简短实施指令（如「执行」「继续」「改吧」「优化」）或用户明确提出要改时：若上一条助手回复已列出具体改动步骤、代码片段或目标文件，必须立即 patch_file / write_file，禁止再次征求确认；除非改动涉及大范围重构或明显高风险操作。",
    "当前已在 Build 模式时，禁止再问用户是否切换到 Build；若上一条已列出多项改动，patch 须逐项落实，不得在回复中声称已完成尚未 patch 的项。",
    buildBuildWriteBlockedHint(),
    "Build 模式下用户追问「还能优化吗」「还能继续吗」「继续吧」「接着改」等，均视为执行指令，必须立即 patch_file / write_file，禁止再分析或询问。",
    "修改前必须先 read_file 核对目标文件；patch_file 的 old_string 须从 read 返回原文复制（含缩进），可换更短且唯一的片段。",
    "用户问「看出啥问题没」「检查一下」「这样对吗」等评价性问题时：必须先 read_file 读取你上次修改的文件，确认代码实际状态后再回答。禁止仅凭截图视觉判断或记忆作答。",
    "用户报告「试了不行/没有效果」后，禁止再用同样方案做未经证实的「检查完成✅」；须承认未验证项并给出可执行排查步骤。",
    "给用户的测试步骤须与项目实际运行环境一致（从 package.json scripts 判断 Web dev vs 桌面壳）；禁止混用。",
    "解释项目时：从 package.json、README、入口文件等关键文件入手，不要臆测。",
    buildReplyAccuracyHint(),
    "修改代码时：小范围改动优先 patch_file（old_string 须唯一匹配）；全文件重写或新文件才用 write_file；大文件禁止 write_file 整文件覆盖。",
    "需要确认现状时 read_file 用 offset/limit 读相关片段即可，不要读整个大文件。",
    "write_file / patch_file / delete_file 会立即写入磁盘，无需用户确认。",
    "探索结论或踩坑可调用 append_memory 提议写入项目记忆（## 术语|导航|偏好）；可调用 propose_skill 提议写入项目 skill 目录；均须用户确认后才会落盘。",
    "可 list_skills / read_skill 按需读取项目 skill；冷启动时已注入 fact/heuristic 类 skill 摘要。",
    "删除文件时：使用 delete_file 工具，不要用 write_file 清空内容来替代删除。",
    "重要：必须通过 API 工具接口调用 list_dir、read_file 等，禁止在正文里输出 <function>、<parameter> 等标记。",
    buildFileAccessPathHint(),
    "write_file / patch_file / delete_file 的 path 必须相对项目根，禁止绝对路径。",
    "run_command 可在项目目录执行 shell 命令（如 npm run dev、python main.py、go test），超时默认 30 秒，长时间命令请设置 timeout_ms；不要执行危险命令。",
    "联网搜索：当需要最新信息、外部文档、API 用法时，使用 web_search 搜索；使用 web_extract 抓取指定链接内容。搜索结果可能较多，优先关注前 3 条结果，避免大量内容占用上下文。",
    "如果系统提示你上一次回复被截断，请从截断处继续输出，不要重复已输出的内容。",
    "附截图时：首轮输出截图描述后，后续轮次禁止再次描述同一张截图。若需追问用户意见，应在代码探索后给出具体方案对比，而非仅提问。",
    buildAgentSuggestionsPromptHint(),
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
  const lines = [...buildAskSystemPromptLines(projectRoot)];
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
    "短追问（如「需要吗」「要不要」且未指明新对象）必须承接上一条助手回复的话题作答，勿因会话更早主题偏离；若意图仍不清晰，用一句话澄清。",
    "工作流程：先探索相关代码 → 输出结构化修改方案（规划文档）→ 等待用户确认 → 用户确认后系统进入执行阶段并写入代码。",
    "当前处于【规划阶段】：只读探索，禁止 patch_file / write_file / delete_file / run_command。",
    "输出格式要求（作为可执行的方案文档）：",
    "0. 方案开头第一行必须是 `[PLAN]` 或 `## 修改方案`（二选一，便于系统识别）；",
    "1. 标题使用「## 修改方案」；先概述需求和当前状态；",
    "2. 列出涉及的文件清单（相对路径）；",
    "3. 对每个文件给出具体改动说明和代码块（标明修改前/修改后或新增内容）；",
    "4. 说明改动顺序和依赖关系；",
    "5. 文末固定提示：「确认无误后回复「执行方案」或点击消息上的「执行方案」按钮，我将按方案改代码。」",
    buildAgentSuggestionsPromptHint(),
    buildReplyAccuracyHint(),
    "收集到足够信息后立即输出方案，不要无意义地继续读文件。",
    "重要：必须通过 API 工具接口调用 list_dir、read_file 等，禁止在正文里输出 <function>、<parameter> 等标记。",
    "read_file / list_dir：项目内用相对路径；读项目外数据按 AGENTS.md 或用户给出的路径说明；大文件用 offset/limit，勿用 run_command 读文件。",
    "write_file / patch_file / delete_file 的 path 必须相对项目根，禁止绝对路径。",
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

function buildDoneData(stage: WriteStage | null, turns: number, truncated = false) {
  if (!stage) {
    return { writtenFiles: [] as string[], pendingFiles: [] as string[], turns, ...(truncated ? { truncated: true } : {}) };
  }
  return {
    writtenFiles: [...stage.writtenList],
    pendingFiles: [] as string[],
    turns,
    ...(truncated ? { truncated: true } : {}),
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
  readable: { path: string; key: string; outsideProject: boolean },
  stage: WriteStage | null,
): Promise<string | null> {
  if (!readable.outsideProject && stage?.files?.has(readable.key)) {
    return stage.files.get(readable.key)!;
  }
  const result = await readFileContent(readable.path).catch(() => null);
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
  readSliceRepeatCounts?: Map<string, number>,
  toolGuard?: ToolGuardContext,
): Promise<string> {
  if (mode === "ask" && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return buildWriteToolBlockedMessage("ask");
  }
  if (mode === "plan" && !stage && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return buildWriteToolBlockedMessage("plan");
  }
  if (!stage && WRITE_AGENT_TOOL_NAMES.has(name)) {
    return buildWriteToolBlockedMessage("consultative_build");
  }
  const root = path.resolve(projectRoot);

  if (name === "list_dir") {
    const rel = String(args.path ?? "").trim();
    if (!rel) {
      const stat = await fs.promises.stat(root).catch(() => null);
      if (!stat?.isDirectory()) return "错误：不是目录 .";
      const items = await listDirectory(root);
      const lines = items.map((item) => `${item.isDirectory ? "[dir]" : "[file]"} ${item.name}`);
      return lines.length ? lines.join("\n") : "（空目录）";
    }
    const resolved = resolveReadablePath(root, rel);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const stat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!stat?.isDirectory()) return `错误：不是目录 ${resolved.displayPath}`;
    const items = await listDirectory(resolved.path);
    const lines = items.map((item) => {
      if (resolved.outsideProject) {
        const full = path.join(resolved.path, item.name).replace(/\\/g, "/");
        return `${item.isDirectory ? "[dir]" : "[file]"} ${full}`;
      }
      const itemRel = resolved.key ? `${resolved.key}/${item.name}` : item.name;
      return `${item.isDirectory ? "[dir]" : "[file]"} ${itemRel}`;
    });
    return lines.length ? lines.join("\n") : "（空目录）";
  }

  if (name === "read_file") {
    const filePath = String(args.path || "").trim();
    if (!filePath) return "错误：缺少 path";
    const resolved = resolveReadablePath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    const fileStat = await fs.promises.stat(resolved.path).catch(() => null);
    if (!fileStat?.isFile()) return `错误：${resolved.displayPath} 不存在或无法读取`;
    let content = readCache?.get(resolved.key) ?? null;
    if (content === null) {
      content = await readStagedFileContent(resolved, stage);
      if (content !== null) readCache?.set(resolved.key, content);
    }
    if (content === null) return `错误：${resolved.displayPath} 不存在或无法读取`;
    const offset = Number(args.offset) || 1;
    const defaultLimit = mode === "ask" ? 300 : mode === "plan" ? 400 : 350;
    const maxLimit = mode === "ask" ? 500 : mode === "plan" ? 600 : 500;
    const limit = Math.min(maxLimit, Math.max(1, Number(args.limit) || defaultLimit));
    const sliceKey = `${resolved.key}:${offset}:${limit}`;
    const lineRange = readLineRangeFromArgs(offset, limit);
    const patchRecoveryRead = consumePatchRecoveryRead(toolGuard, resolved.key);
    if (patchRecoveryRead) {
      invalidateFileReadState(
        resolved.key,
        readSliceCache,
        readSliceRepeatCounts,
        toolGuard?.readFileRanges,
      );
      readCache?.delete(resolved.key);
      content = await readStagedFileContent(resolved, stage);
      if (content !== null) readCache?.set(resolved.key, content);
      if (content === null) return `错误：${resolved.displayPath} 不存在或无法读取`;
    }
    if (toolGuard && !patchRecoveryRead) {
      const overlapErr = checkOverlappingRead(resolved.key, lineRange, toolGuard.readFileRanges);
      if (overlapErr) return overlapErr;
    }
    const cachedSlice = !patchRecoveryRead ? readSliceCache?.get(sliceKey) : undefined;
    if (cachedSlice) {
      const repeats = (readSliceRepeatCounts?.get(sliceKey) ?? 0) + 1;
      readSliceRepeatCounts?.set(sliceKey, repeats);
      if (repeats > MAX_READ_SLICE_REPEATS) {
        return `错误：已连续 ${repeats} 次读取相同片段 ${resolved.displayPath}（offset ${offset} limit ${limit}），请基于已有内容继续分析或 patch_file，若需更多行请一次读更大范围（300-500 行），勿重复读相同片段。`;
      }
      return `${cachedSlice}\n（与上次 read_file 相同，已省略重复读取）`;
    }
    const sliced = sliceFileLines(content, offset, limit);
    readSliceCache?.set(sliceKey, sliced);
    if (toolGuard) {
      recordReadRange(resolved.key, lineRange, toolGuard.readFileRanges);
    }
    if (!resolved.outsideProject) {
      stage?.readPaths?.add(resolved.key);
    }
    return sliced;
  }

  if (name === "grep") {
    const pattern = String(args.pattern || "").trim();
    if (!pattern) return "错误：缺少 pattern";
    if (toolGuard?.visionMisreadActive && isBlockedGrepAfterVisionMisread(pattern, true)) {
      return buildBlockedGrepMessage(pattern);
    }
    if (
      toolGuard?.visionLocateActive &&
      toolGuard.visionAnchorQuotes?.length &&
      isOverlyBroadVisionGrep(pattern, toolGuard.visionAnchorQuotes)
    ) {
      return buildOverlyBroadVisionGrepMessage(pattern, toolGuard.visionAnchorQuotes);
    }
    if (
      toolGuard &&
      isBlockedGrepAfterLocate(pattern, toolGuard.patchAnchorLocated, toolGuard.teleportBodyConfirmed)
    ) {
      return buildBlockedGrepAfterLocateMessage(pattern);
    }
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
    if (toolGuard?.visionLocateActive && isSearchFilesContentQuery(query)) {
      return buildSearchFilesContentQueryMessage(query);
    }
    const maxResults = Math.min(50, Math.max(1, Number(args.max_results) || 30));
    const results = await searchFiles(root, query, maxResults);
    if (!results.length) return buildSearchFilesEmptyHint(query);
    return results.map((r) => `${r.isDirectory ? "[dir]" : "[file]"} ${r.relative}`).join("\n");
  }

  if (name === "write_file") {
    if (!stage) return buildWriteToolBlockedMessage("consultative_build");
    const filePath = String(args.path || "").trim();
    const content = args.content;
    if (!filePath) return "错误：缺少 path";
    if (typeof content !== "string") return "错误：缺少 content";
    const resolved = resolveProjectPath(root, filePath);
    if (!resolved.ok) return `错误：${resolved.error}`;
    if (toolGuard?.blockExplorationArchiveWrite && isExplorationArchivePath(resolved.relative)) {
      return buildExplorationArchiveWriteBlockedMessage();
    }
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
    readSliceCache?.forEach((_, key) => { if (key.startsWith(`${resolved.relative}:`)) readSliceCache!.delete(key); });
    return `已写入 ${resolved.relative}（${content.length} 字符）`;
  }

  if (name === "patch_file") {
    if (!stage) return buildWriteToolBlockedMessage("consultative_build");
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
      content = await readStagedFileContent(
        { path: resolved.path, key: resolved.relative, outsideProject: false },
        stage,
      );
      if (content !== null) readCache?.set(resolved.relative, content);
    }
    if (content === null) return `错误：${resolved.relative} 不存在或无法读取`;
    const readCheck = checkPatchOldStringFromReads(
      resolved.relative,
      oldString,
      readSliceCache ?? new Map(),
      readCache,
    );
    if (readCheck) {
      markPatchRecoveryFile(toolGuard, resolved.relative);
      invalidateFileReadState(
        resolved.relative,
        readSliceCache,
        readSliceRepeatCounts,
        toolGuard?.readFileRanges,
      );
      return readCheck;
    }
    const patchResult = applyUniquePatch(content, oldString, newString);
    if (!patchResult.ok) {
      markPatchRecoveryFile(toolGuard, resolved.relative);
      invalidateFileReadState(
        resolved.relative,
        readSliceCache,
        readSliceRepeatCounts,
        toolGuard?.readFileRanges,
      );
      return patchResult.error;
    }
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
    readSliceCache?.forEach((_, key) => { if (key.startsWith(`${resolved.relative}:`)) readSliceCache!.delete(key); });
    if (toolGuard) toolGuard.visionLocateActive = false;
    return `已修改 ${resolved.relative}（${oldString.length} → ${newString.length} 字符）`;
  }

  if (name === "delete_file") {
    if (!stage) {
      return buildWriteToolBlockedMessage("consultative_build").replace("写文件", "删除文件");
    }
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

  if (name === "append_memory") {
    if (mode === "ask") return "Ask 模式下不支持写入项目记忆。";
    if (mode === "plan" && !stage) return buildWriteToolBlockedMessage("plan");
    const section = String(args.section ?? "").trim();
    const content = String(args.content ?? "").trim().replace(/\s+/g, " ");
    if (!isProjectMemorySection(section)) {
      return "错误：section 须为 术语、导航 或 偏好";
    }
    if (!content) return "错误：缺少 content";
    if (content.length > 200) return "错误：content 过长（最多 200 字）";
    const result = await appendProjectMemory(root, section, [content]);
    if (!result.ok) return `写入失败：${result.error}`;
    invalidateProjectContextCache(root);
    return `已写入项目记忆（## ${section}）：${content}`;
  }

  if (name === "list_skills") {
    const result = await listProjectSkills(root);
    if (!result.ok) return `错误：${result.error}`;
    if (!result.skills.length) return "（无 skill 文件）";
    return result.skills.map((s) => `- ${s.slug} [${s.kind}] ${s.title}`).join("\n");
  }

  if (name === "read_skill") {
    const slug = String(args.slug ?? "").trim();
    if (!slug) return "错误：缺少 slug";
    const result = await readProjectSkill(root, slug);
    if (!result.ok) return `错误：${result.error}`;
    return `# ${result.frontmatter.title} (${result.slug})\nkind: ${result.frontmatter.kind}\n\n${result.body}`;
  }

  if (name === "propose_skill") {
    if (mode === "ask") return "Ask 模式下不支持写入 skill。";
    if (mode === "plan" && !stage) return buildWriteToolBlockedMessage("plan");
    const slug = String(args.slug ?? "").trim();
    const kind = String(args.kind ?? "").trim();
    const title = String(args.title ?? "").trim();
    const content = String(args.content ?? "").trim();
    if (!slug || !title || !content) return "错误：缺少 slug / title / content";
    if (kind !== "fact" && kind !== "heuristic" && kind !== "preference") {
      return "错误：kind 须为 fact、heuristic 或 preference";
    }
    if (content.length > 2000) return "错误：content 过长（最多 2000 字）";
    return buildSkillProposalToolResult({ slug, kind, title, content });
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
  const runProfile = normalizeRunProfile(
    params.runProfile ||
      (params.executionMode
        ? { kind: "execute_plan", targetFiles: params.runProfile?.targetFiles }
        : undefined),
  );
  const isExecutePlan = !isAsk && runProfile.kind === "execute_plan";
  const isPlanExplore = mode === "plan" && !isExecutePlan;
  const toolMode: VibeChatMode = isExecutePlan ? "build" : mode;
  const nudgeMode = isExecutePlan && mode === "plan" ? "build" : mode;
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
  const implementFollowUpRun =
    !isAsk &&
    !isPlanExplore &&
    !isExecutePlan &&
    isImplementFollowUpRun(prompt, params.history, { isAsk });
  const sameIssueFollowUpRun =
    !isAsk &&
    !isPlanExplore &&
    !isExecutePlan &&
    !implementFollowUpRun &&
    isSameIssueFollowUpRun(prompt, params.history);
  const exploreHardCap = sameIssueFollowUpRun
    ? SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE
    : MAX_TOTAL_EXPLORE_TURNS;
  const exploreSoftCap = sameIssueFollowUpRun
    ? SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT
    : MAX_TOTAL_EXPLORE_TURNS_SOFT;
  const codeReviewRun =
    !isAsk &&
    !isPlanExplore &&
    !isExecutePlan &&
    isCodeReviewPrompt(prompt) &&
    !implementFollowUpRun;
  const userErrorQuoteRun =
    !isAsk &&
    !isPlanExplore &&
    !isExecutePlan &&
    isUserErrorQuotePrompt(prompt, params.history) &&
    !implementFollowUpRun;
  const userFailureReportRun =
    !isAsk && !isPlanExplore && !isExecutePlan && detectUserFailureReport(prompt);
  const userRecentlyReportedFailure = historyRecentUserFailureReport(params.history);
  const sessionAuditRun =
    !isAsk && !isPlanExplore && !isExecutePlan && isSessionAuditPrompt(prompt);
  const behaviorContradictionRun =
    !isPlanExplore &&
    !isExecutePlan &&
    !implementFollowUpRun &&
    isBehaviorContradictionPrompt(prompt, params.history);
  const resumeOriginalTask = resolveOriginalTaskFromResumePrompt(prompt);
  const consultativeResumeRun =
    !isAsk &&
    !isPlanExplore &&
    !isExecutePlan &&
    Boolean(resumeOriginalTask && isConsultativeUserPrompt(resumeOriginalTask));
  const readOnlyBuildRun =
    !isAsk &&
    !isPlanExplore &&
    !isExecutePlan &&
    (isConsultativeUserPrompt(prompt) ||
      consultativeResumeRun ||
      codeReviewRun ||
      sessionAuditRun) &&
    !implementFollowUpRun;
  const implementationStatusRun =
    readOnlyBuildRun &&
    isImplementationStatusPrompt(resumeOriginalTask ?? prompt) &&
    historySuggestsActiveImplementation(params.history);
  const imageDataUrls = sanitizeImageDataUrls(params.imageDataUrls);
  const uiDefectBuildRun =
    !isAsk &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    imageDataUrls.length > 0 &&
    isUiDefectReportPrompt(prompt, imageDataUrls.length > 0);
  const agentStepClarifyRun = !isAsk && !isPlanExplore && isAgentStepClarificationPrompt(prompt);

  const segmentBudget = resolveAgentMaxTurns(mode, runProfile);
  let segmentMaxTurns = params.maxTurns ?? segmentBudget;
  let segmentIndex = 1;
  const exploreTurnBudget = isExecutePlan ? EXECUTE_PLAN_EXPLORE_TURN_BUDGET : isPlanExplore ? PLAN_EXPLORE_TURN_BUDGET : INTERACTIVE_EXPLORE_TURN_BUDGET;
  const maxContextChars = isExecutePlan
    ? EXECUTE_PLAN_MAX_CONTEXT_CHARS
    : isPlanExplore
      ? PLAN_MAX_CONTEXT_CHARS
      : isAsk
        ? ASK_MAX_CONTEXT_CHARS
        : MAX_AGENT_CONTEXT_CHARS;

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
        detail: openFileRel ? `读取当前文件 ${openFileRel}` : undefined,
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
        detail: "扫描项目结构",
      },
    });
  }

  const memoryTaskContext = [prompt, openFileRel].filter(Boolean).join(" ");

  onEvent({
    type: "status",
    data: { phase: "building_context", model, detail: "加载项目上下文…" },
  });

  const [
    projectContextOrNull,
    projectMemoryResult,
    agentsGuideResult,
    projectSkillsBlock,
    explorationArchiveBlock,
  ] = await Promise.all([
    isExecutePlan ? Promise.resolve(null) : buildProjectContext(projectRoot),
    readProjectMemory(projectRoot),
    readProjectAgentsGuide(projectRoot),
    buildProjectSkillsPromptBlock(projectRoot, prompt),
    buildExplorationArchivePromptBlock(projectRoot, prompt),
  ]);

  let projectContextBlock = "";
  if (isExecutePlan) {
    projectContextBlock = `\n\n项目根：${projectRoot}（方案执行阶段，已跳过全项目扫描）`;
    projectContextBlock += buildExecutePlanSystemHint(targetManifest, runProfile.userIntent);
  } else if (projectContextOrNull?.ok) {
    projectContextBlock = isAsk
      ? formatProjectContextForPrompt(projectContextOrNull)
      : formatProjectContextForBuild(projectContextOrNull);
  }

  const projectMemoryBlock =
    projectMemoryResult.ok && projectMemoryResult.content.trim()
      ? await formatProjectMemoryForPrompt(
          projectMemoryResult.content,
          projectMemoryResult.truncated,
          memoryTaskContext,
          projectRoot,
        )
      : "";

  const agentsGuideBlock =
    agentsGuideResult.ok && agentsGuideResult.content.trim()
      ? formatAgentsGuideForPrompt(agentsGuideResult.content, agentsGuideResult.truncated)
      : "";

  const runtimeProfile = detectProjectRuntimeProfile(projectRoot);
  const runtimeAwarenessBlock = buildRuntimeAwarenessHint(runtimeProfile);

  const systemPrompt =
    (isAsk
      ? buildAskSystemPrompt(projectRoot, openFilePath, openFileSnippet, model) +
        (behaviorContradictionRun ? buildBehaviorContradictionHint() : "")
      : isExecutePlan
      ? buildSystemPrompt(projectRoot, openFilePath, model)
      : isPlanExplore
      ? buildPlanSystemPrompt(projectRoot, openFilePath, openFileSnippet, model)
      : buildSystemPrompt(projectRoot, openFilePath, model) +
        (readOnlyBuildRun ? buildConsultativeBuildHint() : "") +
        (behaviorContradictionRun ? buildBehaviorContradictionHint() : "") +
        (codeReviewRun ? buildCodeReviewHonestyNudge(userRecentlyReportedFailure) : "") +
        (userErrorQuoteRun ? buildUserErrorQuoteHint() : "") +
        (userFailureReportRun ? buildUserFailureReportNudge() : "") +
        (implementationStatusRun ? buildImplementationStatusHint() : "") +
        (uiDefectBuildRun ? buildUiDefectBuildHint() : "") +
        (implementFollowUpRun ? buildImplementFollowUpHint(historySuggestsQuotePositionFix(params.history)) : "") +
        (sameIssueFollowUpRun ? buildSameIssueFollowUpHint() : "") +
        (sessionAuditRun ? buildSessionAuditHint() : "") +
        (agentStepClarifyRun ? buildAgentStepClarificationHint() : "")) +
    projectContextBlock +
    agentsGuideBlock +
    projectSkillsBlock +
    projectMemoryBlock +
    explorationArchiveBlock +
    runtimeAwarenessBlock;

  const writeStage = isAsk || isPlanExplore || readOnlyBuildRun ? null : createWriteStage();
  const readCache = new Map<string, string>();
  const readSliceCache = new Map<string, string>();
  const readSliceRepeatCounts = new Map<string, number>();
  const grepCache = new Map<string, string>();
  const toolGuard: ToolGuardContext = {
    readFileRanges: new Map(),
    patchRecoveryFiles: new Set(),
    visionMisreadActive: false,
    patchAnchorLocated: false,
    teleportBodyConfirmed: false,
    visionAnchorQuotes: [],
    visionLocateActive: false,
    blockExplorationArchiveWrite:
      sameIssueFollowUpRun && (userFailureReportRun || userRecentlyReportedFailure),
  };
  let consecutiveExploreTurns = 0;
  let totalExploreTurns = 0;
  let turnsLowNudgeSent = false;
  let interimDiagnosisNudgeSent = false;
  let patchAnchorLocated = false;
  let teleportBodyConfirmed = false;
  let patchAnchorNudgeSent = false;
  let patchAnchorForcePending = implementFollowUpRun;
  let englishPlanningNudgeSent = false;
  let uiDefectForcePatchNudgeSent = false;
  let patchAnchorForcePatchNudgeSent = false;
  let buildExploreForcePatchNudgeSent = false;
  let agentStepClarifyPending = agentStepClarifyRun;
  /** Track patch_file failures per turn for corrective nudges and final summary audit. */
  const patchFailureLog: Array<{ turn: number; path: string; reason: string }> = [];
  /** Track unique files read in explore-only turns to detect breadth sprawl. */
  const exploreFilesRead = new Set<string>();
  let fileBreadthNudgeSent = false;
  /** Track consecutive user negations to detect dissatisfaction patterns. */
  let consecutiveUserNegations = 0;
  let emptyReplyRetries = 0;
  let prematureCompletionRetries = 0;
  let patchFailureCompletionRetries = 0;
  const MAX_EMPTY_REPLY_RETRIES = 2;
  const MAX_PREMATURE_COMPLETION_RETRIES = 1;
  const MAX_PATCH_FAILURE_COMPLETION_RETRIES = 1;
  let negationNudgeSent = false;
  const activeTools = isAsk || isPlanExplore || readOnlyBuildRun ? READ_ONLY_AGENT_TOOLS : VIBE_AGENT_TOOLS;
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
  const MAX_TRUNCATION_RETRIES = 5;
  let truncationRetryCount = 0;
  let outputTruncated = false;
  const consultativeVisionRun = imageDataUrls.length > 0 && (isAsk || readOnlyBuildRun);

  emitAgentContext(onEvent, {
    mode,
    systemPrompt,
    history: historyForDisplay(params.history),
    projectContext: [projectContextBlock, agentsGuideBlock, projectSkillsBlock, projectMemoryBlock]
      .filter(Boolean)
      .join("") || undefined,
    ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
    model,
    ...(openFileRel ? { openFile: openFileRel } : {}),
  });

  if (signal?.aborted) {
    onEvent({ type: "status", data: { phase: "aborted" } });
    onEvent({ type: "done", data: buildDoneData(writeStage, 0) });
    return;
  }

  onEvent({ type: "status", data: { phase: "building_context", model, detail: "上下文就绪，开始运行" } });

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
      messages.push({
        role: "system",
        content: buildAgentTurnsLowNudge(turn, segmentMaxTurns, nudgeMode, isExecutePlan && mode === "plan"),
      });
      turnsLowNudgeSent = true;
    }

    // User negation detection: track consecutive dissatisfaction and inject direction-switch nudge.
    if (!isAsk && !isPlanExplore && prompt && detectUserNegation(prompt)) {
      consecutiveUserNegations += 1;
    } else if (prompt) {
      // Reset negation count when user sends a non-negation message (e.g., confirming a direction).
      consecutiveUserNegations = 0;
      negationNudgeSent = false;
    }
    if (
      !negationNudgeSent &&
      consecutiveUserNegations >= 2 &&
      !isAsk &&
      !isPlanExplore &&
      !readOnlyBuildRun
    ) {
      messages.push({
        role: "system",
        content: buildUserNegationNudge(consecutiveUserNegations),
      });
      negationNudgeSent = true;
    }

    toolGuard.patchAnchorLocated = patchAnchorLocated;
    toolGuard.teleportBodyConfirmed = teleportBodyConfirmed;

    // Progressive exploration restriction:
    //   Soft cap: strip grep/search_files — model can still read_file
    //   Hard cap: strip ALL tools — model must output text only
    //   UI defect + located anchor: hard cap keeps write tools (avoid analysis-only stall)
    const buildExploreHardCapReached =
      !isAsk && !isPlanExplore && !readOnlyBuildRun && totalExploreTurns >= exploreHardCap;
    const sameIssueFollowUpNeedsSummary =
      sameIssueFollowUpRun &&
      buildExploreHardCapReached &&
      writeStage !== null &&
      !writeStage.writtenList.some((p) => isProductiveWritePath(p));
    const forcePatchOutput =
      !sameIssueFollowUpNeedsSummary &&
      !isAsk &&
      !isPlanExplore &&
      !readOnlyBuildRun &&
      writeStage !== null &&
      (buildExploreHardCapReached ||
        shouldForcePatchAfterAnchorLocated(
          patchAnchorLocated,
          patchAnchorForcePending,
          buildExploreHardCapReached,
          implementFollowUpRun,
        ));
    const forceTextOutput =
      !forcePatchOutput &&
      (sameIssueFollowUpNeedsSummary ||
        (isAsk && totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_HARD) ||
        (isPlanExplore && totalExploreTurns >= PLAN_MAX_TOTAL_EXPLORE_HARD) ||
        (readOnlyBuildRun && totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_HARD));
    const stripWideSearch =
      !forceTextOutput &&
      !forcePatchOutput &&
      ((isAsk && totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_SOFT) ||
        (isPlanExplore && totalExploreTurns >= PLAN_MAX_TOTAL_EXPLORE_SOFT) ||
        (readOnlyBuildRun && totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_SOFT) ||
        (!isAsk && !isPlanExplore && !readOnlyBuildRun && totalExploreTurns >= exploreSoftCap));

    if (forcePatchOutput && !uiDefectForcePatchNudgeSent && buildExploreHardCapReached && uiDefectBuildRun) {
      messages.push({
        role: "system",
        content: buildUiDefectForcePatchNudge(totalExploreTurns),
      });
      uiDefectForcePatchNudgeSent = true;
    } else if (
      forcePatchOutput &&
      buildExploreHardCapReached &&
      !buildExploreForcePatchNudgeSent &&
      !uiDefectBuildRun &&
      !patchAnchorForcePending
    ) {
      messages.push({
        role: "system",
        content: buildBuildExploreForcePatchNudge(totalExploreTurns),
      });
      buildExploreForcePatchNudgeSent = true;
    } else if (forcePatchOutput && patchAnchorForcePending && !patchAnchorForcePatchNudgeSent) {
      messages.push({
        role: "system",
        content: buildPatchAnchorForcePatchNudge(),
      });
      patchAnchorForcePatchNudgeSent = true;
    } else if (forceTextOutput) {
      messages.push({
        role: "system",
        content: sameIssueFollowUpNeedsSummary
          ? buildSameIssueFollowUpForceSummaryNudge(totalExploreTurns)
          : isAsk || readOnlyBuildRun
            ? buildAskForceAnswerNudge(totalExploreTurns)
            : buildForceOutputNudge(totalExploreTurns, mode),
      });
    } else if (stripWideSearch) {
      messages.push({
        role: "system",
        content:
          isAsk || readOnlyBuildRun
            ? buildAskExploreSoftCapNudge(totalExploreTurns)
            : buildExploreSoftCapNudge(totalExploreTurns, mode),
      });
    }

    if (!fileBreadthNudgeSent && exploreFilesRead.size >= MAX_UNIQUE_READ_FILES_BEFORE_NUDGE) {
      const files = Array.from(exploreFilesRead);
      messages.push({ role: "system", content: buildFileBreadthNudge(files, mode) });
      fileBreadthNudgeSent = true;
    }

    if (
      !interimDiagnosisNudgeSent &&
      !isAsk &&
      !isPlanExplore &&
      writeStage !== null &&
      totalExploreTurns >= EXPLORE_INTERIM_DIAGNOSIS_TURN
    ) {
      messages.push({ role: "system", content: buildExploreInterimDiagnosisNudge(totalExploreTurns) });
      interimDiagnosisNudgeSent = true;
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
      if (agentStepClarifyPending) return [];
      if (forcePatchOutput) {
        return activeTools.filter((t) => WRITE_AGENT_TOOL_NAMES.has(t.function.name));
      }
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
    onEvent({ type: "status", data: { phase: "waiting_model", turn, model, detail: `第 ${turn} 轮：等待模型响应` } });
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
      !completion.message.tool_calls?.length
    ) {
      if (truncationRetryCount < MAX_TRUNCATION_RETRIES) {
        truncationRetryCount += 1;
        onEvent({
          type: "status",
          data: {
            phase: "streaming_model",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: `内容较长，正在自动补充完成（第 ${truncationRetryCount}/${MAX_TRUNCATION_RETRIES} 次）…`,
          },
        });
        // 将已截断的内容作为 assistant 消息推入上下文，让模型继续
        const truncatedText = String(completion.message.content || "");
        if (truncatedText.trim()) {
          messages.push({ role: "assistant", content: truncatedText });
          // 根据截断内容的上下文给出更精准的续跑提示
          const hasToolCalls = truncatedText.includes("patch_file") || truncatedText.includes("write_file") || truncatedText.includes("read_file") || truncatedText.includes("grep") || truncatedText.includes("search_files");
          const hasPartialCode = truncatedText.includes("```") && !truncatedText.match(/```\s*$/m);
          let continueHint: string;
          if (hasToolCalls && !hasPartialCode) {
            // 工具调用已完成，但文本总结被截断 → 提示总结剩余部分
            continueHint = readOnlyBuildRun
              ? "你的上一次回复因内容较多被截断。只读工具结果已有，请勿重复 grep/read 或调用写工具；直接完成剩余分析与结论。"
              : "你的上一次回复因内容较多被截断，之前的工具调用已成功执行，无需重复。" +
                "请继续完成剩余的分析和总结；如果任务已完成，直接输出简短结论即可。";
          } else if (hasPartialCode) {
            // 代码块写到一半被截断 → 提示补完代码块
            continueHint =
              "你的上一次回复因内容较多被截断，你正在写入代码/内容。" +
              "请从截断处继续完成当前代码块，不要重新开始。";
          } else {
            // 纯文本回复被截断
            continueHint =
              "你的上一次回复因内容较多被截断。" +
              "请从被截断的地方继续，不要重复已输出的内容。" +
              "如果任务已完成，直接输出简短结论即可。";
          }
          messages.push({
            role: "user",
            content: continueHint,
          });
        }
        continue;
      }
      // 达到最大重试次数 → 标记输出截断，交由客户端续跑
      outputTruncated = true;
      // 不再将截断提示追加到消息上下文（避免浪费 token / 混淆模型）；
      // 客户端会通过 done 事件的 truncated 标志自行处理续跑和 UI 展示
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
        emitUserVisibleAssistantMessage(onEvent, text, streamedChars);
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
          emitUserVisibleAssistantMessage(onEvent, text, streamedChars);
        }
        continue;
      }

      visionFirstTurnPending = false;
      completeVisionFirstTurn(text, false);
      toolGuard.visionMisreadActive = suggestsEmbeddedLayoutMisread(text);
      toolGuard.visionAnchorQuotes = extractVisibleAnchorQuotes(text);
      toolGuard.visionLocateActive = toolGuard.visionAnchorQuotes.length > 0 || imageDataUrls.length > 0;
      if (consultativeVisionRun) {
        messages.push({ role: "system", content: buildVisionConsultativeContinueHint() });
        if (segmentMaxTurns !== undefined) {
          segmentMaxTurns = Math.min(segmentMaxTurns, turn + 4);
        }
      } else {
        messages.push({ role: "system", content: buildVisionBuildContinueHint(text, prompt) });
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
      const rawText = visibleContent.trim();
      const userText = sanitizeAgentUserVisibleText(rawText);
      const mustPatchBeforeFinish =
        writeStage !== null &&
        !isAsk &&
        !isPlanExplore &&
        !readOnlyBuildRun &&
        writeStage.writtenList.length === 0 &&
        (implementFollowUpRun || (patchAnchorLocated && patchAnchorForcePending));

      if (agentStepClarifyPending) {
        agentStepClarifyPending = false;
        messages.push({ role: "assistant", content: rawText });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        emitUserVisibleAssistantMessage(onEvent, rawText, streamedChars);
        if (uiDefectBuildRun || patchAnchorLocated || patchAnchorForcePending) {
          messages.push({ role: "system", content: buildAgentStepClarifyContinueHint() });
          onEvent({
            type: "status",
            data: {
              phase: "clarify_continue",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
              detail: "已向用户解释，继续修复",
            },
          });
          continue;
        }
      }

      if (mustPatchBeforeFinish && isAnalysisOnlyReplyUnderForcePatch(rawText)) {
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content: implementFollowUpRun ? buildImplementPasteBlockedNudge() : buildPatchRequiredRetryNudge(),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        patchAnchorForcePending = true;
        patchAnchorForcePatchNudgeSent = false;
        onEvent({
          type: "status",
          data: {
            phase: "patch_required_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "须先提交代码修改，已要求重试",
          },
        });
        continue;
      }

      if (
        isEmptyOrInsufficientFinalReply(rawText) &&
        emptyReplyRetries < MAX_EMPTY_REPLY_RETRIES
      ) {
        emptyReplyRetries += 1;
        messages.push({ role: "assistant", content: rawText || "(empty)" });
        messages.push({ role: "system", content: buildEmptyReplyRetryNudge() });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "empty_reply_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "空回复，已要求输出有效正文",
          },
        });
        continue;
      }

      if (
        claimsPrematureCompletion(rawText) &&
        prematureCompletionRetries < MAX_PREMATURE_COMPLETION_RETRIES &&
        (userRecentlyReportedFailure ||
          codeReviewRun ||
          userFailureReportRun ||
          sameIssueFollowUpRun)
      ) {
        prematureCompletionRetries += 1;
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content: buildPrematureCompletionRetryNudge(userRecentlyReportedFailure || userFailureReportRun),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "premature_completion_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "过早宣称完成，已要求证据式核对",
          },
        });
        continue;
      }

      const failedPatchPaths = [...new Set(patchFailureLog.map((entry) => entry.path).filter(Boolean))];
      const successPatchPaths = writeStage?.writtenList.map((entry) => entry.key).filter(Boolean) ?? [];
      if (
        !isAsk &&
        writeStage &&
        patchFailureLog.length > 0 &&
        claimsSuccessDespitePatchFailures(rawText, patchFailureLog.length) &&
        patchFailureCompletionRetries < MAX_PATCH_FAILURE_COMPLETION_RETRIES
      ) {
        patchFailureCompletionRetries += 1;
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content: buildPatchFailureCompletionRetryNudge(failedPatchPaths, successPatchPaths),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "patch_failure_completion_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "存在 patch 失败却宣称完成，已要求如实审计",
          },
        });
        continue;
      }

      // Inject modification audit before final reply to prevent false claims of success.
      if (!isAsk && writeStage && patchFailureLog.length > 0) {
        const successCount = writeStage.writtenList.length;
        const failCount = patchFailureLog.length;
        const failFiles = [...new Set(patchFailureLog.map((f) => f.path))].join("、");
        messages.push({
          role: "system",
          content:
            `【修改审计】本轮会话中：${successCount} 个文件修改成功（${writeStage.writtenList.map((w) => w.key).join("、") || "无"}），` +
            `${failCount} 个 patch_file 调用失败（${failFiles}）。` +
            "在最终回复的总结中，只可声称上述成功修改的文件已完成；失败的修改必须如实标注'未生效'或'失败'，禁止虚假声称已完成。",
        });
      }

      // Ghost reply detection: model claims to have made changes but called no tools.
      const claimsModification =
        /(?:已完成修改|已更新|已修复|已添加|已删除|已改为|已改成|改动如下|优化完成|修改如下|刷新查看)/i.test(rawText) &&
        !/以上是|仅供参考|建议|方案|思路/.test(rawText);
      const noWriteToolsThisTurn =
        writeStage !== null &&
        !isAsk &&
        !isPlanExplore &&
        !readOnlyBuildRun &&
        writeStage.writtenList.length === 0;
      if (claimsModification && noWriteToolsThisTurn && turn > 1) {
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content:
            "【系统强制】你声称已完成修改，但本轮未调用任何 patch_file / write_file 工具，代码实际未被修改。" +
            "请立即调用 patch_file 或 write_file 提交真实的代码修改；禁止只输出文字描述。",
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "ghost_reply_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "检测到幻觉回复（声称修改但未执行工具），已要求重试",
          },
        });
        continue;
      }

      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          assistantText: userText,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: true,
        },
      });
      emitUserVisibleAssistantMessage(onEvent, rawText, streamedChars);
      onEvent({
        type: "status",
        data: {
          phase: "finished",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        },
      });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn, outputTruncated) });
      return;
    }

    if (visibleContent.trim()) {
      const preamble = visibleContent.trim();
      if (shouldNudgeEnglishPlanning(preamble) && !englishPlanningNudgeSent) {
        messages.push({ role: "system", content: buildEnglishPlanningNudge() });
        englishPlanningNudgeSent = true;
      }
      if (isSubstantiveChineseToolPreamble(preamble) && !streamedChars && (isAsk || readOnlyBuildRun)) {
        emitUserVisibleAssistantMessage(onEvent, preamble, streamedChars);
        streamedChars = sanitizeAgentUserVisibleText(preamble).length;
      }
      onEvent({
        type: "turn_trace",
        data: {
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          assistantText: preamble,
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
      content: visibleContent || "",
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
              { path: resolved.path, key: resolved.relative, outsideProject: false },
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
        result = await executeTool(
          projectRoot,
          toolName,
          toolArgs,
          writeStage,
          toolMode,
          readCache,
          readSliceCache,
          grepCache,
          readSliceRepeatCounts,
          toolGuard,
        );
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
      if (!outcome.result.startsWith("错误：") && textIndicatesPatchAnchor(outcome.result)) {
        patchAnchorLocated = true;
        if (writeStage !== null && !isAsk && !isPlanExplore && !readOnlyBuildRun) {
          patchAnchorForcePending = true;
        }
      }
      if (!outcome.result.startsWith("错误：") && textConfirmsTeleportToBody(outcome.result)) {
        teleportBodyConfirmed = true;
      }
      // Track patch_file failures for corrective nudges.
      if (toolName === "patch_file" && outcome.result.startsWith("错误：")) {
        try {
          const args = JSON.parse(outcome.call.function.arguments || "{}");
          patchFailureLog.push({
            turn,
            path: String(args.path || ""),
            reason: outcome.result.slice(0, 200),
          });
        } catch { /* ignore */ }
      }
    };

    const toolExecutionHeartbeat = setInterval(() => {
      if (signal?.aborted) return;
      onEvent({
        type: "status",
        data: {
          phase: "executing_tool",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          model,
          detail: "正在执行工具...",
        },
      });
    }, 5000);

    const turnGrepEmptyPatterns: string[] = [];
    const recordGrepEmpty = (call: ChatToolCall, result: string) => {
      if (call.function.name !== "grep" || result !== "（无匹配）") return;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const pattern = String(args.pattern ?? "").trim();
        if (pattern) turnGrepEmptyPatterns.push(pattern);
      } catch {
        /* ignore parse errors */
      }
    };

    try {
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
          for (const outcome of outcomes) {
            recordGrepEmpty(outcome.call, outcome.result);
            emitToolOutcome(outcome);
          }
        } else {
          for (const call of batch) {
            const outcome = await runToolCall(call);
            recordGrepEmpty(outcome.call, outcome.result);
            emitToolOutcome(outcome);
          }
        }

        index = end;
      }
    } finally {
      clearInterval(toolExecutionHeartbeat);
    }

    if (turnGrepEmptyPatterns.length > 0) {
      messages.push({
        role: "system",
        content: buildGrepEmptyRecoveryNudge(turnGrepEmptyPatterns),
      });
    }

    // Inject corrective prompt if patch_file calls failed this turn.
    const thisTurnPatchFailures = patchFailureLog.filter((f) => f.turn === turn);
    if (thisTurnPatchFailures.length > 0 && turn > 1) {
      const failedFiles = [...new Set(thisTurnPatchFailures.map((f) => f.path))].join("、");
      messages.push({
        role: "system",
        content:
          `【系统纠正】本轮 ${thisTurnPatchFailures.length} 个 patch_file 调用失败（文件：${failedFiles}）。` +
          "请 read_file 重新读取（patch 失败后已解除重叠/缓存限制）；从返回原文复制更短且唯一的 old_string 再 patch。" +
          "禁止凭记忆构造 old_string。",
      });
      for (const path of new Set(thisTurnPatchFailures.map((f) => f.path).filter(Boolean))) {
        if (shouldNudgeAlternateUiPatchStrategy(patchFailureLog, path)) {
          messages.push({ role: "system", content: buildAlternateUiPatchStrategyNudge(path) });
        }
      }
    }

    const turnHadProductiveWrite = toolCalls.some((call) => callIsProductiveWrite(call));
    const turnExploreOnly =
      toolCalls.length > 0 && toolCalls.every((call) => READ_ONLY_AGENT_TOOL_NAMES.has(call.function.name));
    if (
      patchAnchorLocated &&
      writeStage !== null &&
      !isAsk &&
      !isPlanExplore &&
      !readOnlyBuildRun &&
      !patchAnchorNudgeSent &&
      turnExploreOnly
    ) {
      messages.push({ role: "system", content: buildPatchAnchorLocatedNudge() });
      patchAnchorNudgeSent = true;
    }
    if (turnHadProductiveWrite) {
      consecutiveExploreTurns = 0;
      interimDiagnosisNudgeSent = false;
      patchAnchorForcePending = false;
      // Reset file-breadth tracking when the model finally writes (it found the target).
      exploreFilesRead.clear();
      fileBreadthNudgeSent = false;
    } else if (turnExploreOnly) {
      consecutiveExploreTurns += 1;
      totalExploreTurns += 1;
      if (
        (implementFollowUpRun || sameIssueFollowUpRun) &&
        totalExploreTurns >= 1 &&
        writeStage &&
        !writeStage.writtenList.some((p) => isProductiveWritePath(p))
      ) {
        patchAnchorForcePending = true;
        patchAnchorLocated = true;
      }
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
    if (isAsk && consecutiveExploreTurns >= ASK_EXPLORE_TURN_BUDGET) {
      messages.push({ role: "system", content: buildAskExploreBudgetNudge(consecutiveExploreTurns) });
      consecutiveExploreTurns = 0;
    } else if (readOnlyBuildRun && consecutiveExploreTurns >= CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET) {
      messages.push({ role: "system", content: buildConsultativeExploreBudgetNudge(consecutiveExploreTurns) });
      consecutiveExploreTurns = 0;
    } else if (!isAsk && !readOnlyBuildRun && consecutiveExploreTurns >= exploreTurnBudget) {
      messages.push({ role: "system", content: buildExploreBudgetNudge(consecutiveExploreTurns, mode) });
      consecutiveExploreTurns = 0;
    }

    // 轮次接近上限时，注入强制完成提示，避免 Agent 继续重试失败操作
    if (!readOnlyBuildRun && segmentMaxTurns !== undefined && turn >= segmentMaxTurns - 3 && turn < segmentMaxTurns) {
      const remaining = segmentMaxTurns - turn;
      messages.push({
        role: "system",
        content: `【紧急提示】剩余 ${remaining} 轮。请立即用 write_file 重写需要修改的文件完成任务，禁止再用 patch_file。如果任务已完成，请直接输出总结。`
      });
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
        onEvent({ type: "done", data: buildDoneData(writeStage, turn, outputTruncated) });
        return;
      }

      segmentIndex += 1;
      segmentMaxTurns = extendSegmentMaxTurns(turn, segmentBudget);
      turnsLowNudgeSent = false;
      if (!readOnlyBuildRun) {
        messages.push({
          role: "system",
          content: buildSegmentContinueNudge(turn, segmentIndex, nudgeMode, isExecutePlan && mode === "plan"),
        });
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
