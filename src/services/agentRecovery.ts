import {
  hasAgentFinalAnswer,
  hasAgentRunStructure,
  hasSubstantiveAgentSummary,
  isTruncatedAssistantAnswer,
  PARTIAL_WRITE_ABORT_HEADING,
  resolveAssistantBubbleContent,
} from "./agentMessageDisplay";
import { buildConsultativeResumeHint, isConsultativeUserPrompt } from "./agentUserIntent";
import type { AgentRoundGroup } from "./agentRoundGroups";
import { stripToolSummaryFromAssistantContent } from "./vibeChatStorage";

export type AgentProgressTool = {
  running?: boolean;
  label?: string;
  title?: string;
  detail?: string;
  name?: string;
  summary?: string;
  ok?: boolean;
  turn?: number;
  args?: Record<string, unknown>;
};

export type AgentProgressSource = {
  content?: string;
  tools?: AgentProgressTool[];
  turnTraces?: Array<{ turn?: number; assistantText?: string }>;
  roundGroups?: AgentRoundGroup[];
  totalTurns?: number;
  agentTurn?: number;
  turnFileDiffs?: Record<string, unknown>;
  writtenFiles?: string[];
};

/** Reason persisted when Vite HMR or page unload interrupts an in-flight agent run. */
export const HMR_INTERRUPT_REASON = "页面刷新或热更新导致运行中断";

export function isHmrInterruptReason(reason: string): boolean {
  const text = reason.trim();
  if (!text) return false;
  return text === HMR_INTERRUPT_REASON || text.includes("热更新") || text.includes("页面刷新");
}

/** No meaningful agent progress for this long → treat run as stalled (server heartbeats don't count). */
export const AGENT_STALL_PROGRESS_MS = 120_000;

/** Stuck on local connect / upload with no SSE status for this long. */
export const AGENT_CONNECT_STALL_MS = 45_000;

/** Stuck in model-wait phase (sending_request / waiting_model / retrying_model) without response. */
export const AGENT_MODEL_WAIT_STALL_MS = 180_000;

const CONNECT_PHASES = new Set(["connecting_local", "stream_connected", "connected", "reconnecting"]);

export function isAgentConnectPhase(phase?: string): boolean {
  return Boolean(phase && CONNECT_PHASES.has(phase));
}

export function isAgentConnectStalled(
  connectStartedAt: number,
  phase: string | undefined,
  chatSending: boolean,
  now = Date.now(),
  thresholdMs = AGENT_CONNECT_STALL_MS,
): boolean {
  if (!chatSending || connectStartedAt <= 0) return false;
  if (!isAgentConnectPhase(phase)) return false;
  return now - connectStartedAt >= thresholdMs;
}

export function agentConnectStallMessage(hasImages = false): string {
  if (hasImages) {
    return "连接本地 Agent 超时（可能因图片过大或 sidecar 未运行）。请确认已执行 npm run sidecar，或缩小截图后重试。";
  }
  return "无法连接本地 Agent（127.0.0.1:37891）。请在项目目录运行 npm run sidecar 或 npm run dev。";
}

export function buildAgentMaxTurnsExhaustedMessage(maxTurns: number): string {
  return `已达最大轮次（${maxTurns}），任务可能未完成。`;
}

export function resolveAgentMaxTurnsFromProgress(
  msg: AgentProgressSource & { agentMaxTurns?: number },
): number | undefined {
  if (msg.agentMaxTurns && msg.agentMaxTurns > 0) return msg.agentMaxTurns;
  const fromGroups = (msg.roundGroups ?? [])
    .map((group) => group.maxTurns)
    .filter((value): value is number => typeof value === "number" && value > 0);
  return fromGroups.at(-1);
}

