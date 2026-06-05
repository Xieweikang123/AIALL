export type PersistedFileDiff = {
  before: string;
  after: string;
};

export type PersistedChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: Array<{
    id: string;
    name?: string;
    icon?: string;
    title?: string;
    detail?: string;
    label: string;
    summary: string;
    ok: boolean;
  }>;
  writtenFiles?: string[];
  turnFileDiffs?: Record<string, PersistedFileDiff>;
  pendingApproval?: boolean;
  rejected?: boolean;
  reverted?: boolean;
};

export type VibeChatSessionMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type VibeChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedChatMessage[];
};

type ProjectChatRecord = {
  activeSessionId: string;
  sessions: VibeChatSession[];
};

const CHAT_STORAGE_KEY = "vibe-coding-chat";
const STORE_VERSION = 2;
const MAX_MESSAGES_PER_SESSION = 80;
const MAX_SESSIONS_PER_PROJECT = 30;

type ChatStoreV1 = {
  version: 1;
  byProject: Record<string, PersistedChatMessage[]>;
};

type ChatStore = {
  version: typeof STORE_VERSION;
  byProject: Record<string, ProjectChatRecord>;
};

function normalizeProjectKey(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

function genSessionId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sessionTitleFromMessages(messages: PersistedChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (firstUser) {
    const text = firstUser.content.trim().replace(/\s+/g, " ");
    return text.length > 36 ? `${text.slice(0, 36)}…` : text;
  }
  return "新会话";
}

function sanitizeMessages(messages: PersistedChatMessage[]): PersistedChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.content.trim() || (m.tools?.length ?? 0) > 0)
    .slice(-MAX_MESSAGES_PER_SESSION)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tools: m.tools?.map((t) => ({
        id: t.id,
        name: t.name,
        icon: t.icon,
        title: t.title,
        detail: t.detail,
        label: t.label,
        summary: t.summary,
        ok: t.ok,
      })),
      writtenFiles: m.writtenFiles?.length ? [...m.writtenFiles] : undefined,
      pendingApproval: m.pendingApproval || undefined,
      rejected: m.rejected || undefined,
      reverted: m.reverted || undefined,
    }));
}

function createSession(messages: PersistedChatMessage[] = []): VibeChatSession {
  const now = new Date().toISOString();
  const sanitized = sanitizeMessages(messages);
  return {
    id: genSessionId(),
    title: sessionTitleFromMessages(sanitized),
    createdAt: now,
    updatedAt: now,
    messages: sanitized,
  };
}

function migrateV1Store(raw: ChatStoreV1): ChatStore {
  const byProject: Record<string, ProjectChatRecord> = {};
  for (const [key, messages] of Object.entries(raw.byProject || {})) {
    const session = createSession(messages);
    byProject[key] = {
      activeSessionId: session.id,
      sessions: [session],
    };
  }
  return { version: STORE_VERSION, byProject };
}

function readStore(): ChatStore {
  const raw = localStorage.getItem(CHAT_STORAGE_KEY);
  if (!raw) return { version: STORE_VERSION, byProject: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatStore | ChatStoreV1>;
    if (!parsed || typeof parsed !== "object" || !parsed.byProject) {
      return { version: STORE_VERSION, byProject: {} };
    }
    if (parsed.version === 1) {
      const migrated = migrateV1Store(parsed as ChatStoreV1);
      writeStore(migrated);
      return migrated;
    }
    return { version: STORE_VERSION, byProject: parsed.byProject as Record<string, ProjectChatRecord> };
  } catch {
    return { version: STORE_VERSION, byProject: {} };
  }
}

function writeStore(store: ChatStore) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn("[vibeChatStorage] localStorage write failed:", e);
  }
}

function ensureProjectRecord(store: ChatStore, key: string): ProjectChatRecord {
  let record = store.byProject[key];
  if (!record?.sessions?.length) {
    const session = createSession();
    record = { activeSessionId: session.id, sessions: [session] };
    store.byProject[key] = record;
  }
  const activeExists = record.sessions.some((s) => s.id === record.activeSessionId);
  if (!activeExists) {
    record.activeSessionId = record.sessions[0].id;
  }
  return record;
}

function getActiveSession(record: ProjectChatRecord): VibeChatSession {
  const session = record.sessions.find((s) => s.id === record.activeSessionId);
  return session || record.sessions[0];
}

function touchSession(session: VibeChatSession, messages: PersistedChatMessage[]) {
  session.messages = sanitizeMessages(messages);
  session.updatedAt = new Date().toISOString();
  session.title = sessionTitleFromMessages(session.messages);
}

export function listVibeChatSessions(projectPath: string): VibeChatSessionMeta[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const store = readStore();
  const record = store.byProject[key];
  if (!record?.sessions?.length) return [];
  return [...record.sessions]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
    }));
}

export function getActiveVibeChatSessionId(projectPath: string): string {
  const key = normalizeProjectKey(projectPath);
  if (!key) return "";
  const store = readStore();
  const record = ensureProjectRecord(store, key);
  writeStore(store);
  return record.activeSessionId;
}

export function loadVibeChatHistory(projectPath: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const store = readStore();
  const record = store.byProject[key];
  if (!record?.sessions?.length) return [];
  return sanitizeMessages(getActiveSession(record).messages);
}

export function saveVibeChatHistory(projectPath: string, messages: PersistedChatMessage[]) {
  const key = normalizeProjectKey(projectPath);
  if (!key) return;
  const store = readStore();
  const record = ensureProjectRecord(store, key);
  const session = getActiveSession(record);
  touchSession(session, messages);
  writeStore(store);
}

export function switchVibeChatSession(projectPath: string, sessionId: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const store = readStore();
  const record = ensureProjectRecord(store, key);
  const target = record.sessions.find((s) => s.id === sessionId);
  if (!target) return sanitizeMessages(getActiveSession(record).messages);
  record.activeSessionId = sessionId;
  writeStore(store);
  return sanitizeMessages(target.messages);
}

export function createVibeChatSession(projectPath: string): { id: string; messages: PersistedChatMessage[] } {
  const key = normalizeProjectKey(projectPath);
  if (!key) return { id: "", messages: [] };
  const store = readStore();
  const record = ensureProjectRecord(store, key);
  const session = createSession();
  record.sessions.unshift(session);
  if (record.sessions.length > MAX_SESSIONS_PER_PROJECT) {
    const removed = record.sessions.pop();
    if (removed?.id === record.activeSessionId && record.sessions.length) {
      record.activeSessionId = record.sessions[0].id;
    }
  }
  record.activeSessionId = session.id;
  writeStore(store);
  return { id: session.id, messages: [] };
}

export function deleteVibeChatSession(projectPath: string, sessionId: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const store = readStore();
  const record = store.byProject[key];
  if (!record?.sessions?.length) return [];

  if (record.sessions.length === 1) {
    const session = createSession();
    record.sessions = [session];
    record.activeSessionId = session.id;
    writeStore(store);
    return [];
  }

  record.sessions = record.sessions.filter((s) => s.id !== sessionId);
  if (record.activeSessionId === sessionId) {
    record.activeSessionId = record.sessions[0].id;
  }
  writeStore(store);
  return sanitizeMessages(getActiveSession(record).messages);
}

export function clearVibeChatHistory(projectPath: string) {
  const key = normalizeProjectKey(projectPath);
  if (!key) return;
  const store = readStore();
  const record = store.byProject[key];
  if (!record?.sessions?.length) return;
  const session = getActiveSession(record);
  touchSession(session, []);
  writeStore(store);
}
