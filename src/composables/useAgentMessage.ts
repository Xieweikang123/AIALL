import { computed, type Ref } from "vue";
import { cursorPlanningLabel, shouldUseCompactAgentFeed as shouldUseCompactAgentFeedByCount } from "../services/agentCursorFeed";
import { resolveAgentTimelineAnswer, isAgentTimelineAnswerStreaming } from "../services/agentMessageDisplay";
import { buildAgentRoundGroupViews } from "../services/agentRoundGroups";
import { hasAgentActivity, hasAgentDebugDetails, hasRunningTool } from "../utils/vibeHelpers";
import { createAgentActivityActions } from "./agentActivityPatch";
import type { AgentMessage, UseAgentMessageOptions } from "./useAgentMessageTypes";

export type { AgentMessage, UseAgentMessageOptions };

export function useAgentMessage(
  msg: Ref<AgentMessage>,
  options: UseAgentMessageOptions,
) {
  const {
    isAgentRunning,
    agentUiTick,
    patchAssistantMsg,
    schedulePersistChat,
    messageDisplayContent,
    resolveLiveAgentSource,
  } = options;

  const activity = createAgentActivityActions(patchAssistantMsg, schedulePersistChat);

  function liveAgentSource(m: AgentMessage) {
    return (
      resolveLiveAgentSource?.(m) ?? {
        content: m.content,
        roundGroups: m.roundGroups,
        turnTraces: m.turnTraces,
        agentTurn: m.agentTurn,
        agentPhase: m.agentPhase,
      }
    );
  }

  function agentRoundGroupViews(m: AgentMessage) {
    void agentUiTick.value;
    const live = liveAgentSource(m);
    return buildAgentRoundGroupViews({
      roundGroups: m.roundGroups,
      turnTraces: m.turnTraces,
      statusLog: m.statusLog,
      tools: m.tools,
      activeTurn: isAgentRunning(m) ? live.agentTurn : undefined,
      activePhase: isAgentRunning(m) ? live.agentPhase : undefined,
    });
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
    return resolveAgentTimelineAnswer(
      liveAgentSource(m),
      messageDisplayContent(m),
      isAgentRunning(m),
      hasRunningTool(m),
    );
  }

  function timelineAnswerContent(m: AgentMessage): string {
    if (m.role !== "assistant" || !hasAgentActivity(m)) return "";
    return agentAnswerPreview(m);
  }

  const timelineAnswerDisplay = computed(() => {
    void agentUiTick.value;
    return timelineAnswerContent(msg.value);
  });

  const timelineAnswerStreamingDisplay = computed(() => {
    void agentUiTick.value;
    return timelineAnswerStreaming(msg.value);
  });

  function timelineAnswerStreaming(m: AgentMessage): boolean {
    return isAgentTimelineAnswerStreaming(
      liveAgentSource(m),
      isAgentRunning(m),
      hasRunningTool(m),
    );
  }

  function currentAgentStatus(m: AgentMessage): string {
    if (!isAgentRunning(m)) return "";
    if (timelineAnswerStreaming(m)) return "";
    if (m.status?.trim()) return m.status.trim();
    const planning = cursorPlanningLabel(m.agentPhase, m.agentDetail);
    if (planning) return planning;
    return m.agentDetail?.trim() || "";
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

  return {
    isFolded: computed(() => !isAgentRunning(msg.value) && !isActivityExpanded(msg.value)),
    showDebug: computed(() => hasAgentDebugDetails(msg.value)),
    showCompact: computed(() => shouldUseCompactAgentFeed(msg.value)),
    hasAgentActivity,
    hasAgentDebugDetails,
    isActivityExpanded,
    isActivityDetailed,
    shouldUseCompactAgentFeed,
    timelineAnswerDisplay,
    timelineAnswerStreaming,
    timelineAnswerStreamingDisplay,
    currentAgentStatus,
    cursorActivitySummary,
    agentRoundGroupViews,
    toggleActivityExpanded: activity.toggleActivityExpanded,
    collapseAgentActivity: activity.collapseAgentActivity,
    toggleActivityDetailed: activity.toggleActivityDetailed,
  };
}