/** True when the run ended on the turn cap while still executing tools (not a final answer). */
export function isAgentMaxTurnsExhausted(
  msg: AgentProgressSource & { agentMaxTurns?: number },
  completedTurns: number,
): boolean {
  const maxTurns = resolveAgentMaxTurnsFromProgress(msg);
  if (!maxTurns || completedTurns < maxTurns) return false;
  const completedToolTurns = (msg.tools ?? [])
    .filter((t) => !t.running && (t.turn ?? 0) > 0)
    .map((t) => t.turn ?? 0);
  if (!completedToolTurns.length) return false;
  const lastToolTurn = Math.max(...completedToolTurns);
  return lastToolTurn >= completedTurns;
}

/** Delay before auto-resuming after transient disconnect (seconds). */
export const AGENT_AUTO_RESUME_SECONDS = 3;

/** Shorter delay for obvious transport blips (Failed to fetch / network error). */
export const AGENT_AUTO_RESUME_IMMEDIATE_SECONDS = 1;

/** Max silent client-side continuations after transport interruption (per assistant message). */
export const AGENT_SILENT_CONTINUE_MAX = 3;

/** Shorter model-wait stall threshold after silent continue — fail fast instead of showing half-replies. */
export const AGENT_CONTINUE_MODEL_WAIT_STALL_MS = 60_000;

/** Brief backoff before chaining the next SSE segment on the client. */
export const AGENT_SILENT_CONTINUE_DELAY_MS = 400;

/** Pick auto-resume countdown from the failure message. */
export function resolveAutoResumeSeconds(errorMessage: string): number {
  const msg = errorMessage.trim().toLowerCase();
  if (
    msg === "network error" ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("未收到完成信号") ||
    msg.includes("运行未完成")
  ) {
    return AGENT_AUTO_RESUME_IMMEDIATE_SECONDS;
  }
  return AGENT_AUTO_RESUME_SECONDS;
}

/** Transient network / transport failures that can be resumed manually. */
export function isRecoverableAgentError(message: string): boolean {
  const msg = message.trim().toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("已达最大轮次") ||
    msg.includes("任务可能未完成") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("超时") ||
    msg.includes("首包超时") ||
    msg.includes("等待首包超时") ||
    msg.includes("连接中断") ||
    msg.includes("连接失败") ||
    msg.includes("未收到完成信号") ||
    msg.includes("运行未完成") ||
    msg.includes("长时间无进展") ||
    msg.includes("可能已卡住") ||
    msg.includes("未生成最终回复") ||
    msg.includes("网络") ||
    /\bhttp\s*(502|503|504|408)\b/.test(msg) ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable")
  );
}

/** Auto-resume after disconnect; prefer silent continuation in the UI layer. */
export function shouldAutoResumeAgentError(message: string): boolean {
  return shouldSilentAutoContinue(message);
}

/** Whether the client should chain another SSE segment without asking the user. */
export function shouldSilentAutoContinue(message: string): boolean {
  if (!isRecoverableAgentError(message)) return false;
  if (isMaxTurnsExhaustedReason(message)) return false;
  if (isNoFinalAnswerReason(message)) return false;
  return true;
}

export function buildSilentContinueStatusLog(reason: string, attempt: number): string {
  const detail = reason.trim() || "连接中断";
  return `自动续跑（第 ${attempt} 次）：${detail}`;
}

export function hasRecoverableAgentProgress(msg: AgentProgressSource): boolean {
  if (resolveAgentCompletedTurns(msg) > 0) return true;
  if ((msg.roundGroups?.length ?? 0) > 0) return true;
  return Boolean(
    msg.tools?.some((t) => !t.running && (t.summary || t.label || t.title || t.name)),
  );
}

export function isAgentRunStalled(
  lastProgressAt: number,
  chatSending: boolean,
  now = Date.now(),
  thresholdMs = AGENT_STALL_PROGRESS_MS,
): boolean {
  if (!chatSending || lastProgressAt <= 0) return false;
  return now - lastProgressAt >= thresholdMs;
}

export function agentStallRecoveryReason(): string {
  return "运行长时间无进展（可能已卡住）";
}

export type AgentRecoveryFlags = {
  agentFailed: boolean;
  agentRecoverable: boolean;
  agentFailureReason: string;
};

