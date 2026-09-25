import type { Ref } from "vue";
import type { VibeChatMessage } from "../types/vibeChat";
import type { AgentRunLiveState } from "../services/agentRunLiveState";
import type { SessionAgentRun } from "./agentSessionRuns";
import { TextToolCallStreamFilter } from "../services/textToolCallMarkup";
import { appendAssistantStreamDelta } from "../services/agentMessageDisplay";
import {
  recordAgentRoundReasoningDelta,
  recordAgentRoundStreamDelta,
  resolveAgentStreamTurn,
} from "../services/agentRoundGroups";
import { syncRoundGroupsPatch } from "../utils/vibeHelpers";
import { debugLog } from "../utils/debugLog";
import { chatScrollProbe } from "../utils/chatScrollProbe";

const RUN_UI_PATCH_MIN_MS = 200;
const RUN_UI_STREAM_PATCH_MIN_MS = 48;

export type RunUiPatchKind = "light" | "full";

export type UseAgentStreamPatchDeps = {
  chatSending: Ref<boolean>;
  isChatPinnedToBottom: () => boolean;
  scrollChatToBottom: (force?: boolean) => Promise<void>;
  patchAssistantMsg: (id: string, patch: Partial<VibeChatMessage>, sessionId?: string) => void;
  findRunForMsg: (msgOrId: VibeChatMessage | string) => SessionAgentRun<VibeChatMessage> | undefined;
  isAgentRunning: (msg: VibeChatMessage) => boolean;
  isRunVisible: (sessionId: string) => boolean;
  formatLiveStatus: (live: AgentRunLiveState, compact?: boolean) => string;
  bumpLiveRevision: () => void;
  scrollStatusLogToBottomInternal: (msgId: string) => void;
  getRunPhase: (sessionId: string) => string | undefined;
  getRunAssistantMsg: (sessionId: string) => VibeChatMessage | undefined;
};

export type UseAgentStreamPatch = {
  shouldMinimizeRunUiPatch: (msg: VibeChatMessage) => boolean;
  scheduleMinimizedRunUiPatch: (sessionId: string, msgId: string, kind?: RunUiPatchKind) => void;
  flushMinimizedRunUiPatch: (sessionId: string, msgId: string, assistantMsg: VibeChatMessage) => void;
  enqueueStreamDelta: (msgId: string, assistantMsg: VibeChatMessage, delta: string) => void;
  enqueueReasoningDelta: (msgId: string, assistantMsg: VibeChatMessage, delta: string) => void;
  clearStreamDeltaBuffer: (options?: { discard?: boolean; msgId?: string }) => void;
  scheduleStreamScroll: () => void;
  buildRunUiFullPatch: (assistantMsg: VibeChatMessage) => Partial<VibeChatMessage>;
  cleanupTimers: () => void;
};

type PendingRunUiPatch = { sessionId: string; msgId: string; kind: RunUiPatchKind };
/**
 * `turn` is captured when the delta is enqueued (delivery time), never re-resolved
 * at flush time. Turn-bearing events (`turn_request` / `turn_response`) flush on a
 * separate rAF from stream deltas, so reading `assistantMsg.agentTurn` when the
 * buffer flushes can attribute a previous turn's tail tokens to the next turn and
 * interleave them into the wrong round group.
 */
type PendingStreamDelta = { msgId: string; assistantMsg: VibeChatMessage; pending: string; turn: number };
type PendingReasoningDelta = { msgId: string; assistantMsg: VibeChatMessage; pending: string; turn: number };

