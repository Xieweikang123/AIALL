import {
  createInitialLiveState,
  patchLiveFromStatusEvent,
  type AgentRunLiveState,
} from "../services/agentRunLiveState";
import type { AgentStatusData } from "../types/vibeChat";

/** Per-session Agent SSE run slots (supports concurrent runs across sessions). */
export type SessionAgentRun<TMsg = unknown> = {
  sessionId: string;
  assistantMsgId: string;
  assistantMsg: TMsg;
  abortHandle: { abort: () => void } | null;
  generation: number;
  lastProgressAt: number;
  connectStartedAt: number;
  connectHasImages: boolean;
  /** Ephemeral UI / progress — cleared when run slot is removed. */
  live: AgentRunLiveState;
};

export function createAgentSessionRunManager<TMsg = unknown>() {
  let globalGeneration = 0;
  const runs = new Map<string, SessionAgentRun<TMsg>>();

  function start(
    sessionId: string,
    assistantMsgId: string,
    assistantMsg: TMsg,
    connectHasImages: boolean,
    initialPhase = "preparing",
  ): number {
    globalGeneration += 1;
    runs.set(sessionId, {
      sessionId,
      assistantMsgId,
      assistantMsg,
      abortHandle: null,
      generation: globalGeneration,
      lastProgressAt: Date.now(),
      connectStartedAt: Date.now(),
      connectHasImages,
      live: createInitialLiveState(initialPhase),
    });
    return globalGeneration;
  }

  function get(sessionId: string): SessionAgentRun<TMsg> | undefined {
    return runs.get(sessionId);
  }

  function findByAssistantMsgId(assistantMsgId: string): SessionAgentRun<TMsg> | undefined {
    for (const run of runs.values()) {
      if (run.assistantMsgId === assistantMsgId) return run;
    }
    return undefined;
  }

  function has(sessionId: string): boolean {
    return runs.has(sessionId);
  }

  function isValid(sessionId: string, generation: number): boolean {
    return runs.get(sessionId)?.generation === generation;
  }

  function setAbortHandle(sessionId: string, handle: { abort: () => void } | null) {
    const run = runs.get(sessionId);
    if (run) run.abortHandle = handle;
  }

  function applyStatus(
    sessionId: string,
    phase: string,
    extra?: Partial<AgentStatusData> & { toolTitle?: string; toolDetail?: string },
  ): AgentRunLiveState | undefined {
    const run = runs.get(sessionId);
    if (!run) return undefined;
    run.live = patchLiveFromStatusEvent(run.live, phase, extra);
    return run.live;
  }

  function setLive(sessionId: string, patch: Partial<AgentRunLiveState>) {
    const run = runs.get(sessionId);
    if (!run) return;
    Object.assign(run.live, patch);
  }

  function invalidate(sessionId: string) {
    const run = runs.get(sessionId);
    if (run) run.generation = ++globalGeneration;
  }

  function remove(sessionId: string) {
    runs.delete(sessionId);
  }

  function size(): number {
    return runs.size;
  }

  function abort(sessionId: string) {
    runs.get(sessionId)?.abortHandle?.abort();
  }

  function touchProgress(sessionId: string) {
    const run = runs.get(sessionId);
    if (run) run.lastProgressAt = Date.now();
  }

  function getActiveAbortHandle(activeSessionId: string): { abort: () => void } | null {
    return runs.get(activeSessionId)?.abortHandle ?? null;
  }

  function listRuns(): SessionAgentRun<TMsg>[] {
    return [...runs.values()];
  }

  function setConnectHasImages(sessionId: string, value: boolean) {
    const run = runs.get(sessionId);
    if (run) run.connectHasImages = value;
  }

  function getGeneration(sessionId: string): number {
    return runs.get(sessionId)?.generation ?? 0;
  }

  return {
    start,
    get,
    findByAssistantMsgId,
    has,
    isValid,
    setAbortHandle,
    applyStatus,
    setLive,
    setConnectHasImages,
    getGeneration,
    invalidate,
    remove,
    size,
    abort,
    touchProgress,
    getActiveAbortHandle,
    listRuns,
  };
}
