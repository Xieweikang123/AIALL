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
  type CursorFeedBlock,
} from "./agentCursorFeed";
import {
  filterDuplicateFeedThoughts,
  isAgentTimelineAnswerStreaming,
  type LiveAgentAnswerSource,
} from "./agentMessageDisplay";
import type { AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";
import type { AgentRunLiveState } from "./agentRunLiveState";
import { isAgentConnectPhase } from "./agentRecovery";
import type { AgentLogLineItem } from "../types/agentLog";
import type { VibeChatMessage } from "../types/vibeChat";

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

export function buildCursorAgentFeedForMessage(input: AgentCompactStatusInput) {
  const live = input.live;
  const answerStreaming = isAgentTimelineAnswerStreaming(
    input.liveAgentSource,
    input.isRunning,
    input.hasRunningTool,
  );
  const items = buildCursorAgentFeed({
    groups: input.roundGroupViews,
    isRunning: input.isRunning,
    agentPhase: live?.phase,
    agentDetail: resolveConnectAgentDetail(input),
    answerPreview: input.answerPreview,
    streaming: answerStreaming,
  });
  return filterDuplicateFeedThoughts(items, input.answerPreview, {
    suppressAllWhenBubble:
      input.isRunning && answerStreaming && Boolean(input.answerPreview.trim()),
  });
}

export function buildCursorAgentTimelineForMessage(
  input: AgentCompactStatusInput,
): CursorAgentTimeline {
  const detailed = input.isActivityDetailed;
  const stepCount = input.msg.tools?.length ?? 0;
  const compactFeed =
    input.isRunning && stepCount >= 4 && !detailed;
  return buildUnifiedAgentTimeline({
    roundGroups: input.roundGroupViews,
    answerPreview: input.answerPreview,
    answerStreaming: isAgentTimelineAnswerStreaming(
      input.liveAgentSource,
      input.isRunning,
      input.hasRunningTool,
    ),
    isRunning: input.isRunning,
    activityDetailed: detailed,
    compactFeed,
    agentPhase: input.live?.phase,
    agentDetail: resolveConnectAgentDetail(input),
  });
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
};

/** Single chronological feed for AgentMergedContent (thought → tool → answer). */
export function buildUnifiedAgentTimeline(
  input: UnifiedAgentTimelineInput,
): CursorAgentTimeline {
  const trimmedAnswer = input.answerPreview.trim();
  const items = filterDuplicateFeedThoughts(
    buildCursorAgentFeed({
      groups: input.roundGroups,
      isRunning: input.isRunning,
      agentPhase: input.agentPhase,
      agentDetail: input.agentDetail,
      answerPreview: input.answerPreview,
      streaming: input.answerStreaming,
    }),
    input.answerPreview,
    {
      suppressAllWhenBubble:
        input.isRunning && input.answerStreaming && Boolean(trimmedAnswer),
    },
  );

  const detailed = input.activityDetailed;
  const compact = input.compactFeed;
  const timeline = buildCursorAgentTimeline(items, input.answerPreview, {
    keepVisible: compact ? 3 : detailed ? 8 : 4,
    collapseAfter: compact ? 4 : detailed ? 10 : 5,
    compactWhileRunning: compact,
    streaming: input.answerStreaming,
  });

  if (timeline.answer) {
    const blocks = timeline.blocks.filter((block) => block.kind !== "thought");
    const processBlocks = timeline.processBlocks.filter((block) => block.kind !== "thought");
    return { ...timeline, blocks, processBlocks };
  }

  if (!compact || !input.isRunning) {
    return timeline;
  }

  const blocks = timeline.blocks.filter((block) => block.kind !== "thought");
  return { ...timeline, blocks };
}

export function buildUnifiedAgentTimelineBlocks(
  input: UnifiedAgentTimelineInput,
): CursorFeedBlock[] {
  return buildUnifiedAgentTimeline(input).blocks;
}

/** One footer line while running — avoids repeating tool-card details. */
export function buildAgentLiveFooterStatus(input: {
  currentStatus?: string;
  isRunning: boolean;
  hasAnswer: boolean;
  hasRunningTool?: boolean;
  hasActionBlocks?: boolean;
}): string | null {
  if (!input.isRunning || input.hasAnswer) return null;

  const status = input.currentStatus?.trim();
  if (!status) return null;
  if (/^探索代码库 ·/.test(status)) return null;

  if (input.hasRunningTool) {
    const turnOnly = status.match(/第 \d+(?:\/\d+)? 轮(?:\s*·\s*已等待 \d+s)?/);
    return turnOnly?.[0] ?? null;
  }

  return status;
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
  const timelineAnswer = buildCursorAgentTimelineForMessage(input).answer;
  if (timelineAnswer && (live.phase === "streaming_model" || live.phase === "planning_tools")) {
    return null;
  }

  if (live.phase === "streaming_model" || live.phase === "planning_tools") {
    const chars = live.streamChars ?? msg.streamChars ?? 0;
    return chars > 0 ? `思考中 · 已生成 ${chars} 字` : "思考中…";
  }

  const parts: string[] = [];
  const waitingModel =
    live.phase === "waiting_model" ||
    live.phase === "sending_request" ||
    live.phase === "retrying_model";
  if (live.phase === "compacting_context") parts.push("压缩上下文…");
  else if (live.phase === "summarizing_tools") parts.push("整理工具结果…");
  else if (live.phase === "executing_tool" || live.phase === "executing_tools") return null;
  else if (waitingModel) parts.push("等待模型响应…");
  else parts.push("整合信息中…");

  const turn = live.turn ?? msg.agentTurn;
  if (turn) parts.push(`第 ${turn} 轮`);
  if (live.waitStartedAt && waitingModel) {
    const elapsedMs = live.elapsedMs ?? (Date.now() - live.waitStartedAt);
    const elapsed = Math.max(0, Math.floor(elapsedMs / 1000));
    parts.push(`已等待 ${elapsed}s`);
    if (elapsed > 45) parts.push("模型较慢，可取消后 @ 具体文件重试");
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
