import fs from "node:fs";
import path from "node:path";

export type ChatStoreIndexSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  file: string;
  status?: string;
};

export type ChatStoreIndexFile = {
  syncedAt: string;
  version: number;
  projectPath: string;
  activeSessionId: string;
  sessions: ChatStoreIndexSession[];
};

type SessionPayloadLike = {
  id?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messages?: unknown[];
  status?: string;
};

export function safeChatStoreFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function sessionIndexFileName(sessionId: string): string {
  return `chat-${safeChatStoreFilePart(sessionId)}.json`;
}

export function buildSessionIndexEntry(session: SessionPayloadLike, sessionId: string): ChatStoreIndexSession {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    id: sessionId,
    title: session.title || "新会话",
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
    messageCount: messages.length,
    file: sessionIndexFileName(sessionId),
    status: session.status || "active",
  };
}

export function patchChatStoreIndex(
  index: ChatStoreIndexFile,
  entry: ChatStoreIndexSession,
  options?: { activeSessionId?: string; projectPath?: string },
): ChatStoreIndexFile {
  const sessions = [...(index.sessions || [])];
  const existingIdx = sessions.findIndex((s) => s.id === entry.id);
  if (existingIdx >= 0) {
    sessions[existingIdx] = { ...sessions[existingIdx], ...entry };
  } else {
    sessions.unshift(entry);
  }
  return {
    ...index,
    version: index.version || 3,
    projectPath: options?.projectPath || index.projectPath,
    activeSessionId: options?.activeSessionId || index.activeSessionId || entry.id,
    syncedAt: new Date().toISOString(),
    sessions,
  };
}

export async function readChatStoreIndex(storeFile: string): Promise<ChatStoreIndexFile | null> {
  try {
    const raw = await fs.promises.readFile(storeFile, "utf-8");
    const parsed = JSON.parse(raw) as ChatStoreIndexFile;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function upsertChatStoreIndexEntry(
  chatDir: string,
  projectPath: string,
  session: SessionPayloadLike,
  sessionId: string,
  options?: { activeSessionId?: string },
): Promise<void> {
  const storeFile = path.join(chatDir, "chat-store.json");
  const entry = buildSessionIndexEntry(session, sessionId);
  const existing =
    (await readChatStoreIndex(storeFile)) ||
    ({
      syncedAt: new Date().toISOString(),
      version: 3,
      projectPath,
      activeSessionId: options?.activeSessionId || sessionId,
      sessions: [],
    } satisfies ChatStoreIndexFile);
  const next = patchChatStoreIndex(existing, entry, {
    projectPath,
    activeSessionId: options?.activeSessionId || existing.activeSessionId || sessionId,
  });
  await fs.promises.writeFile(storeFile, JSON.stringify(next, null, 2), "utf-8");
}

export function removeChatStoreIndexSession(
  index: ChatStoreIndexFile,
  sessionId: string,
  options?: { activeSessionId?: string },
): ChatStoreIndexFile {
  const sessions = (index.sessions || []).filter((s) => s.id !== sessionId);
  let activeSessionId = options?.activeSessionId ?? index.activeSessionId;
  if (activeSessionId === sessionId) {
    activeSessionId = sessions[0]?.id || "";
  }
  return {
    ...index,
    activeSessionId,
    syncedAt: new Date().toISOString(),
    sessions,
  };
}

export async function deleteChatStoreSession(
  chatDir: string,
  projectPath: string,
  sessionId: string,
  options?: { activeSessionId?: string },
): Promise<ChatStoreIndexFile> {
  const storeFile = path.join(chatDir, "chat-store.json");
  const sessionFile = path.join(chatDir, sessionIndexFileName(sessionId));
  await fs.promises.unlink(sessionFile).catch(() => {});
  const existing = await readChatStoreIndex(storeFile);
  if (!existing) {
    return {
      syncedAt: new Date().toISOString(),
      version: 3,
      projectPath,
      activeSessionId: options?.activeSessionId || "",
      sessions: [],
    };
  }
  const next = removeChatStoreIndexSession(existing, sessionId, options);
  await fs.promises.writeFile(storeFile, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
