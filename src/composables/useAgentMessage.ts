import { computed, type Ref } from "vue";
import { shouldUseCompactAgentFeed as shouldUseCompactAgentFeedByCount } from "../services/agentCursorFeed";
import {
  buildAgentRoundGroupViewsForMessage,
  buildCursorActivitySummary,
  isAgentActivityExpanded,
  isAgentAnswerStreaming,
  resolveAgentAnswerPreview,
  resolveCurrentAgentStatus,
} from "../services/agentMessageViewModel";
import { hasAgentActivity, hasAgentDebugDetails } from "../utils/vibeHelpers";
import { createAgentActivityActions } from "./agentActivityPatch";
import type { AgentMessage, UseAgentMessageOptions } from "./useAgentMessageTypes";

export type { AgentMessage, UseAgentMessageOptions };

export function useAgentMessage(
  msg: Ref<AgentMessage>,
  options: UseAgentMessageOptions,
) {
  const {
    isAgentRunning,
    agentLiveRevision,
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

  function messageViewContext(m: AgentMessage) {
    return {
      isRunning: isAgentRunning(m),
      liveAgentSource: liveAgentSource(m),
      messageDisplayContent,
    };
  }

  function agentRoundGroupViews(m: AgentMessage) {
    void agentLiveRevision.value;
    const liveSource = liveAgentSource(m);
    const running = isAgentRunning(m);
    return buildAgentRoundGroupViewsForMessage(m, {
      isRunning: running,
      live: running
        ? { phase: liveSource.agentPhase ?? "", turn: liveSource.agentTurn }
        : undefined,
    });
  }

  function isActivityExpanded(m: AgentMessage): boolean {
    return isAgentActivityExpanded(m, isAgentRunning(m));
  }

  function isActivityDetailed(m: AgentMessage): boolean {
    return m.activityDetailed === true;
  }

  function shouldUseCompactAgentFeed(m: AgentMessage): boolean {
    const stepCount = m.tools?.length ?? 0;
    return shouldUseCompactAgentFeedByCount(stepCount, isAgentRunning(m), isActivityDetailed(m));
  }

  function agentAnswerPreview(m: AgentMessage): string {
    void agentLiveRevision.value;
    return resolveAgentAnswerPreview(m, messageViewContext(m));
  }

  function timelineAnswerContent(m: AgentMessage): string {
    if (m.role !== "assistant" || !hasAgentActivity(m)) return "";
    return agentAnswerPreview(m);
  }

  const timelineAnswerDisplay = computed(() => {
    void agentLiveRevision.value;
    return timelineAnswerContent(msg.value);
  });

  const timelineAnswerStreamingDisplay = computed(() => {
    void agentLiveRevision.value;
    return timelineAnswerStreaming(msg.value);
  });

  function timelineAnswerStreaming(m: AgentMessage): boolean {
    return isAgentAnswerStreaming(m, messageViewContext(m));
  }

  function currentAgentStatus(m: AgentMessage): string {
    void agentLiveRevision.value;
    return resolveCurrentAgentStatus(m, messageViewContext(m));
  }

  const cursorActivitySummary = (m: AgentMessage) => buildCursorActivitySummary(m);

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
