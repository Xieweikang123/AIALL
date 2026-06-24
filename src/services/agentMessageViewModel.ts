import { cursorPlanningLabel } from "./agentCursorFeed";
import {
  isAgentTimelineAnswerStreaming,
  resolveAgentTimelineAnswer,
  type LiveAgentAnswerSource,
} from "./agentMessageDisplay";
import { buildAgentRoundGroupViews, type AgentRoundGroupView } from "./agentRoundGroups";
import type { AgentRunLiveState } from "./agentRunLiveState";
import type { VibeChatMessage } from "../types/vibeChat";
import { hasRunningTool } from "../utils/vibeHelpers";

export type AgentMessageViewContext = {
  isRunning: boolean;
  live?: AgentRunLiveState;
  liveAgentSource: LiveAgentAnswerSource;
  messageDisplayContent: (msg: VibeChatMessage) => string;
};

export function buildAgentRoundGroupViewsForMessage(
  msg: VibeChatMessage,
  ctx: Pick<AgentMessageViewContext, "isRunning" | "live">,
): AgentRoundGroupView[] {
  return buildAgentRoundGroupViews({
    roundGroups: msg.roundGroups,
    turnTraces: msg.turnTraces,
    statusLog: msg.statusLog,
    tools: msg.tools,
    activeTurn: ctx.isRunning ? (ctx.live?.turn ?? msg.agentTurn) : undefined,
    activePhase: ctx.isRunning ? ctx.live?.phase : undefined,
  });
}

export function resolveAgentAnswerPreview(
  msg: VibeChatMessage,
  ctx: AgentMessageViewContext,
): string {
  return resolveAgentTimelineAnswer(
    ctx.liveAgentSource,
    ctx.messageDisplayContent(msg),
    ctx.isRunning,
    hasRunningTool(msg),
  );
}

export function isAgentAnswerStreaming(
  msg: VibeChatMessage,
  ctx: Pick<AgentMessageViewContext, "isRunning" | "liveAgentSource">,
): boolean {
  return isAgentTimelineAnswerStreaming(
    ctx.liveAgentSource,
    ctx.isRunning,
    hasRunningTool(msg),
  );
}

export function buildCursorActivitySummary(msg: VibeChatMessage): string {
  const actions = msg.tools?.length ?? 0;
  const last = msg.tools?.[msg.tools.length - 1];
  if (last && !last.running) {
    return `展开过程 · ${actions} 步 · ${last.label || last.name}`;
  }
  if (actions > 0) return `展开过程 · ${actions} 步`;
  if (msg.totalTurns) return `展开过程 · ${msg.totalTurns} 轮`;
  return "展开过程";
}

export function buildActivitySummary(msg: VibeChatMessage): string {
  const toolCount = msg.tools?.length ?? 0;
  const parts: string[] = [];
  if (msg.totalTurns) parts.push(`${msg.totalTurns} 轮`);
  if (toolCount > 0) {
    const failed = msg.tools?.filter((t) => !t.ok).length ?? 0;
    parts.push(failed > 0 ? `${toolCount} 个工具（${failed} 失败）` : `${toolCount} 个工具`);
  }
  if (msg.turnFileDiffs && Object.keys(msg.turnFileDiffs).length) {
    parts.push(`${Object.keys(msg.turnFileDiffs).length} 个文件变更`);
  }
  return parts.length ? parts.join(" · ") : "查看执行过程";
}

export function resolveCurrentAgentStatus(
  msg: VibeChatMessage,
  ctx: Pick<AgentMessageViewContext, "isRunning" | "liveAgentSource">,
): string {
  if (!ctx.isRunning) return "";
  if (isAgentAnswerStreaming(msg, ctx)) return "";
  if (msg.status?.trim()) return msg.status.trim();
  const planning = cursorPlanningLabel(msg.agentPhase, msg.agentDetail);
  if (planning) return planning;
  return msg.agentDetail?.trim() || "";
}

export function isAgentActivityExpanded(msg: VibeChatMessage, isRunning: boolean): boolean {
  if (isRunning) return true;
  return msg.activityExpanded === true;
}