const AGENT_STATUS_PROGRESS_RE =
  /^(?:正在|模型(?:输出|规划|请求)|继续执行（自动续跑|自动续跑（第 \d+ 次）|任务较长)/;

function extractFailureReasonFromStatusLog(statusLog?: string[]): string | null {
  if (!statusLog?.length) return null;
  for (let i = statusLog.length - 1; i >= 0; i -= 1) {
    const line = statusLog[i]?.trim() || "";
    if (!line) continue;
    const match = line.match(/^连接中断：(.+?)（可恢复运行）$/);
    if (match?.[1]) return match[1].trim();
    if (line.startsWith("错误：")) return line.slice(3).trim();
    if (line.startsWith("自动续跑（第 ") && line.includes("）：")) {
      const reason = line.replace(/^自动续跑（第 \d+ 次）：/, "").trim();
      if (reason && isRecoverableAgentError(reason)) return reason;
      continue;
    }
    if (AGENT_STATUS_PROGRESS_RE.test(line)) continue;
    if (isRecoverableAgentError(line)) return line.replace(/^连接中断：/, "").trim();
  }
  return null;
}

/** Run ended with tool progress but no final (`isFinal`) user-visible answer. */
export function isIncompleteAgentRunWithoutFinalAnswer(
  msg: AgentProgressSource & {
    agentAborted?: boolean;
  },
): boolean {
  if (msg.agentAborted) return false;
  if (!hasRecoverableAgentProgress(msg)) return false;
  if (!msg.roundGroups?.some((group) => group.turn > 0)) return false;
  return !hasAgentFinalAnswer(msg);
}

/** Detect truncated final answer: streaming stopped but answer was cut off mid-sentence. */
export function isTruncatedFinalAnswer(msg: AgentProgressSource & {
  streaming?: boolean;
}): boolean {
  if (!msg.streaming) return false;
  if (!hasAgentFinalAnswer(msg)) return false;
  // 获取最终回复文本
  const finalText = msg.roundGroups
    ?.filter((g) => g.response?.isFinal)
    .at(-1)?.response?.assistantText?.trim() || "";
  if (!finalText) return false;
  // 检测是否被截断
  return isTruncatedAssistantAnswer(finalText);
}

/** Infer recovery flags for legacy sessions or incomplete error handling. */
export function inferAgentRecoveryFlags(msg: AgentProgressSource & {
  role?: string;
  content?: string;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentFailureReason?: string;
  agentAborted?: boolean;
  agentAbortReason?: string;
  agentRecoveryDismissed?: boolean;
  agentContinueCount?: number;
  streaming?: boolean;
  statusLog?: string[];
}): AgentRecoveryFlags | null {
  if (msg.role && msg.role !== "assistant") return null;
  // 如果正在流式输出，只检测截断的最终回复
  if (msg.streaming) {
    if (isTruncatedFinalAnswer(msg)) {
      return {
        agentFailed: true,
        agentRecoverable: true,
        agentFailureReason: "回复被截断（模型输出不完整）",
      };
    }
    return null;
  }

  const completedTurns = resolveAgentCompletedTurns(msg);
  const maxTurns = resolveAgentMaxTurnsFromProgress(msg);
  if (maxTurns && isAgentMaxTurnsExhausted(msg, completedTurns)) {
    return {
      agentFailed: true,
      agentRecoverable: true,
      agentFailureReason: buildAgentMaxTurnsExhaustedMessage(maxTurns),
    };
  }

  if (isPartialWrittenRunInterrupt(msg) && hasRecoverableAgentProgress(msg)) {
    return {
      agentFailed: true,
      agentRecoverable: true,
      agentFailureReason: PARTIAL_RUN_RESUME_REASON,
    };
  }

  if (
    msg.agentAborted &&
    isHmrInterruptReason(msg.agentAbortReason || "") &&
    hasRecoverableAgentProgress(msg)
  ) {
    return {
      agentFailed: true,
      agentRecoverable: true,
      agentFailureReason: msg.agentAbortReason?.trim() || HMR_INTERRUPT_REASON,
    };
  }

  if (msg.agentAborted && !isHmrInterruptReason(msg.agentAbortReason || "")) {
    return {
      agentFailed: true,
      agentRecoverable: true,
      agentFailureReason: msg.agentAbortReason?.trim() || "已手动停止",
    };
  }

  if (msg.agentAborted) return null;

  if (isIncompleteAgentRunWithoutFinalAnswer(msg)) {
    return {
      agentFailed: true,
      agentRecoverable: true,
      agentFailureReason: "运行中断（未生成最终回复）",
    };
  }

  if (msg.agentRecoveryDismissed) return null;

  if (msg.agentFailed && msg.agentRecoverable) {
    return {
      agentFailed: true,
      agentRecoverable: true,
      agentFailureReason: msg.agentFailureReason?.trim() || "连接中断",
    };
  }

  const completedTools = msg.tools?.filter((t) => !t.running) ?? [];
  const hasProgress =
    completedTools.length > 0 ||
    (msg.roundGroups?.length ?? 0) > 0 ||
    resolveAgentCompletedTurns(msg) > 0;
  if (!hasProgress) return null;

  const candidates = [
    msg.agentFailureReason?.trim(),
    extractFailureReasonFromStatusLog(msg.statusLog),
    ...(msg.roundGroups?.some((group) => group.turn > 0) ? [msg.content?.trim()] : []),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (isRecoverableAgentError(candidate)) {
      return {
        agentFailed: true,
        agentRecoverable: true,
        agentFailureReason: candidate,
      };
    }
  }

  return null;
}