export function useAgentStreamPatch(deps: UseAgentStreamPatchDeps): UseAgentStreamPatch {
  const {
    chatSending,
    isChatPinnedToBottom,
    scrollChatToBottom,
    patchAssistantMsg,
    findRunForMsg,
    isAgentRunning,
    isRunVisible,
    formatLiveStatus,
    bumpLiveRevision,
    scrollStatusLogToBottomInternal,
    getRunPhase,
    getRunAssistantMsg,
  } = deps;

  let streamDeltaRaf: number | null = null;
  let streamScrollRaf: number | null = null;
  let pendingStreamDelta: PendingStreamDelta | null = null;
  let pendingReasoningDelta: PendingReasoningDelta | null = null;

  let pendingRunUiPatch: PendingRunUiPatch | null = null;
  let runUiPatchTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRunUiPatchAt = 0;
  const streamToolFilters = new Map<string, TextToolCallStreamFilter>();

  function getStreamToolFilter(msgId: string): TextToolCallStreamFilter {
    let filter = streamToolFilters.get(msgId);
    if (!filter) {
      filter = new TextToolCallStreamFilter();
      streamToolFilters.set(msgId, filter);
    }
    return filter;
  }

  function scheduleStreamScroll() {
    if (!chatSending.value) {
      chatScrollProbe("scheduleStreamScroll:skip", { reason: "not-sending" });
      return;
    }
    if (!isChatPinnedToBottom()) {
      chatScrollProbe("scheduleStreamScroll:skip", { reason: "not-pinned" });
      return;
    }
    if (streamScrollRaf !== null) {
      chatScrollProbe("scheduleStreamScroll:skip", { reason: "raf-pending" });
      return;
    }
    chatScrollProbe("scheduleStreamScroll:fire");
    streamScrollRaf = requestAnimationFrame(() => {
      streamScrollRaf = null;
      void scrollChatToBottom();
    });
  }

  function scheduleStreamDeltaFlush() {
    if (streamDeltaRaf !== null) return;
    streamDeltaRaf = requestAnimationFrame(() => {
      streamDeltaRaf = null;
      flushPendingStreamDelta();
      flushPendingReasoningDelta();
    });
  }

  function shouldMinimizeRunUiPatch(msg: VibeChatMessage): boolean {
    return isAgentRunning(msg);
  }

  function buildRunUiLightPatch(assistantMsg: VibeChatMessage): Partial<VibeChatMessage> {
    const run = findRunForMsg(assistantMsg);
    const live = run?.live;
    return {
      content: assistantMsg.content,
      streamChars: live?.streamChars ?? assistantMsg.streamChars,
      contextChars: live?.contextChars ?? assistantMsg.contextChars,
      agentTurn: live?.turn ?? assistantMsg.agentTurn,
      agentMaxTurns: live?.maxTurns ?? assistantMsg.agentMaxTurns,
      agentModel: live?.model ?? assistantMsg.agentModel,
      agentPhase: live?.phase ?? assistantMsg.agentPhase,
      status: live ? formatLiveStatus(live) : assistantMsg.status,
      ...syncRoundGroupsPatch(assistantMsg),
    };
  }

  function buildRunUiFullPatch(assistantMsg: VibeChatMessage): Partial<VibeChatMessage> {
    const run = findRunForMsg(assistantMsg);
    const live = run?.live;
    return {
      content: assistantMsg.content,
      tools: assistantMsg.tools?.length ? [...assistantMsg.tools] : undefined,
      turnTraces: assistantMsg.turnTraces?.length ? [...assistantMsg.turnTraces] : undefined,
      statusLog: assistantMsg.statusLog?.length ? [...assistantMsg.statusLog] : undefined,
      streamChars: live?.streamChars ?? assistantMsg.streamChars,
      contextChars: live?.contextChars ?? assistantMsg.contextChars,
      agentTurn: live?.turn ?? assistantMsg.agentTurn,
      agentMaxTurns: live?.maxTurns ?? assistantMsg.agentMaxTurns,
      agentModel: live?.model ?? assistantMsg.agentModel,
      agentPhase: live?.phase ?? assistantMsg.agentPhase,
      status: live ? formatLiveStatus(live) : assistantMsg.status,
      ...syncRoundGroupsPatch(assistantMsg),
    };
  }

  function flushPendingRunUiPatch() {
    runUiPatchTimer = null;
    const pending = pendingRunUiPatch;
    pendingRunUiPatch = null;
    if (!pending) return;
    const assistantMsg = getRunAssistantMsg(pending.sessionId);
    if (!assistantMsg) return;
    const patch =
      pending.kind === "full"
        ? buildRunUiFullPatch(assistantMsg)
        : buildRunUiLightPatch(assistantMsg);
    patchAssistantMsg(pending.msgId, patch, pending.sessionId);
    lastRunUiPatchAt = Date.now();
    if (isRunVisible(pending.sessionId)) {
      scheduleStreamScroll();
    }
    bumpLiveRevision();
  }

  function scheduleMinimizedRunUiPatch(
    sessionId: string,
    msgId: string,
    kind: RunUiPatchKind = "light",
  ) {
    if (pendingRunUiPatch) {
      pendingRunUiPatch = {
        sessionId,
        msgId,
        kind: pendingRunUiPatch.kind === "full" || kind === "full" ? "full" : "light",
      };
    } else {
      pendingRunUiPatch = { sessionId, msgId, kind };
    }
    const elapsed = Date.now() - lastRunUiPatchAt;
    const streaming = getRunPhase(sessionId) === "streaming_model";
    const minPatchMs = kind === "light" && streaming ? RUN_UI_STREAM_PATCH_MIN_MS : RUN_UI_PATCH_MIN_MS;
    if ((kind === "full" || (kind === "light" && streaming)) && elapsed >= minPatchMs) {
      if (runUiPatchTimer) {
        clearTimeout(runUiPatchTimer);
        runUiPatchTimer = null;
      }
      flushPendingRunUiPatch();
      return;
    }
    if (runUiPatchTimer) return;
    runUiPatchTimer = setTimeout(flushPendingRunUiPatch, Math.max(0, minPatchMs - elapsed));
  }

  function flushMinimizedRunUiPatch(sessionId: string, msgId: string, assistantMsg: VibeChatMessage) {
    if (runUiPatchTimer) {
      clearTimeout(runUiPatchTimer);
      runUiPatchTimer = null;
    }
    pendingRunUiPatch = null;
    patchAssistantMsg(msgId, buildRunUiFullPatch(assistantMsg), sessionId);
    lastRunUiPatchAt = Date.now();
  }

  function flushPendingStreamDelta() {
    if (!pendingStreamDelta?.pending) return;

    const { msgId, assistantMsg, turn } = pendingStreamDelta;
    const delta = pendingStreamDelta.pending;
    pendingStreamDelta.pending = "";
    const cleanDelta = getStreamToolFilter(msgId).push(delta);

    debugLog("[streamPatch] flushPendingStreamDelta", {
      msgId: msgId.slice(0, 20),
      deltaLen: delta.length,
      delta: delta.slice(0, 50),
      cleanDelta: cleanDelta?.slice(0, 50),
      existingContentLen: (assistantMsg.content || "").length,
      agentTurn: assistantMsg.agentTurn,
      bufferedTurn: turn,
      turnStale: turn !== assistantMsg.agentTurn,
    });

    const run = findRunForMsg(assistantMsg);
    const minimizing = shouldMinimizeRunUiPatch(assistantMsg);
    if (cleanDelta) {
      assistantMsg.content = appendAssistantStreamDelta(assistantMsg.content || "", cleanDelta);
    }
    if (minimizing) {
      const nextStreamChars = (assistantMsg.streamChars || run?.live.streamChars || 0) + delta.length;
      assistantMsg.streamChars = nextStreamChars;
      if (run) run.live.streamChars = nextStreamChars;
      assistantMsg.roundGroups = recordAgentRoundStreamDelta(
        assistantMsg.roundGroups,
        turn,
        cleanDelta,
        assistantMsg.agentMaxTurns ?? run?.live.maxTurns,
      );
      if (run) scheduleMinimizedRunUiPatch(run.sessionId, msgId, "light");
      if (cleanDelta) bumpLiveRevision();
      scheduleStreamScroll();
      return;
    }

    assistantMsg.streamChars = (assistantMsg.streamChars || 0) + delta.length;
    if (run) run.live.streamChars = assistantMsg.streamChars;

    assistantMsg.roundGroups = recordAgentRoundStreamDelta(
      assistantMsg.roundGroups,
      turn,
      cleanDelta,
      assistantMsg.agentMaxTurns,
    );
    patchAssistantMsg(msgId, {
      streamChars: assistantMsg.streamChars,
      content: assistantMsg.content,
      ...syncRoundGroupsPatch(assistantMsg),
    });
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
    scheduleStreamScroll();
    bumpLiveRevision();
  }

  function enqueueStreamDelta(msgId: string, assistantMsg: VibeChatMessage, delta: string) {
    const turn = resolveStreamTurn(assistantMsg);
    // A new turn starts while the previous turn's tail is still buffered: flush it
    // under its own (stamped) turn before this turn's deltas share the buffer.
    if (pendingStreamDelta && (pendingStreamDelta.msgId !== msgId || pendingStreamDelta.turn !== turn)) {
      flushPendingStreamDelta();
    }
    if (!pendingStreamDelta?.pending) {
      pendingStreamDelta = { msgId, assistantMsg, pending: "", turn };
    }
    pendingStreamDelta.pending += delta;
    scheduleStreamDeltaFlush();
  }

  /**
   * Reasoning/thinking deltas ride their own buffer: they land on
   * `roundGroups[].reasoning` and never touch `content`.
   */
  function resolveStreamTurn(assistantMsg: VibeChatMessage): number {
    const run = findRunForMsg(assistantMsg);
    return resolveAgentStreamTurn({
      agentTurn: assistantMsg.agentTurn,
      liveTurn: run?.live.turn,
    });
  }

  function flushPendingReasoningDelta() {
    if (!pendingReasoningDelta?.pending) return;
    const { msgId, assistantMsg, pending, turn } = pendingReasoningDelta;
    pendingReasoningDelta.pending = "";
    const run = findRunForMsg(assistantMsg);
    assistantMsg.roundGroups = recordAgentRoundReasoningDelta(
      assistantMsg.roundGroups,
      turn,
      pending,
      assistantMsg.agentMaxTurns ?? run?.live.maxTurns,
    );
    if (shouldMinimizeRunUiPatch(assistantMsg)) {
      if (run) scheduleMinimizedRunUiPatch(run.sessionId, msgId, "light");
      bumpLiveRevision();
      return;
    }
    patchAssistantMsg(msgId, syncRoundGroupsPatch(assistantMsg));
    scheduleStreamScroll();
    bumpLiveRevision();
  }

  function enqueueReasoningDelta(msgId: string, assistantMsg: VibeChatMessage, delta: string) {
    if (!delta) return;
    const turn = resolveStreamTurn(assistantMsg);
    if (pendingReasoningDelta && (pendingReasoningDelta.msgId !== msgId || pendingReasoningDelta.turn !== turn)) {
      flushPendingReasoningDelta();
    }
    if (!pendingReasoningDelta?.pending) {
      pendingReasoningDelta = { msgId, assistantMsg, pending: "", turn };
    }
    pendingReasoningDelta.pending += delta;
    scheduleStreamDeltaFlush();
  }

  function clearStreamDeltaBuffer(options?: { discard?: boolean; msgId?: string }) {
    if (options?.discard) {
      if (streamDeltaRaf !== null) {
        cancelAnimationFrame(streamDeltaRaf);
        streamDeltaRaf = null;
      }
      const id = options.msgId ?? pendingStreamDelta?.msgId;
      if (id) streamToolFilters.delete(id);
      pendingStreamDelta = null;
      pendingReasoningDelta = null;
      return;
    }
    flushPendingStreamDelta();
    flushPendingReasoningDelta();
    if (pendingStreamDelta) {
      const { msgId, assistantMsg } = pendingStreamDelta;
      const filter = streamToolFilters.get(msgId);
      if (filter) {
        assistantMsg.content = filter.getVisibleText();
        streamToolFilters.delete(msgId);
      }
    }
    pendingStreamDelta = null;
    pendingReasoningDelta = null;
  }

  function cleanupTimers() {
    if (streamDeltaRaf !== null) {
      cancelAnimationFrame(streamDeltaRaf);
      streamDeltaRaf = null;
    }
    if (streamScrollRaf !== null) {
      cancelAnimationFrame(streamScrollRaf);
      streamScrollRaf = null;
    }
    if (runUiPatchTimer) {
      clearTimeout(runUiPatchTimer);
      runUiPatchTimer = null;
    }
  }

  return {
    shouldMinimizeRunUiPatch,
    scheduleMinimizedRunUiPatch,
    flushMinimizedRunUiPatch,
    enqueueStreamDelta,
    enqueueReasoningDelta,
    clearStreamDeltaBuffer,
    scheduleStreamScroll,
    buildRunUiFullPatch,
    cleanupTimers,
  };
}
