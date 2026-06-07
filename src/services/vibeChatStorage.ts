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

export type PersistedAgentModelStep = {
  id: string;
  text: string;
  phase: string;
};

export type PersistedAgentRoundGroup = {
  turn: number;
  maxTurns?: number;
  narrative?: string;
  modelSteps: PersistedAgentModelStep[];
  toolIds: string[];
  request?: {
    model?: string;
    contextMessages: number;
    contextChars: number;
    messages: Array<{ role: string; content: string; toolCalls?: string }>;
  };
  response?: {
    assistantText: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
    hasToolCalls: boolean;
    isFinal: boolean;
  };
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
    turn?: number;
    fullResult?: string;
    args?: Record<string, unknown>;
  }>;
  agentContext?: PersistedAgentContext;
  statusLog?: string[];
  turnTraces?: PersistedTurnTrace[];
  roundGroups?: PersistedAgentRoundGroup[];
  totalTurns?: number;
  writtenFiles?: string[];
  turnFileDiffs?: Record<string, PersistedFileDiff>;
  pendingApproval?: boolean;
  agentAborted?: boolean;
  rejected?: boolean;
  reverted?: boolean;
  activityExpanded?: boolean;
  activityDetailed?: boolean;
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
  let text = stripReferenceAttachments(raw);
  text = text.replace(/\s+/g, " ");
  if (!text) return "新会话";
  return text.length > 36 ? `${text.slice(0, 36)}…` : text;
}

/** Strip composer-attached reference file blocks from user prompts. */
export function stripReferenceAttachments(content: string): string {
  const refIdx = content.search(/\n\n## 📎/);
  return refIdx >= 0 ? content.slice(0, refIdx).trim() : content.trim();
}

export type AgentHistorySourceMessage = {
  role: string;
  content: string;
  tools?: Array<{
    name?: string;
    title?: string;
    summary?: string;
    ok?: boolean;
    running?: boolean;
  }>;
};

function summarizeToolsForHistory(
  tools: AgentHistorySourceMessage["tools"],
): string {
  if (!tools?.length) return "";
  const lines = tools
    .filter((t) => !t.running && t.summary)
    .map((t) => {
      const label = t.title || t.name || "工具";
      const status = t.ok === false ? "（失败）" : "";
      return `- ${label}: ${t.summary}${status}`;
    });
  return lines.length ? `\n\n[工具摘要]\n${lines.join("\n")}` : "";
}

export function buildAgentHistoryFromMessages(
  messages: AgentHistorySourceMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .map((m) => {
      if (m.role !== "user" && m.role !== "assistant") return null;
      let content = m.role === "user" ? stripReferenceAttachments(m.content) : m.content.trim();
      if (m.role === "assistant") {
        content = `${content}${summarizeToolsForHistory(m.tools)}`.trim();
      }
      if (!content) return null;
      return { role: m.role, content };
    })
    .filter((m): m is { role: "user" | "assistant"; content: string } => m !== null);
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
        turn: t.turn,
        args: t.args,
      })),
      statusLog: m.statusLog?.length ? [...m.statusLog] : undefined,
      turnTraces: m.turnTraces?.length ? m.turnTraces.map((t) => ({ ...t })) : undefined,
      roundGroups: m.roundGroups?.length
        ? m.roundGroups.map((group) => ({
            turn: group.turn,
            maxTurns: group.maxTurns,
            narrative: group.narrative,
            modelSteps: group.modelSteps.map((step) => ({ ...step })),
            toolIds: [...group.toolIds],
            request: group.request
              ? {
                  ...group.request,
                  messages: group.request.messages.map((message) => ({ ...message })),
                }
              : undefined,
            response: group.response
              ? {
                  ...group.response,
                  toolCalls: group.response.toolCalls.map((call) => ({ ...call })),
                }
              : undefined,
          }))
        : undefined,
      totalTurns: m.totalTurns,
      writtenFiles: m.writtenFiles?.length ? [...m.writtenFiles] : undefined,
      turnFileDiffs:
        m.pendingApproval && m.turnFileDiffs
          ? { ...m.turnFileDiffs }
          : m.writtenFiles?.length && m.turnFileDiffs
            ? Object.fromEntries(
                Object.entries(m.turnFileDiffs).map(([p, d]) => [
                  p,
                  { before: d.before, after: d.after, deleted: d.deleted, created: d.created },
                ]),
              )
            : undefined,
      pendingApproval: m.pendingApproval || undefined,
      agentAborted: m.agentAborted || undefined,
      rejected: m.rejected || undefined,
      reverted: m.reverted || undefined,
      activityExpanded: m.activityExpanded || undefined,
      activityDetailed: m.activityDetailed || undefined,
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

export function hasVibeChatHistory(projectPath: string): boolean {
  const key = normalizeProjectKey(projectPath);
  if (!key) return false;
  const store = readStore();
  const record = store.byProject[key];
  return Boolean(record?.sessions?.some((s) => s.messages.length > 0));
}

export function restoreChatStoreFromSnapshot(snapshot: VibeChatProjectSnapshot): boolean {
  const key = normalizeProjectKey(snapshot.projectPath);
  if (!key || !snapshot.sessions?.length) return false;
  const store = readStore();
  const sessions: VibeChatSession[] = snapshot.sessions.map((s) => ({
    id: s.id,
    title: s.title || "新会话",
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || new Date().toISOString(),
    messages: sanitizeMessages(s.messages),
  }));
  store.byProject[key] = {
    activeSessionId:
      snapshot.activeSessionId && sessions.some((s) => s.id === snapshot.activeSessionId)
        ? snapshot.activeSessionId
        : sessions[0].id,
    sessions,
  };
  return writeStore(store);
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
