import { ref } from "vue";
import type { VibeAgentSseEvent } from "../services/vibeAgentClient";
import type { VibeChatMessage } from "../types/vibeChat";

export type ChatMessage = VibeChatMessage;

export interface UseAgentSSEConnectionDeps {
  handleAgentEvent: (
    event: VibeAgentSseEvent,
    assistantMsg: ChatMessage,
    runGen: number,
    sessionId: string,
  ) => void;
}

const AGENT_EVENT_FRAME_BUDGET_MS = 12;

export function useAgentSSEConnection(deps: UseAgentSSEConnectionDeps) {
  const { handleAgentEvent } = deps;

  const pendingAgentEvents: VibeAgentSseEvent[] = [];
  let agentEventFlushRaf = 0;

  function clearPendingAgentEvents() {
    pendingAgentEvents.length = 0;
    if (agentEventFlushRaf) {
      cancelAnimationFrame(agentEventFlushRaf);
      agentEventFlushRaf = 0;
    }
  }

  function flushAgentEventQueue(
    assistantMsg: ChatMessage,
    runGen: number,
    sessionId: string,
  ) {
    agentEventFlushRaf = 0;
    const start = performance.now();
    while (pendingAgentEvents.length > 0) {
      const event = pendingAgentEvents.shift();
      if (!event) continue;
      handleAgentEvent(event, assistantMsg, runGen, sessionId);
      if (performance.now() - start > AGENT_EVENT_FRAME_BUDGET_MS) {
        break;
      }
    }
    if (pendingAgentEvents.length > 0) {
      scheduleAgentEventFlush(assistantMsg, runGen, sessionId);
    }
  }

  function scheduleAgentEventFlush(
    assistantMsg: ChatMessage,
    runGen: number,
    sessionId: string,
  ) {
    if (agentEventFlushRaf) return;
    agentEventFlushRaf = requestAnimationFrame(() => {
      flushAgentEventQueue(assistantMsg, runGen, sessionId);
    });
  }

  function enqueueAgentEvent(
    event: VibeAgentSseEvent,
    assistantMsg: ChatMessage,
    runGen: number,
    sessionId: string,
  ) {
    pendingAgentEvents.push(event);
    scheduleAgentEventFlush(assistantMsg, runGen, sessionId);
  }

  return {
    pendingAgentEvents,
    agentEventFlushRaf,
    clearPendingAgentEvents,
    enqueueAgentEvent,
  };
}
