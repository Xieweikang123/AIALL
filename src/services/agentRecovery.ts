import { resolveAssistantBubbleContent } from "./agentMessageDisplay";
import type { AgentRoundGroup } from "./agentRoundGroups";

export type AgentProgressTool = {
  running?: boolean;
  label?: string;
  title?: string;
  name?: string;
  summary?: string;
  ok?: boolean;
  turn?: number;
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

/** No meaningful agent progress for this long → treat run as stalled (server heartbeats don't count). */
export const AGENT_STALL_PROGRESS_MS = 120_000;

/** Transient network / transport failures that can be resumed manually. */
export function isRecoverableAgentError(message: string): boolean {
  const msg = message.trim().toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("超时") ||
    msg.includes("首包") ||
    msg.includes("连接中断") ||
    msg.includes("连接失败") ||
    msg.includes("未收到完成信号") ||
    msg.includes("运行未完成") ||
    msg.includes("长时间无进展") ||
    msg.includes("可能已卡住") ||
    msg.includes("网络") ||
    /\bhttp\s*(502|503|504|408)\b/.test(msg) ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable")
  );
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

function extractFailureReasonFromStatusLog(statusLog?: string[]): string | null {
  if (!statusLog?.length) return null;
  for (let i = statusLog.length - 1; i >= 0; i -= 1) {
    const line = statusLog[i]?.trim() || "";
    if (!line) continue;
    const match = line.match(/^连接中断：(.+?)（可恢复运行）$/);
    if (match?.[1]) return match[1].trim();
    if (line.startsWith("错误：")) return line.slice(3).trim();
    if (isRecoverableAgentError(line)) return line.replace(/^连接中断：/, "").trim();
  }
  return null;
}

/** Infer recovery flags for legacy sessions or incomplete error handling. */
export function inferAgentRecoveryFlags(msg: AgentProgressSource & {
  role?: string;
  content?: string;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentFailureReason?: string;
  agentAborted?: boolean;
  agentRecoveryDismissed?: boolean;
  streaming?: boolean;
  statusLog?: string[];
}): AgentRecoveryFlags | null {
  if (msg.role && msg.role !== "assistant") return null;
  if (msg.agentAborted || msg.streaming || msg.agentRecoveryDismissed) return null;

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
    msg.content?.trim(),
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
  const direct = msg.content?.trim() || "";
  if (direct && !isRecoverableAgentError(direct)) return direct;

  const fromProgress = resolveAssistantBubbleContent({
    ...msg,
    content: direct && isRecoverableAgentError(direct) ? "" : direct,
  });
  if (fromProgress) return fromProgress;

  const turns = resolveAgentCompletedTurns(msg);
  const toolCount = msg.tools?.filter((t) => !t.running).length ?? 0;
  if (turns > 0 || toolCount > 0) {
    return `运行中断（已完成 ${turns} 轮${toolCount > 0 ? `，${toolCount} 个工具步骤` : ""}），可点击「恢复运行」继续。`;
  }

  return direct;
}

export function resolveAgentCompletedTurns(msg: AgentProgressSource): number {
  if (msg.totalTurns && msg.totalTurns > 0) return msg.totalTurns;
  const fromTraces = msg.turnTraces?.length ?? 0;
  if (fromTraces > 0) return fromTraces;
  const fromGroups = msg.roundGroups?.filter((g) => g.turn > 0).length ?? 0;
  if (fromGroups > 0) return fromGroups;
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
    const maxTools = 40;
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

  const lastNarrative =
    msg.roundGroups
      ?.map((g) => g.narrative?.trim())
      .filter(Boolean)
      .at(-1) ||
    msg.turnTraces?.at(-1)?.assistantText?.trim() ||
    "";
  if (lastNarrative) {
    const snippet =
      lastNarrative.length > 800 ? `${lastNarrative.slice(0, 800)}\n…（已截断）` : lastNarrative;
    lines.push("", "中断前最后一轮思路：", snippet);
  }

  const pendingFiles = msg.turnFileDiffs ? Object.keys(msg.turnFileDiffs) : [];
  const written = msg.writtenFiles?.length ? msg.writtenFiles : pendingFiles;
  if (written.length) {
    lines.push("", `已产生文件变更（${written.length} 个）：${written.join("、")}`);
  }

  return lines.join("\n");
}

export function buildAgentResumePrompt(
  msg: AgentProgressSource,
  originalUserPrompt: string,
  errorMessage: string,
): string {
  const progress = summarizeAgentProgress(msg);
  return [
    "【恢复运行】上次 Agent 运行因连接中断而停止。请从断点继续完成原始任务，不要重复已完成的工具步骤或已写入的修改。",
    `中断原因：${errorMessage.trim()}`,
    "",
    progress,
    "",
    "原始任务：",
    originalUserPrompt.trim(),
  ].join("\n");
}

export function canResumeAgentRun(msg: AgentProgressSource & {
  role?: string;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentAborted?: boolean;
  agentRecoveryDismissed?: boolean;
  streaming?: boolean;
}): boolean {
  if (msg.agentAborted || msg.streaming || msg.agentRecoveryDismissed) return false;
  return Boolean(msg.agentFailed && msg.agentRecoverable);
}

export function recoverableAgentErrorHint(msg: AgentProgressSource, errorMessage: string): string {
  const turns = resolveAgentCompletedTurns(msg);
  const toolCount = msg.tools?.filter((t) => !t.running).length ?? 0;
  const parts = [`Agent 因网络中断停止`];
  if (turns > 0) parts.push(`（已完成 ${turns} 轮`);
  if (toolCount > 0) parts.push(`${turns > 0 ? "，" : "（"}${toolCount} 个工具步骤`);
  if (turns > 0 || toolCount > 0) parts.push("）");
  parts.push(`：${errorMessage.trim()}。可点击「恢复运行」继续。`);
  return parts.join("");
}
