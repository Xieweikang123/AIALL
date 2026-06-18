import { debugLog } from "./debugLog";

const TAG = "[session-diag]";
const DEBUG_SESSION = "afe7ec";
const DEBUG_INGEST =
  "http://127.0.0.1:7681/ingest/c6f6b2fb-2f39-4dd4-897b-699ca68db244";
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

function inferHypothesisId(event: string, data: Record<string, unknown>): string {
  if (event.includes("persist-chat-now:delayed") || event.includes("sync-chat-session")) return "H1";
  if (event.includes("flush-chat-store") || event.includes("chat-store-sync")) return "H2";
  if (
    event.includes("hydrate-from-disk")
    || event.includes("load-full-chat-store")
    || event.includes("merge-from-disk")
    || event.includes("chat-store-load")
    || event.includes("ensure-chat-from-disk")
  ) return "H3";
  if (event.includes("save-new-session")) return "H4";
  if (event.includes("cacheHit") || (event.includes("chat-store-load") && data.cacheHit)) return "H5";
  if (event.includes("refresh-session-list:added")) return "H0";
  if (event.includes("delete")) return "H0";
  return "H0";
}

function emitDebugNdjson(event: string, data: Record<string, unknown>) {
  const payload = { ...data, ...resurrectionHints(data) };
  const hypothesisId = inferHypothesisId(event, payload);
  // #region agent log
  fetch(DEBUG_INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": DEBUG_SESSION },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION,
      hypothesisId,
      location: `sessionDiagLog:${event}`,
      message: event,
      data: payload,
      timestamp: Date.now(),
      runId: "pre-fix",
    }),
  }).catch(() => {});
  // #endregion
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
  emitDebugNdjson(event, data);
}

export type SessionDiagSnapshot = {
  activeSessionId: string;
  memorySessionIds: string[];
  indexSessionIds: string[];
  listSessionIds: string[];
};
