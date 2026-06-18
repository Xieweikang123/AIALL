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
};

export function createAgentSessionRunManager<TMsg = unknown>() {
  let globalGeneration = 0;
  const runs = new Map<string, SessionAgentRun<TMsg>>();

  function start(
    sessionId: string,
    assistantMsgId: string,
    assistantMsg: TMsg,
    connectHasImages: boolean,
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
    });
    return globalGeneration;
  }

  function get(sessionId: string): SessionAgentRun<TMsg> | undefined {
    return runs.get(sessionId);
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

  return {
    start,
    get,
    has,
    isValid,
    setAbortHandle,
    invalidate,
    remove,
    size,
    abort,
    touchProgress,
    getActiveAbortHandle,
  };
}