/** Bubble text when failure replaced narrative with a raw network error. */
export function resolveAgentFailureBubbleContent(
  msg: AgentProgressSource & { content?: string },
): string {
  const direct = stripToolSummaryFromAssistantContent(msg.content?.trim() || "");
  const staleIncompleteAnswer =
    hasAgentRunStructure(msg) && !hasAgentFinalAnswer(msg) && Boolean(direct);
  if (direct && !staleIncompleteAnswer && !isRecoverableAgentError(direct)) return direct;

  const fromProgress = resolveAssistantBubbleContent({
    ...msg,
    content: staleIncompleteAnswer || (direct && isRecoverableAgentError(direct)) ? "" : direct,
  });
  if (fromProgress) return fromProgress;

  const turns = resolveAgentCompletedTurns(msg);
  const toolCount = msg.tools?.filter((t) => !t.running).length ?? 0;
  if (turns > 0 || toolCount > 0) {
    const reason = (msg as { agentFailureReason?: string }).agentFailureReason?.trim();
    const hint = reason ? `（原因：${reason}）` : "";
    return `运行中断（已完成 ${turns} 轮${toolCount > 0 ? `，${toolCount} 个工具步骤` : ""}）${hint}，可点击「恢复运行」继续。`;
  }

  return direct;
}

export function resolveAgentCompletedTurns(msg: AgentProgressSource): number {
  if (msg.totalTurns && msg.totalTurns > 0) return msg.totalTurns;
  const fromGroups = msg.roundGroups?.filter((g) => g.turn > 0).length ?? 0;
  if (fromGroups > 0) return fromGroups;
  const fromTraces = msg.turnTraces?.length ?? 0;
  if (fromTraces > 0) return fromTraces;
  if (msg.agentTurn && msg.agentTurn > 1) return msg.agentTurn - 1;
  if ((msg.tools?.length ?? 0) > 0) return 1;
  return 0;
}

