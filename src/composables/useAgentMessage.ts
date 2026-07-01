import { computed, type Ref } from "vue";
import type { VibeChatMessage } from "../types/vibeChat";
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

/** Cast AgentMessage to VibeChatMessage for view-model functions. */
function asVibeChatMessage(m: AgentMessage): VibeChatMessage {
  return m as VibeChatMessage;
}

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

  /** Track reactive message fields during a run so stream deltas don't need revision bumps. */
  function trackLiveMessageDeps(m: AgentMessage) {
    void agentLiveRevision.value;
    if (!isAgentRunning(m)) return;
    void m.content;
    void m.streamChars;
    void m.agentPhase;
    void m.agentTurn;
    void m.roundGroups;
    void m.tools?.length;
    void m.status;
  }

  function agentRoundGroupViews(m: AgentMessage) {
    trackLiveMessageDeps(m);
    const liveSource = liveAgentSource(m);
    const running = isAgentRunning(m);
    return buildAgentRoundGroupViewsForMessage(asVibeChatMessage(m), {
      isRunning: running,
      live: running
        ? { phase: liveSource.agentPhase ?? "", turn: liveSource.agentTurn }
        : undefined,
    });
  }

  function isActivityExpanded(m: AgentMessage): boolean {
    return isAgentActivityExpanded(asVibeChatMessage(m), isAgentRunning(m));
  }

  function isActivityDetailed(m: AgentMessage): boolean {
    return m.activityDetailed === true;
  }

  function shouldUseCompactAgentFeed(m: AgentMessage): boolean {
    const stepCount = m.tools?.length ?? 0;
    return shouldUseCompactAgentFeedByCount(stepCount, isAgentRunning(m), isActivityDetailed(m));
  }

  function agentAnswerPreview(m: AgentMessage): string {
    trackLiveMessageDeps(m);
    return resolveAgentAnswerPreview(asVibeChatMessage(m), messageViewContext(m));
  }

  function timelineAnswerContent(m: AgentMessage): string {
    if (m.role !== "assistant" || !hasAgentActivity(m)) return "";
    return agentAnswerPreview(m);
  }

  const timelineAnswerDisplay = computed(() => {
    trackLiveMessageDeps(msg.value);
    return timelineAnswerContent(msg.value);
  });

  const timelineAnswerStreamingDisplay = computed(() => {
    trackLiveMessageDeps(msg.value);
    return timelineAnswerStreaming(msg.value);
  });

  function timelineAnswerStreaming(m: AgentMessage): boolean {
    return isAgentAnswerStreaming(asVibeChatMessage(m), messageViewContext(m));
  }

  function currentAgentStatus(m: AgentMessage): string {
    trackLiveMessageDeps(m);
    return resolveCurrentAgentStatus(asVibeChatMessage(m), messageViewContext(m));
  }

  const cursorActivitySummary = (m: AgentMessage) => buildCursorActivitySummary(asVibeChatMessage(m));

  return {
    isFolded: computed(() => !isAgentRunning(msg.value) && !isActivityExpanded(msg.value)),
    showDebug: computed(() => false),
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
