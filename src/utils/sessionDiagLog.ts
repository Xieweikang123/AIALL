import { debugLog } from "./debugLog";

const TAG = "[session-diag]";
const recentlyDeleted = new Map<string, number>();
const DELETED_TTL_MS = 120_000;

function pruneDeleted() {
  const now = Date.now();
  for (const [id, ts] of recentlyDeleted) {
    if (now - ts > DELETED_TTL_MS) recentlyDeleted.delete(id);
  }
}

function extractSessionIds(data: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (typeof data.sessionId === "string" && data.sessionId) ids.push(data.sessionId);
  if (typeof data.deletedSessionId === "string" && data.deletedSessionId) ids.push(data.deletedSessionId);
  if (Array.isArray(data.sessionIds)) {
    for (const id of data.sessionIds) {
      if (typeof id === "string" && id) ids.push(id);
    }
  }
  if (Array.isArray(data.sessions)) {
    for (const s of data.sessions) {
      if (s && typeof s === "object" && "id" in s && typeof (s as { id: unknown }).id === "string") {
        ids.push((s as { id: string }).id);
      }
    }
  }
  return [...new Set(ids)];
}

function resurrectionHints(data: Record<string, unknown>): Record<string, unknown> {
  pruneDeleted();
  const hints: Record<string, unknown> = {};
  for (const id of extractSessionIds(data)) {
    const deletedAt = recentlyDeleted.get(id);
    if (deletedAt !== undefined) {
      hints.resurrection = true;
      hints.resurrectedSessionId = id;
      hints.deletedAgoMs = Date.now() - deletedAt;
      break;
    }
  }
  return hints;
}

/** 删除会话时登记，供后续日志检测「复活」。 */
export function markSessionDeleted(sessionId: string) {
  if (!sessionId) return;
  recentlyDeleted.set(sessionId, Date.now());
  sessionDiag("delete:marked", { sessionId });
}

export function sessionDiag(event: string, data: Record<string, unknown> = {}) {
  const payload = { ...data, ...resurrectionHints(data) };
  debugLog(TAG, event, payload);
}

export type SessionDiagSnapshot = {
  activeSessionId: string;
  memorySessionIds: string[];
  indexSessionIds: string[];
  listSessionIds: string[];
};