export function summarizeAgentProgress(msg: AgentProgressSource): string {
  const turns = resolveAgentCompletedTurns(msg);
  const completedTools =
    msg.tools?.filter((t) => !t.running && (t.summary || t.label || t.title || t.name)) ?? [];

  const lines: string[] = [];
  lines.push(`已完成 ${turns} 轮 Agent 循环。`);

  if (completedTools.length) {
    lines.push("", "已执行工具（勿重复）：");
    const maxTools = 20;
    for (let i = 0; i < Math.min(completedTools.length, maxTools); i += 1) {
      const t = completedTools[i]!;
      const label = t.label || t.title || t.name || "工具";
      const status = t.ok === false ? "（失败）" : "";
      const summary = t.summary ? `：${t.summary}` : "";
      lines.push(`- [轮 ${t.turn ?? "?"}] ${label}${summary}${status}`);
    }
    if (completedTools.length > maxTools) {
      lines.push(`…（另有 ${completedTools.length - maxTools} 个工具步骤）`);
    }
  }

  // 提取 patch_file/write_file 操作，注入操作记忆
  const writeTools = completedTools.filter((t) => t.name === "patch_file" || t.name === "write_file");
  if (writeTools.length) {
    lines.push("", "已执行写入操作（勿重复）：");
    for (const t of writeTools) {
      const path = String(t.args?.path ?? "未知文件");
      const status = t.ok === false ? "（失败）" : "（成功）";
      lines.push(`- ${t.name} ${path}${status}`);
    }
  }

  const readFileSummary = summarizeReadFileRanges(completedTools);
  if (readFileSummary) {
    lines.push("", "已读文件范围（勿重复读取相同区域，可 grep 定位后精确 read）：", readFileSummary);
  }

  const lastNarrative =
    msg.roundGroups
      ?.map((g) => g.narrative?.trim())
      .filter(Boolean)
      .at(-1) ||
    msg.turnTraces?.at(-1)?.assistantText?.trim() ||
    "";
  if (lastNarrative) {
    const snippet =
      lastNarrative.length > 400 ? `${lastNarrative.slice(0, 400)}\n…（已截断）` : lastNarrative;
    lines.push("", "中断前最后一轮思路：", snippet);
  }

  const pendingFiles = msg.turnFileDiffs ? Object.keys(msg.turnFileDiffs) : [];
  const written = msg.writtenFiles?.length ? msg.writtenFiles : pendingFiles;
  if (written.length) {
    lines.push("", `已产生文件变更（${written.length} 个）：${written.join("、")}`);
  }

  return lines.join("\n");
}

/**
 * Extract read_file tool calls, group by file path, merge overlapping line ranges,
 * and produce a compact summary like:
 *   - src/composables/useGitPanel.ts: L1-100, L196-247(refreshGitStatus), L348-374(unstageAll)
 *   - src/components/vibe/GitPanel.vue: L160-179
 */
function summarizeReadFileRanges(tools: AgentProgressTool[]): string {
  const readCalls = tools.filter((t) => t.name === "read_file" && t.ok !== false && t.args);
  if (!readCalls.length) return "";

  // file → array of { start, end }
  const fileRanges = new Map<string, Array<{ start: number; end: number }>>();

  for (const t of readCalls) {
    const args = t.args!;
    const path = String(args.path ?? "");
    if (!path) continue;
    const offset = Number(args.offset) || 1;
    const limit = Number(args.limit) || 100;
    const start = Math.max(1, offset);
    const end = start + limit - 1;

    if (!fileRanges.has(path)) fileRanges.set(path, []);
    fileRanges.get(path)!.push({ start, end });
  }

  if (!fileRanges.size) return "";

  // Merge overlapping ranges per file
  const mergedPerFile: Array<{ path: string; ranges: Array<{ start: number; end: number }> }> = [];
  for (const [path, raw] of fileRanges) {
    const sorted = raw.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end + 20) {
        // Merge if overlap or gap ≤ 20 lines (small gap = not worth re-reading)
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push({ start: r.start, end: r.end });
      }
    }
    mergedPerFile.push({ path, ranges: merged });
  }

  // Sort by file path for stable output
  mergedPerFile.sort((a, b) => a.path.localeCompare(b.path));

  const lines: string[] = [];
  for (const { path, ranges } of mergedPerFile) {
    const rangeStr = ranges
      .map((r) => (r.start === 1 && r.end <= 200 ? `L1-${r.end}` : `L${r.start}-${r.end}`))
      .join(", ");
    lines.push(`- ${path}: ${rangeStr}`);
  }
  return lines.join("\n");
}

