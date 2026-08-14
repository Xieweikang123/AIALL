import {
  buildCursorAgentFeed,
  buildCursorAgentTimeline,
  computeExplorationStats,
  cursorActionClass,
  formatCursorActionLabel,
  formatExplorationSummary,
  getRecentFeedActions,
  getRunningFeedAction,
  type CursorAgentTimeline,
  type CursorFeedItem,
  type CursorFeedProcessBlock,
} from "./agentCursorFeed";
import {
  filterDuplicateFeedThoughts,
  isAgentTimelineAnswerStreaming,
  type LiveAgentAnswerSource,
} from "./agentMessageDisplay";
import type { AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";
import { resolveModelWaitElapsedSeconds, type AgentRunLiveState } from "./agentRunLiveState";
import { isAgentConnectPhase } from "./agentRecovery";
import type { AgentLogLineItem } from "../types/agentLog";
import type { VibeChatMessage } from "../types/vibeChat";
import { formatCharCount } from "../utils/vibeHelpers";

export type AgentCompactStatusInput = {
  msg: VibeChatMessage;
  isRunning: boolean;
  live?: AgentRunLiveState;
  connectStartedAt?: number;
  isActivityDetailed: boolean;
  roundGroupViews: AgentRoundGroupView[];
  answerPreview: string;
  liveAgentSource: LiveAgentAnswerSource;
  hasRunningTool: boolean;
};

function resolveConnectAgentDetail(input: AgentCompactStatusInput): string {
  const { live, connectStartedAt = 0 } = input;
  let agentDetail = live?.detail?.trim() || "";
  if (
    input.isRunning &&
    live &&
    isAgentConnectPhase(live.phase) &&
    connectStartedAt > 0
  ) {
    const elapsed = Math.max(0, Math.floor((Date.now() - connectStartedAt) / 1000));
    const base =
      live.detail?.trim() ||
      (live.phase === "connecting_local" ? "连接本地服务" : "启动 Agent");
    agentDetail = `${base} · ${elapsed}s`;
  }
  return agentDetail;
}

export type UnifiedAgentTimelineInput = {
  roundGroups: AgentRoundGroupView[];
  answerPreview: string;
  answerStreaming: boolean;
  isRunning: boolean;
  activityDetailed: boolean;
  compactFeed: boolean;
  agentPhase?: string;
  agentDetail?: string;
  chatMode?: "ask" | "build" | "plan" | "explore" | "auto";
};

export type CursorAgentFeedBuildInput = Pick<
  UnifiedAgentTimelineInput,
  | "roundGroups"
  | "isRunning"
  | "agentPhase"
  | "agentDetail"
  | "answerPreview"
  | "answerStreaming"
>;

/** Shared feed pipeline: cursor items with duplicate-thought filtering. */
export function buildFilteredCursorAgentFeedItems(
  input: CursorAgentFeedBuildInput,
): CursorFeedItem[] {
  return filterDuplicateFeedThoughts(
    buildCursorAgentFeed({
      groups: input.roundGroups,
      isRunning: input.isRunning,
      agentPhase: input.agentPhase,
      agentDetail: input.agentDetail,
      answerPreview: input.answerPreview,
      streaming: input.answerStreaming,
    }),
    input.answerPreview,
  );
}

export function buildCursorAgentFeedForMessage(input: AgentCompactStatusInput) {
  const live = input.live;
  const answerStreaming = isAgentTimelineAnswerStreaming(
    input.liveAgentSource,
    input.isRunning,
    input.hasRunningTool,
  );
  return buildFilteredCursorAgentFeedItems({
    roundGroups: input.roundGroupViews,
    isRunning: input.isRunning,
    agentPhase: live?.phase,
    agentDetail: resolveConnectAgentDetail(input),
    answerPreview: input.answerPreview,
    answerStreaming,
  });
}

/** Single chronological feed for AgentMergedContent (thought → tool → answer). */
export function buildUnifiedAgentTimeline(
  input: UnifiedAgentTimelineInput,
): CursorAgentTimeline {
  const items = buildFilteredCursorAgentFeedItems(input);

  // Keep all steps expanded for live, real-time feedback (no collapse while running).
  const timeline = buildCursorAgentTimeline(items, input.answerPreview, {
    keepVisible: 99,
    collapseAfter: 99,
    streaming: input.answerStreaming,
  });

  return timeline;
}

export function summarizeCursorProcessBlocks(
  blocks: CursorFeedProcessBlock[],
  toolCount: number,
  isRunning: boolean,
): string {
  const tools: AgentRoundTool[] = [];
  for (const block of blocks) {
    if (block.kind === "actions") {
      for (const item of [...block.collapsed, ...block.visible]) {
        tools.push(item.step);
      }
    }
  }
  const count = toolCount || tools.length;
  if (tools.length) {
    const stats = computeExplorationStats(tools);
    const body = formatExplorationSummary(stats, isRunning).replace(/^已完成 · /, "");
    if (isRunning) return body;
    return count > 0 ? `${count} 步 · ${body}` : body;
  }
  const thoughtCount = blocks.filter((block) => block.kind === "thought").length;
  if (thoughtCount) {
    return isRunning ? "思考中…" : `${thoughtCount} 段推理`;
  }
  return isRunning ? "准备中…" : count > 0 ? `${count} 步` : "查看步骤";
}

/** One footer line while running — avoids repeating tool-card details. */
export function buildAgentLiveFooterStatus(input: {
  currentStatus?: string;
  isRunning: boolean;
  hasAnswer: boolean;
  hasRunningTool?: boolean;
  hasActionBlocks?: boolean;
  agentPhase?: string;
}): string | null {
  if (!input.isRunning) return null;

  const waitingModel =
    input.agentPhase === "waiting_model" ||
    input.agentPhase === "sending_request" ||
    input.agentPhase === "retrying_model";
  const thinkingWithAnswer =
    input.agentPhase === "streaming_model" ||
    input.agentPhase === "planning_tools" ||
    input.agentPhase === "summarizing_tools" ||
    input.agentPhase === "compacting_context";

  // 已有中间叙述时仍要露出等待/思考态，否则气泡像已结束。
  if (input.hasAnswer && !waitingModel && !thinkingWithAnswer) return null;

  const status = input.currentStatus?.trim();
  if (!status) return null;
  if (/^探索代码库 ·/.test(status)) return null;

  if (input.hasRunningTool) {
    const turnOnly = status.match(/第 \d+(?:\/\d+)? 轮(?:\s*·\s*已等待 \d+s)?/);
    return turnOnly?.[0] ?? null;
  }

  return status;
}

export type AgentLiveStatusParts = { phase: string; meta: string[] };

export const AGENT_MODEL_WAIT_PHASES = new Set([
  "waiting_model",
  "sending_request",
  "retrying_model",
]);

/** Split a footer/status line into primary phase + secondary chips. */
export function splitAgentLiveStatusLine(primary: string): AgentLiveStatusParts {
  const trimmed = primary.trim();
  if (!trimmed) return { phase: "运行中…", meta: [] };
  const segments = trimmed.split(" · ").map((part) => part.trim()).filter(Boolean);
  if (segments.length <= 1) return { phase: trimmed, meta: [] };
  return { phase: segments[0]!, meta: segments.slice(1) };
}

export function isAgentWaitingModelPhase(input: {
  agentPhase?: string;
  statusLine?: string;
  hasRunningTool?: boolean;
}): boolean {
  if (input.hasRunningTool) return false;
  if (input.agentPhase && AGENT_MODEL_WAIT_PHASES.has(input.agentPhase)) return true;
  return Boolean(input.statusLine?.includes("等待模型"));
}

export function buildCursorCompactExplorationSummary(input: AgentCompactStatusInput): string {
  const stats = computeExplorationStats((input.msg.tools ?? []) as AgentRoundTool[]);
  return formatExplorationSummary(stats, input.isRunning);
}

export function buildCursorCompactRunningAction(input: AgentCompactStatusInput) {
  const action = getRunningFeedAction(buildCursorAgentFeedForMessage(input));
  return action?.step ?? null;
}

export function buildCursorCompactRecentActions(input: AgentCompactStatusInput) {
  return getRecentFeedActions(buildCursorAgentFeedForMessage(input)).recent;
}

export function buildCompactLogItems(input: AgentCompactStatusInput): AgentLogLineItem[] {
  return buildCursorCompactRecentActions(input).map((item) => ({
    key: item.key,
    label: formatCursorActionLabel(item.step),
    state: cursorActionClass(item.step) as AgentLogLineItem["state"],
  }));
}

export function buildCursorCompactHiddenCount(input: AgentCompactStatusInput): number {
  return getRecentFeedActions(buildCursorAgentFeedForMessage(input)).hiddenCount;
}

export function buildCursorCompactLiveStatus(input: AgentCompactStatusInput): string | null {
  const { msg, live } = input;
  if (!live) return null;
  if (buildCursorCompactRunningAction(input)) return null;

  if (live.phase === "streaming_model" || live.phase === "planning_tools") {
    const chars = live.streamChars ?? msg.streamChars ?? 0;
    // 中间叙述已上屏时仍显示思考态（叙述块本身不带流式光标）。
    return chars > 0 ? `思考中 · 已生成 ${chars} 字` : "思考中…";
  }

  const parts: string[] = [];
  const waitingModel =
    live.phase === "waiting_model" ||
    live.phase === "sending_request" ||
    live.phase === "retrying_model";
  if (live.phase === "compacting_context") parts.push("整理上下文…");
  else if (live.phase === "summarizing_tools") parts.push("整理工具结果…");
  else if (live.phase === "executing_tool" || live.phase === "executing_tools") return null;
  else if (waitingModel) parts.push("等待模型响应…");
  else parts.push("整合信息中…");

  const turn = live.turn ?? msg.agentTurn;
  if (turn) parts.push(`第 ${turn} 轮`);
  if (live.maxTurns && turn && !parts.some((part) => part.includes("/"))) {
    parts[parts.length - 1] = `第 ${turn}/${live.maxTurns} 轮`;
  }
  if (live.model) parts.push(live.model.split("/").pop() || live.model);
  if (waitingModel) {
    const elapsed = resolveModelWaitElapsedSeconds(live);
    if (elapsed !== null) {
      parts.push(`已等待 ${elapsed}s`);
      if (elapsed > 45) parts.push("响应较慢，可停止后重试");
    }
    const contextChars = live.contextChars ?? msg.contextChars ?? 0;
    if (contextChars > 0) parts.push(`上下文 ${formatCharCount(contextChars)}`);
    if (live.phase === "retrying_model" && live.retryAttempt) {
      const maxRetry = live.retryMaxAttempts ? `/${live.retryMaxAttempts - 1}` : "";
      parts.push(`重试 ${live.retryAttempt}${maxRetry}`);
    }
  } else if (live.detail?.trim()) {
    parts.push(live.detail.trim());
  }
  return parts.join(" · ");
}

export function buildCompactStatusInput(
  msg: VibeChatMessage,
  options: Omit<AgentCompactStatusInput, "msg">,
): AgentCompactStatusInput {
  return { msg, ...options };
}
