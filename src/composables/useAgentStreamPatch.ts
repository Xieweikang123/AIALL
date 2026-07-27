import type { Ref } from "vue";
import type { VibeChatMessage } from "../types/vibeChat";
import type { AgentRunLiveState } from "../services/agentRunLiveState";
import type { SessionAgentRun } from "./agentSessionRuns";
import { TextToolCallStreamFilter } from "../services/textToolCallMarkup";
import { appendAssistantStreamDelta } from "../services/agentMessageDisplay";
import { recordAgentRoundStreamDelta } from "../services/agentRoundGroups";
import { syncRoundGroupsPatch } from "../utils/vibeHelpers";
import { debugLog } from "../utils/debugLog";

const STREAM_SCROLL_THROTTLE_MS = 120;
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
  clearStreamDeltaBuffer: (options?: { discard?: boolean; msgId?: string }) => void;
  scheduleStreamScroll: () => void;
  buildRunUiFullPatch: (assistantMsg: VibeChatMessage) => Partial<VibeChatMessage>;
  cleanupTimers: () => void;
};

type PendingRunUiPatch = { sessionId: string; msgId: string; kind: RunUiPatchKind };
type PendingStreamDelta = { msgId: string; assistantMsg: VibeChatMessage; pending: string };

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
  let streamScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingStreamDelta: PendingStreamDelta | null = null;

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
    if (!chatSending.value || !isChatPinnedToBottom()) return;
    if (streamScrollTimer) return;
    streamScrollTimer = setTimeout(() => {
      streamScrollTimer = null;
      void scrollChatToBottom();
    }, STREAM_SCROLL_THROTTLE_MS);
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
    if (streamDeltaRaf !== null) {
      cancelAnimationFrame(streamDeltaRaf);
      streamDeltaRaf = null;
    }
    if (!pendingStreamDelta?.pending) return;

    const { msgId, assistantMsg } = pendingStreamDelta;
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
      const turn = assistantMsg.agentTurn ?? run?.live.turn ?? 1;
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

    const turn = assistantMsg.agentTurn ?? 1;
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
    if (!pendingStreamDelta || pendingStreamDelta.msgId !== msgId) {
      flushPendingStreamDelta();
      pendingStreamDelta = { msgId, assistantMsg, pending: "" };
    }
    pendingStreamDelta.pending += delta;
    if (streamDeltaRaf !== null) return;
    streamDeltaRaf = requestAnimationFrame(() => {
      streamDeltaRaf = null;
      flushPendingStreamDelta();
    });
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
      return;
    }
    flushPendingStreamDelta();
    if (pendingStreamDelta) {
      const { msgId, assistantMsg } = pendingStreamDelta;
      const filter = streamToolFilters.get(msgId);
      if (filter) {
        assistantMsg.content = filter.getVisibleText();
        streamToolFilters.delete(msgId);
      }
    }
    pendingStreamDelta = null;
  }

  function cleanupTimers() {
    if (streamDeltaRaf !== null) {
      cancelAnimationFrame(streamDeltaRaf);
      streamDeltaRaf = null;
    }
    if (streamScrollTimer) {
      clearTimeout(streamScrollTimer);
      streamScrollTimer = null;
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
    clearStreamDeltaBuffer,
    scheduleStreamScroll,
    buildRunUiFullPatch,
    cleanupTimers,
  };
}
