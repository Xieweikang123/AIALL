import type { ChatSessionDeleteResult, ChatStoreSyncResult } from "./vibeCodingClient";
import { deleteChatSessionFromDisk } from "./vibeCodingClient";
import { syncLocalIndexFromRecord } from "./vibeChatStorage";
import { normalizeProjectPath } from "../utils/normalizePath";

const queues = new Map<string, Promise<unknown>>();
const queueDepth = new Map<string, number>();

function queueKey(projectPath: string): string {
  return normalizeProjectPath(projectPath);
}

/** Serialize disk hydrate / flush / delete for one project to prevent merge races. Reentrant-safe. */
export function enqueueChatStoreOp<T>(projectPath: string, op: () => Promise<T>): Promise<T> {
  const key = queueKey(projectPath);
  const depth = queueDepth.get(key) ?? 0;
  if (depth > 0) {
    return op();
  }

  const tail = queues.get(key) ?? Promise.resolve();
  const run = tail.catch(() => {}).then(async () => {
    queueDepth.set(key, (queueDepth.get(key) ?? 0) + 1);
    try {
      return await op();
    } finally {
      const next = (queueDepth.get(key) ?? 1) - 1;
      if (next <= 0) queueDepth.delete(key);
      else queueDepth.set(key, next);
    }
  });
  queues.set(key, run);
  return run;
}

export async function deleteChatSessionOnDisk(
  projectPath: string,
  sessionId: string,
  nextActiveSessionId?: string,
): Promise<ChatSessionDeleteResult> {
  return enqueueChatStoreOp(projectPath, async () => {
    const result = await deleteChatSessionFromDisk(projectPath, sessionId, {
      activeSessionId: nextActiveSessionId || "",
    });
    if (result.ok) {
      syncLocalIndexFromRecord(projectPath);
    }
    return result;
  });
}

export async function flushChatStoreOnDisk<T extends ChatStoreSyncResult>(
  projectPath: string,
  flush: () => Promise<T>,
): Promise<T> {
  return enqueueChatStoreOp(projectPath, async () => {
    const result = await flush();
    if (result.ok) {
      syncLocalIndexFromRecord(projectPath);
    }
    return result;
  });
}