export const PARTIAL_RUN_RESUME_REASON = "连接在总结前结束（部分修改已落盘）";

/** True when the bubble shows partial writes after an aborted run. */
export function isPartialWrittenRunInterrupt(
  msg: AgentProgressSource & { content?: string },
): boolean {
  if (!(msg.writtenFiles?.length ?? 0)) return false;
  return Boolean(msg.content?.includes(PARTIAL_WRITE_ABORT_HEADING));
}

/** Offer manual resume when a stopped run wrote files but skipped the final summary. */
export function shouldOfferPartialRunResume(params: {
  wasAborted: boolean;
  writtenFiles?: string[];
  msg: AgentProgressSource;
}): boolean {
  if (!params.wasAborted) return false;
  if ((params.writtenFiles?.length ?? 0) === 0) return false;
  if (!hasRecoverableAgentProgress(params.msg)) return false;
  return !hasSubstantiveAgentSummary(params.msg);
}

export function resolveAgentResumeButtonLabel(
  msg: AgentProgressSource & { content?: string },
): string {
  return isPartialWrittenRunInterrupt(msg) ? "继续" : "恢复运行";
}

export function buildAgentRunningStatusText(
  msg: AgentProgressSource & { writtenFiles?: string[] },
  statusText: string,
): string {
  const parts = [statusText.trim() || "Agent 运行中…"];
  const writtenCount = msg.writtenFiles?.length ?? 0;
  if (writtenCount > 0) parts.push(`已落盘 ${writtenCount} 个文件`);
  return parts.join(" · ");
}

/** Extract embedded user task from auto-resume prompt (for intent re-classification on server). */
export function resolveOriginalTaskFromResumePrompt(prompt: string): string | null {
  const marker = "原始任务（摘要）：";
  const idx = prompt.indexOf(marker);
  if (idx < 0) return null;
  const rest = prompt.slice(idx + marker.length).trim();
  return rest || null;
}

export function buildAgentResumePrompt(
  msg: AgentProgressSource,
  originalUserPrompt: string,
  errorMessage: string,
): string {
  const progress = summarizeAgentProgress(msg);
  const truncatedPrompt = originalUserPrompt.trim().length > 600
    ? `${originalUserPrompt.trim().slice(0, 600)}\n…（原始任务已截断，请按摘要继续完成）`
    : originalUserPrompt.trim();
  const consultative = isConsultativeUserPrompt(originalUserPrompt);
  const header = consultative
    ? [
        buildConsultativeResumeHint(),
        "上次运行因连接中断而暂停。请从断点继续完成原始提问的回答，不要重复已完成的只读工具步骤。",
      ]
    : [
        "【自动续跑】上次运行因连接中断而暂停。请从断点继续完成原始任务，不要重复已完成的工具步骤或已写入的修改。",
        "【效率】已读文件范围见下方摘要——相同文件的相同区域禁止再 read_file，用 grep 定位后直接 patch_file/write_file；最多 1 次 grep 定位遗漏。",
      ];
  return [
    ...header,
    `中断原因：${errorMessage.trim()}`,
    "",
    progress,
    "",
    "原始任务（摘要）：",
    truncatedPrompt,
  ].join("\n");
}

function passesAgentAbortResumeGate(
  msg: AgentProgressSource & {
    agentAborted?: boolean;
    agentAbortReason?: string;
    agentFailureReason?: string;
    writtenFiles?: string[];
    content?: string;
  },
): boolean {
  if (msg.agentAborted && !isPartialWrittenRunInterrupt(msg)) {
    const hmrReason = msg.agentAbortReason || msg.agentFailureReason || "";
    // HMR 中断且有进展 → 允许恢复
    if (isHmrInterruptReason(hmrReason) && hasRecoverableAgentProgress(msg)) return true;
    // 非 HMR 中断（如手动停止）→ 始终允许恢复
    if (!isHmrInterruptReason(hmrReason)) return true;
    return false;
  }
  return true;
}

