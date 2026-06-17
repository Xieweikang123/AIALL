import { computed, type Ref } from "vue";
import {
  buildCursorAgentFeed,
  buildCursorAgentTimeline,
  shouldUseCompactAgentFeed as shouldUseCompactAgentFeedByCount,
  type CursorFeedProcessBlock,
} from "../services/agentCursorFeed";
import { filterDuplicateFeedThoughts, resolveAgentTimelineAnswer, isAgentTimelineAnswerStreaming } from "../services/agentMessageDisplay";
import { buildAgentRoundGroupViews } from "../services/agentRoundGroups";
import type { AgentMessage, UseAgentMessageOptions } from "./useAgentMessageTypes";

export type { AgentMessage, UseAgentMessageOptions };

export function useAgentMessage(
  msg: Ref<AgentMessage>,
  options: UseAgentMessageOptions,
) {
  const { isAgentRunning, agentUiTick, patchAssistantMsg, schedulePersistChat, messageDisplayContent } = options;

  function agentRoundGroupViews(m: AgentMessage) {
    void agentUiTick.value;
    return buildAgentRoundGroupViews({
      roundGroups: m.roundGroups,
      turnTraces: m.turnTraces,
      statusLog: m.statusLog,
      tools: m.tools,
      activeTurn: isAgentRunning(m) ? m.agentTurn : undefined,
      activePhase: isAgentRunning(m) ? m.agentPhase : undefined,
    });
  }

  function hasAgentActivity(m: AgentMessage): boolean {
    return Boolean(
      m.agentContext ||
        m.roundGroups?.length ||
        m.statusLog?.length ||
        m.turnTraces?.length ||
        m.status ||
        m.tools?.length ||
        m.agentTurn ||
        m.totalTurns,
    );
  }

  function hasAgentProcessSteps(m: AgentMessage): boolean {
    return Boolean(
      m.tools?.length ||
        m.roundGroups?.some(
          (group: any) => group.turn > 0 && ((group.toolIds?.length ?? 0) > 0 || group.modelSteps.length > 0),
        ),
    );
  }

  function hasAgentDebugDetails(m: AgentMessage): boolean {
    return Boolean(
      m.agentContext ||
        m.roundGroups?.some(
          (group: any) => group.turn > 0 && (group.request || group.response || group.modelSteps.length),
        ),
    );
  }

  function isActivityExpanded(m: AgentMessage): boolean {
    if (isAgentRunning(m)) return true;
    return m.activityExpanded === true;
  }

  function isActivityDetailed(m: AgentMessage): boolean {
    return m.activityDetailed === true;
  }

  function shouldUseCompactAgentFeed(m: AgentMessage): boolean {
    const stepCount = m.tools?.length ?? 0;
    return shouldUseCompactAgentFeedByCount(stepCount, isAgentRunning(m), isActivityDetailed(m));
  }

  function agentAnswerPreview(m: AgentMessage): string {
    const hasRunningTool = Boolean(m.tools?.some((t: { running?: boolean }) => t.running));
    return resolveAgentTimelineAnswer(
      { content: m.content, roundGroups: m.roundGroups, turnTraces: m.turnTraces, agentTurn: m.agentTurn },
      messageDisplayContent(m),
      isAgentRunning(m),
      hasRunningTool,
    );
  }

  function cursorAgentFeed(m: AgentMessage) {
    void agentUiTick.value;
    let agentDetail = m.agentDetail || m.status;
    if (
      isAgentRunning(m) &&
      m.agentPhase &&
      ["connecting_local", "stream_connected", "connected", "reconnecting", "preparing", "starting", "building_context"].includes(m.agentPhase)
    ) {
      agentDetail = `${m.agentDetail || (m.agentPhase === "connecting_local" ? "连接本地服务" : "启动 Agent")}`;
    }
    const bubble = agentAnswerPreview(m);
    const items = buildCursorAgentFeed({
      groups: agentRoundGroupViews(m),
      isRunning: isAgentRunning(m),
      agentPhase: m.agentPhase,
      agentDetail,
      answerPreview: bubble,
      streaming: isAgentTimelineAnswerStreaming(
        { roundGroups: m.roundGroups, agentTurn: m.agentTurn },
        isAgentRunning(m),
        Boolean(m.tools?.some((t: { running?: boolean }) => t.running)),
      ),
    });
    return filterDuplicateFeedThoughts(items, bubble);
  }

  function cursorAgentTimeline(m: AgentMessage) {
    const detailed = isActivityDetailed(m);
    const hasRunningTool = Boolean(m.tools?.some((t: { running?: boolean }) => t.running));
    return buildCursorAgentTimeline(cursorAgentFeed(m), agentAnswerPreview(m), {
      keepVisible: detailed ? 8 : 6,
      collapseAfter: detailed ? 10 : 5,
      compactWhileRunning: isAgentRunning(m) && detailed,
      streaming: isAgentTimelineAnswerStreaming(
        { roundGroups: m.roundGroups, agentTurn: m.agentTurn },
        isAgentRunning(m),
        hasRunningTool,
      ),
    });
  }

  function cursorAgentFeedBlocks(m: AgentMessage): CursorFeedProcessBlock[] {
    return cursorAgentTimeline(m).processBlocks;
  }

  function cursorAgentFeedAnswer(m: AgentMessage) {
    void agentUiTick.value;
    return cursorAgentTimeline(m).answer;
  }

  function timelineAnswerContent(m: AgentMessage): string {
    if (m.role !== "assistant" || !hasAgentActivity(m)) return "";
    return agentAnswerPreview(m);
  }

  function timelineAnswerStreaming(m: AgentMessage): boolean {
    return isAgentTimelineAnswerStreaming(
      { roundGroups: m.roundGroups, agentTurn: m.agentTurn },
      isAgentRunning(m),
      Boolean(m.tools?.some((t: { running?: boolean }) => t.running)),
    );
  }

  function currentAgentStatus(m: AgentMessage): string {
    if (!isAgentRunning(m)) return "";
    if (timelineAnswerStreaming(m)) return "";
    let detail = m.agentDetail || m.status;
    if (
      m.agentPhase &&
      ["connecting_local", "stream_connected", "connected", "reconnecting", "preparing", "starting", "building_context"].includes(m.agentPhase)
    ) {
      detail = m.agentDetail || (m.agentPhase === "connecting_local" ? "连接本地服务" : "启动 Agent");
    }
    return detail || "";
  }

  function cursorActivitySummary(m: AgentMessage): string {
    const actions = m.tools?.length ?? 0;
    const last = m.tools?.[m.tools.length - 1];
    if (last && !last.running) {
      return `展开过程 · ${actions} 步 · ${last.label || last.name}`;
    }
    if (actions > 0) return `展开过程 · ${actions} 步`;
    if (m.totalTurns) return `展开过程 · ${m.totalTurns} 轮`;
    return "展开过程";
  }

  function toggleActivityExpanded(m: AgentMessage) {
    m.activityExpanded = !m.activityExpanded;
    patchAssistantMsg(m.id, { activityExpanded: m.activityExpanded });
    schedulePersistChat();
  }

  function collapseAgentActivity(m: AgentMessage) {
    m.activityExpanded = false;
    patchAssistantMsg(m.id, { activityExpanded: false });
    schedulePersistChat();
  }

  function toggleActivityDetailed(m: AgentMessage) {
    m.activityDetailed = true;
    patchAssistantMsg(m.id, { activityDetailed: true });
    schedulePersistChat();
  }

  function collapseActivityDetailed(m: AgentMessage) {
    m.activityDetailed = false;
    patchAssistantMsg(m.id, { activityDetailed: false });
    schedulePersistChat();
  }

  const isFolded = computed(() => !isAgentRunning(msg.value) && !isActivityExpanded(msg.value));
  const blocks = computed(() => cursorAgentFeedBlocks(msg.value));
  const answer = computed(() => cursorAgentFeedAnswer(msg.value));
  const showDebug = computed(() => hasAgentDebugDetails(msg.value) && !shouldUseCompactAgentFeed(msg.value));
  const showCompact = computed(() => shouldUseCompactAgentFeed(msg.value));
  const hasProcessSteps = computed(() => hasAgentProcessSteps(msg.value));

  return {
    isFolded,
    blocks,
    answer,
    showDebug,
    showCompact,
    hasProcessSteps,
    hasAgentActivity,
    hasAgentProcessSteps,
    hasAgentDebugDetails,
    isActivityExpanded,
    isActivityDetailed,
    shouldUseCompactAgentFeed,
    cursorAgentFeedBlocks,
    cursorAgentFeedAnswer,
    timelineAnswerContent,
    timelineAnswerStreaming,
    currentAgentStatus,
    cursorActivitySummary,
    agentRoundGroupViews,
    toggleActivityExpanded,
    collapseAgentActivity,
    toggleActivityDetailed,
    collapseActivityDetailed,
  };
}
