import { debugLog } from "./debugLog";
import { isSessionRecentlyDeletedLocally } from "../services/vibeChatStorage";

const TAG = "[session-diag]";

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
  const projectPath = typeof data.projectPath === "string" ? data.projectPath.trim() : "";
  if (!projectPath) return {};
  const hints: Record<string, unknown> = {};
  for (const id of extractSessionIds(data)) {
    if (isSessionRecentlyDeletedLocally(projectPath, id)) {
      hints.resurrection = true;
      hints.resurrectedSessionId = id;
      break;
    }
  }
  return hints;
}

export function sessionDiag(event: string, data: Record<string, unknown> = {}) {
  const payload = { ...data, ...resurrectionHints(data) };
  debugLog(`${TAG} ${event}`, payload);
}

export type SessionDiagSnapshot = {
  activeSessionId: string;
  memorySessionIds: string[];
  indexSessionIds: string[];
  listSessionIds: string[];
};