/** Apply inferred recovery flags onto a persisted assistant message. */
export function applyInferredAgentRecovery(
  msg: AgentProgressSource & {
    role?: string;
    content?: string;
    agentFailed?: boolean;
    agentRecoverable?: boolean;
    agentFailureReason?: string;
    agentRecoveryDismissed?: boolean;
    activityExpanded?: boolean;
  },
): boolean {
  if (msg.role && msg.role !== "assistant") return false;
  const inferred = inferAgentRecoveryFlags(msg);
  if (!inferred?.agentRecoverable) return false;
  msg.agentFailed = inferred.agentFailed;
  msg.agentRecoverable = inferred.agentRecoverable;
  msg.agentFailureReason = inferred.agentFailureReason;
  msg.agentRecoveryDismissed = false;
  msg.content = resolveAgentFailureBubbleContent(msg);
  msg.activityExpanded = msg.activityExpanded ?? true;
  return true;
}

export function canResumeAgentRun(msg: AgentProgressSource & {
  role?: string;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentAborted?: boolean;
  agentAbortReason?: string;
  agentFailureReason?: string;
  agentRecoveryDismissed?: boolean;
  streaming?: boolean;
}): boolean {
  if (msg.streaming) return false;

  const inferred = inferAgentRecoveryFlags(msg);
  if (inferred?.agentRecoverable && passesAgentAbortResumeGate(msg)) return true;

  if (msg.agentRecoveryDismissed) return false;
  if (!msg.agentFailed || !msg.agentRecoverable) return false;
  return passesAgentAbortResumeGate(msg);
}

function isMaxTurnsExhaustedReason(errorMessage: string): boolean {
  const msg = errorMessage.trim();
  return msg.includes("已达最大轮次") || msg.includes("任务可能未完成");
}

function isStallReason(errorMessage: string): boolean {
  const msg = errorMessage.trim();
  return msg.includes("长时间无进展") || msg.includes("可能已卡住");
}

function isNoFinalAnswerReason(errorMessage: string): boolean {
  return errorMessage.trim() === "运行中断（未生成最终回复）";
}

export function recoverableAgentErrorHint(
  msg: AgentProgressSource & { agentAbortReason?: string },
  errorMessage: string,
): string {
  if (isPartialWrittenRunInterrupt(msg)) {
    const count = msg.writtenFiles?.length ?? 0;
    return `运行已中断，${count} 个文件已落盘但未生成总结。可点击「继续」完成剩余任务。`;
  }
  const reason = errorMessage.trim() || msg.agentAbortReason?.trim() || "";
  if (isHmrInterruptReason(reason)) {
    const turns = resolveAgentCompletedTurns(msg);
    const toolCount = msg.tools?.filter((t) => !t.running).length ?? 0;
    const progress =
      turns > 0 || toolCount > 0
        ? `（已完成 ${turns} 轮${toolCount > 0 ? `，${toolCount} 个工具步骤` : ""}）`
        : "";
    return `运行已中断：${reason}${progress}。可点击「恢复运行」从断点继续。`;
  }
  const turns = resolveAgentCompletedTurns(msg);
  const toolCount = msg.tools?.filter((t) => !t.running).length ?? 0;
  const progress =
    turns > 0 || toolCount > 0
      ? `（已完成 ${turns} 轮${toolCount > 0 ? `，${toolCount} 个工具步骤` : ""}）`
      : "";
  if (isMaxTurnsExhaustedReason(reason)) {
    return `Agent 已达到轮次上限${progress}，任务可能未完成。可点击「恢复运行」继续。`;
  }
  if (isStallReason(reason)) {
    return `Agent 运行似乎已卡住${progress}。可点击「恢复运行」从断点继续。`;
  }
  if (isNoFinalAnswerReason(reason)) {
    return `Agent 已完成运行但未生成最终回复${progress}。可点击「恢复运行」重新生成。`;
  }
  return `Agent 自动续跑后仍未能完成${progress}：${errorMessage.trim()}。可点击「恢复运行」重试。`;
}
