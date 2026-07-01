/** Per-session message lists — single source of truth; active UI ref points into this map. */
export function useSessionMessageRegistry<T>() {
  const bySessionId = new Map<string, T[]>();

  function getSessionMessages(sessionId: string): T[] | undefined {
    const id = sessionId.trim();
    if (!id) return undefined;
    return bySessionId.get(id);
  }

  function setSessionMessages(sessionId: string, messages: T[]): T[] {
    const id = sessionId.trim();
    bySessionId.set(id, messages);
    return messages;
  }

  function getOrCreateSessionMessages(sessionId: string): T[] {
    const id = sessionId.trim();
    if (!bySessionId.has(id)) {
      bySessionId.set(id, []);
    }
    return bySessionId.get(id)!;
  }

  function deleteSessionMessages(sessionId: string) {
    const id = sessionId.trim();
    if (id) bySessionId.delete(id);
  }

  function clearAll() {
    bySessionId.clear();
  }

  function patchSessionMessage(sessionId: string, msgId: string, patch: Partial<T>) {
    const list = getSessionMessages(sessionId);
    if (!list) return;
    const idx = list.findIndex((m) => (m as { id?: string }).id === msgId);
    if (idx < 0) return;
    list[idx] = Object.assign(list[idx] as object, patch) as T;
  }

  return {
    getSessionMessages,
    setSessionMessages,
    getOrCreateSessionMessages,
    deleteSessionMessages,
    clearAll,
    patchSessionMessage,
  };
}
