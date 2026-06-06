export type PersistedFileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
};

export type PersistedAgentContext = {
  mode: "ask" | "build";
  systemPrompt: string;
  history: Array<{ role: string; content: string }>;
  projectContext?: string;
  maxTurns?: number;
  model?: string;
  openFile?: string;
};

export type PersistedTurnTrace = {
  turn: number;
  maxTurns?: number;
  assistantText: string;
  hasToolCalls: boolean;
};

export type PersistedChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chatMode?: "ask" | "build";
  tools?: Array<{
    id: string;
    name?: string;
    icon?: string;
    title?: string;
    detail?: string;
    label: string;
    summary: string;
    ok: boolean;
    fullResult?: string;
    args?: Record<string, unknown>;
  }>;
  agentContext?: PersistedAgentContext;
  statusLog?: string[];
  turnTraces?: PersistedTurnTrace[];
  totalTurns?: number;
  writtenFiles?: string[];
  turnFileDiffs?: Record<string, PersistedFileDiff>;
  pendingApproval?: boolean;
  rejected?: boolean;
  reverted?: boolean;
  activityExpanded?: boolean;
};

export type VibeChatSessionMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type VibeChatProjectSnapshot = {
  version: typeof STORE_VERSION;
  projectPath: string;
  activeSessionId: string;
  sessions: Array<VibeChatSessionMeta & { messages: PersistedChatMessage[] }>;
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

export function formatSessionTitle(raw: string): string {
  let text = raw.trim();
  const refIdx = text.search(/\n\n## 📎/);
  if (refIdx >= 0) text = text.slice(0, refIdx).trim();
  text = text.replace(/\s+/g, " ");
  if (!text) return "新会话";
  return text.length > 36 ? `${text.slice(0, 36)}…` : text;
}

export function buildAgentHistoryFromMessages(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m.role === "user" || m.role === "assistant") && Boolean(m.content.trim()),
    )
    .map((m) => ({ role: m.role, content: m.content.trim() }));
}

function sessionTitleFromMessages(messages: PersistedChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (firstUser) return formatSessionTitle(firstUser.content);
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
      chatMode: m.chatMode,
      tools: m.tools?.map((t) => ({
        id: t.id,
        name: t.name,
        icon: t.icon,
        title: t.title,
        detail: t.detail,
        label: t.label,
        summary: t.summary,
        ok: t.ok,
        fullResult: t.fullResult,
        args: t.args,
      })),
      agentContext: m.agentContext,
      statusLog: m.statusLog?.length ? [...m.statusLog] : undefined,
      turnTraces: m.turnTraces?.length ? m.turnTraces.map((t) => ({ ...t })) : undefined,
      totalTurns: m.totalTurns,
      writtenFiles: m.writtenFiles?.length ? [...m.writtenFiles] : undefined,
      turnFileDiffs: m.turnFileDiffs ? { ...m.turnFileDiffs } : undefined,
      pendingApproval: m.pendingApproval || undefined,
      rejected: m.rejected || undefined,
      reverted: m.reverted || undefined,
      activityExpanded: m.activityExpanded || undefined,
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

let storageErrorCallback: ((msg: string) => void) | null = null;

export function onStorageError(cb: (msg: string) => void) {
  storageErrorCallback = cb;
}

export function getVibeChatProjectSnapshot(projectPath: string): VibeChatProjectSnapshot {
  const key = normalizeProjectKey(projectPath);
  const store = readStore();
  const record = key ? getProjectRecord(store, key) : undefined;
  return {
    version: STORE_VERSION,
    projectPath,
    activeSessionId: record?.activeSessionId || "",
    sessions: record?.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
      messages: sanitizeMessages(s.messages),
    })) || [],
  };
}

function writeStore(store: ChatStore): boolean {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    console.warn("[vibeChatStorage] localStorage write failed:", e);
    const msg = "聊天记录保存失败（存储空间可能已满），刷新或关闭页面后记录会丢失。";
    storageErrorCallback?.(msg);
    return false;
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

function getProjectRecord(store: ChatStore, key: string): ProjectChatRecord | undefined {
  const record = store.byProject[key];
  if (!record?.sessions?.length) return undefined;
  const activeExists = record.sessions.some((s) => s.id === record.activeSessionId);
  if (!activeExists) {
    record.activeSessionId = record.sessions[0]?.id || "";
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
    .filter((s) => s.messages.length > 0)
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
  const record = getProjectRecord(store, key);
  return record?.activeSessionId || "";
}

export function loadVibeChatHistory(projectPath: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const store = readStore();
  const record = store.byProject[key];
  if (!record?.sessions?.length) return [];
  return sanitizeMessages(getActiveSession(record).messages);
}

export function saveVibeChatHistory(
  projectPath: string,
  messages: PersistedChatMessage[],
  sessionId?: string,
): { ok: boolean; sessionId: string } {
  const key = normalizeProjectKey(projectPath);
  if (!key) return { ok: false, sessionId: "" };
  const sanitized = sanitizeMessages(messages);
  if (!sanitized.length) return { ok: true, sessionId: sessionId || "" };

  const store = readStore();
  let record = getProjectRecord(store, key);
  if (!record) {
    const session = createSession(sanitized);
    store.byProject[key] = { activeSessionId: session.id, sessions: [session] };
    return { ok: writeStore(store), sessionId: session.id };
  }

  let session = sessionId ? record.sessions.find((s) => s.id === sessionId) : undefined;
  if (!session) {
    session = createSession(sanitized);
    record.sessions.unshift(session);
  } else {
    touchSession(session, sanitized);
  }

  if (record.sessions.length > MAX_SESSIONS_PER_PROJECT) {
    record.sessions = record.sessions.slice(0, MAX_SESSIONS_PER_PROJECT);
  }
  record.activeSessionId = session.id;
  return { ok: writeStore(store), sessionId: session.id };
}

export function switchVibeChatSession(projectPath: string, sessionId: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const store = readStore();
  const record = getProjectRecord(store, key);
  if (!record) return [];
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
  let record = getProjectRecord(store, key);
  if (!record) {
    record = { activeSessionId: "", sessions: [] };
    store.byProject[key] = record;
  }
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
    delete store.byProject[key];
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
  record.sessions = record.sessions.filter((s) => s.id !== record.activeSessionId);
  if (!record.sessions.length) {
    delete store.byProject[key];
  } else {
    record.activeSessionId = record.sessions[0].id;
  }
  writeStore(store);
}
