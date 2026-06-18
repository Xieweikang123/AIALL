/** In-memory per-session message lists (keeps object refs for background agent runs). */
export function useSessionMessageCache<T extends { id: string }>() {
  const cache = new Map<string, T[]>();

  function snapshot(sessionId: string, messages: T[]) {
    if (!sessionId) return;
    cache.set(sessionId, messages);
  }

  function get(sessionId: string): T[] | undefined {
    return cache.get(sessionId);
  }

  function has(sessionId: string): boolean {
    return cache.has(sessionId);
  }

  function patchMessage(sessionId: string, msgId: string, patch: Partial<T>) {
    const list = cache.get(sessionId);
    if (!list) return;
    const idx = list.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    list[idx] = { ...list[idx], ...patch };
  }

  function clearSession(sessionId: string) {
    cache.delete(sessionId);
  }

  function clearAll() {
    cache.clear();
  }

  return { snapshot, get, has, patchMessage, clearSession, clearAll };
}
