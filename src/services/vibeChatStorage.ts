export type PersistedImageRef = {
  /** Relative to `.aiall/vibe-chat-sessions/` (e.g. images/{sessionId}/{messageId}-0.png) */
  path: string;
};

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
  /** In-memory preview; stripped on disk after externalize. */
  imageDataUrls?: string[];
  /** On-disk image paths under `.aiall/vibe-chat-sessions/`. */
  imageRefs?: PersistedImageRef[];
  imageCount?: number;
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
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentFailureReason?: string;
  agentRecoveryDismissed?: boolean;
  agentContinueCount?: number;
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

type SessionIndexEntry = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type ProjectIndexRecord = {
  activeSessionId: string;
  sessions: SessionIndexEntry[];
};

const CHAT_STORAGE_KEY = "vibe-coding-chat";
export const STORE_VERSION = 3 as const;
const MAX_MESSAGES_PER_SESSION = 120;
const MAX_SESSIONS_PER_PROJECT = 40;
const MAX_STATUS_LOG_LINES = 48;
const MAX_TURN_TRACES = 24;
const MAX_NARRATIVE_CHARS = 800;
const MAX_MODEL_STEP_CHARS = 500;
const MAX_TOOL_CALL_ARGS_CHARS = 240;

/** Full session payloads live in memory (and on disk); not in localStorage. */
const memoryByProject = new Map<string, ProjectChatRecord>();

type ChatStoreV1 = {
  version: 1;
  byProject: Record<string, PersistedChatMessage[]>;
};

type ChatStoreV2 = {
  version: 2;
  byProject: Record<string, ProjectChatRecord>;
};

type ChatStoreIndex = {
  version: typeof STORE_VERSION;
  byProject: Record<string, ProjectIndexRecord>;
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

const TOOL_SUMMARY_BLOCK_RE = /\n*(?:\[工具摘要\]\n(?:- .*(?:\n|$))+)+\n*/g;

/** Strip [工具摘要] blocks echoed by the model or leaked into stored assistant content. */
export function stripToolSummaryFromAssistantContent(text: string): string {
  if (!text || !text.includes("[工具摘要]")) return text;
  return text.replace(TOOL_SUMMARY_BLOCK_RE, "\n").trim();
}

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

/** Most recent user message that has stored image refs (for follow-up runs without a new attachment). */
export function findRecentUserImageRefs(
  messages: Array<Pick<PersistedChatMessage, "role" | "imageRefs" | "imageDataUrls">>,
): PersistedImageRef[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (m.imageRefs?.length) return [...m.imageRefs];
    if (m.imageDataUrls?.length) return [];
  }
  return [];
}

export function buildAgentHistoryFromMessages(
  messages: AgentHistorySourceMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .map((m) => {
      if (m.role !== "user" && m.role !== "assistant") return null;
      let content = m.role === "user" ? stripReferenceAttachments(m.content) : m.content.trim();
      if (m.role === "user") {
        const imageHint = m.imageRefs?.length || m.imageCount;
        if (imageHint) {
          const n = m.imageRefs?.length ?? m.imageCount ?? 0;
          content = `${content}\n[该条用户消息附 ${n} 张截图]`.trim();
        }
      }
      if (m.role === "assistant") {
        content = stripToolSummaryFromAssistantContent(content);
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

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function compactRoundGroupsForStorage(
  groups: PersistedAgentRoundGroup[] | undefined,
): PersistedAgentRoundGroup[] | undefined {
  if (!groups?.length) return undefined;
  return groups.map((group) => ({
    turn: group.turn,
    maxTurns: group.maxTurns,
    narrative: group.narrative
      ? truncateText(stripToolSummaryFromAssistantContent(group.narrative), MAX_NARRATIVE_CHARS)
      : undefined,
    modelSteps: group.modelSteps.map((step) => ({
      id: step.id,
      phase: step.phase,
      text: truncateText(step.text, MAX_MODEL_STEP_CHARS),
    })),
    toolIds: [...group.toolIds],
    request: group.request
      ? {
          model: group.request.model,
          contextMessages: group.request.contextMessages,
          contextChars: group.request.contextChars,
          messages: [],
        }
      : undefined,
    response: group.response
      ? {
          assistantText: truncateText(
            stripToolSummaryFromAssistantContent(group.response.assistantText),
            MAX_NARRATIVE_CHARS,
          ),
          hasToolCalls: group.response.hasToolCalls,
          isFinal: group.response.isFinal,
          toolCalls: group.response.toolCalls.map((call) => ({
            id: call.id,
            name: call.name,
            arguments: truncateText(call.arguments, MAX_TOOL_CALL_ARGS_CHARS),
          })),
        }
      : undefined,
  }));
}

const MAX_PERSISTED_IMAGES = 4;
const MAX_PERSISTED_IMAGE_CHARS = 120_000;
const MAX_DISK_IMAGES = 8;
const MAX_DISK_IMAGE_CHARS = 600_000;

function compactImageDataUrls(
  urls: string[] | undefined,
  options?: { forDisk?: boolean },
): string[] | undefined {
  if (!urls?.length) return undefined;
  const maxImages = options?.forDisk ? MAX_DISK_IMAGES : MAX_PERSISTED_IMAGES;
  const maxChars = options?.forDisk ? MAX_DISK_IMAGE_CHARS : MAX_PERSISTED_IMAGE_CHARS;
  const kept: string[] = [];
  let total = 0;
  for (const url of urls.slice(0, maxImages)) {
    if (!url.startsWith("data:image/")) continue;
    if (total + url.length > maxChars) break;
    kept.push(url);
    total += url.length;
  }
  return kept.length ? kept : undefined;
}

export function sanitizePersistedChatMessages(
  messages: PersistedChatMessage[],
  options?: { forDisk?: boolean },
): PersistedChatMessage[] {
  return sanitizeMessages(messages, options);
}

function sanitizeMessages(
  messages: PersistedChatMessage[],
  options?: { forDisk?: boolean },
): PersistedChatMessage[] {
  return messages
    .filter(
      (m) =>
        m.role === "user" ||
        m.content.trim() ||
        (m.imageDataUrls?.length ?? 0) > 0 ||
        (m.imageRefs?.length ?? 0) > 0 ||
        (m.imageCount ?? 0) > 0 ||
        (m.tools?.length ?? 0) > 0 ||
        m.agentRecoverable,
    )
    .slice(-MAX_MESSAGES_PER_SESSION)
    .map((m) => {
      const compactImages =
        m.role === "user" && !options?.forDisk
          ? compactImageDataUrls(m.imageDataUrls, options)
          : undefined;
      const imageCount =
        m.imageRefs?.length ||
        m.imageCount ||
        m.imageDataUrls?.length ||
        undefined;
      return {
        id: m.id,
        role: m.role,
        content: m.role === "assistant" ? stripToolSummaryFromAssistantContent(m.content) : m.content,
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
        statusLog: m.statusLog?.length ? m.statusLog.slice(-MAX_STATUS_LOG_LINES) : undefined,
        turnTraces: m.turnTraces?.length
          ? m.turnTraces.slice(-MAX_TURN_TRACES).map((t) => ({
              ...t,
              assistantText: t.assistantText
                ? truncateText(stripToolSummaryFromAssistantContent(t.assistantText), MAX_NARRATIVE_CHARS)
                : t.assistantText,
            }))
          : undefined,
        roundGroups: compactRoundGroupsForStorage(m.roundGroups),
        totalTurns: m.totalTurns,
        writtenFiles: m.writtenFiles?.length ? [...m.writtenFiles] : undefined,
        turnFileDiffs:
          m.pendingApproval && m.turnFileDiffs ? { ...m.turnFileDiffs } : undefined,
        pendingApproval: m.pendingApproval || undefined,
        agentAborted: m.agentAborted || undefined,
        agentFailed: m.agentFailed || undefined,
        agentRecoverable: m.agentRecoverable || undefined,
        agentFailureReason: m.agentFailureReason || undefined,
        agentRecoveryDismissed: m.agentRecoveryDismissed || undefined,
        agentContinueCount: m.agentContinueCount || undefined,
        rejected: m.rejected || undefined,
        reverted: m.reverted || undefined,
        activityExpanded: m.activityExpanded || undefined,
        activityDetailed: m.activityDetailed || undefined,
        ...(options?.forDisk
          ? {
              ...(m.imageRefs?.length ? { imageRefs: m.imageRefs.map((r) => ({ path: r.path })) } : {}),
              ...(m.imageDataUrls?.length ? { imageDataUrls: [...m.imageDataUrls] } : {}),
              ...(imageCount ? { imageCount } : {}),
            }
          : compactImages
            ? {
                imageDataUrls: compactImages,
                ...(m.imageRefs?.length ? { imageRefs: m.imageRefs.map((r) => ({ path: r.path })) } : {}),
                ...(imageCount ? { imageCount } : {}),
              }
            : m.imageRefs?.length
              ? { imageRefs: m.imageRefs.map((r) => ({ path: r.path })), ...(imageCount ? { imageCount } : {}) }
              : m.imageDataUrls?.length
                ? { imageCount: m.imageDataUrls.length }
                : m.imageCount
                  ? { imageCount: m.imageCount }
                  : {}),
      };
    });
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

function cloneRecord(record: ProjectChatRecord): ProjectChatRecord {
  return {
    activeSessionId: record.activeSessionId,
    sessions: record.sessions.map((session) => ({
      ...session,
      messages: sanitizeMessages(session.messages),
    })),
  };
}

function projectIndexFromRecord(record: ProjectChatRecord): ProjectIndexRecord {
  return {
    activeSessionId: record.activeSessionId,
    sessions: record.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
    })),
  };
}

function migrateV1Store(raw: ChatStoreV1): ChatStoreIndex {
  const byProject: Record<string, ProjectIndexRecord> = {};
  for (const [key, messages] of Object.entries(raw.byProject || {})) {
    const session = createSession(messages);
    memoryByProject.set(key, { activeSessionId: session.id, sessions: [session] });
    byProject[key] = projectIndexFromRecord({ activeSessionId: session.id, sessions: [session] });
  }
  return { version: STORE_VERSION, byProject };
}

function migrateV2Store(raw: ChatStoreV2): ChatStoreIndex {
  const byProject: Record<string, ProjectIndexRecord> = {};
  for (const [key, record] of Object.entries(raw.byProject || {})) {
    if (!record?.sessions?.length) continue;
    const cloned = cloneRecord(record);
    memoryByProject.set(key, cloned);
    byProject[key] = projectIndexFromRecord(cloned);
  }
  return { version: STORE_VERSION, byProject };
}

function readIndex(): ChatStoreIndex {
  const raw = localStorage.getItem(CHAT_STORAGE_KEY);
  if (!raw) return { version: STORE_VERSION, byProject: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatStoreIndex | ChatStoreV2 | ChatStoreV1>;
    if (!parsed || typeof parsed !== "object" || !parsed.byProject) {
      return { version: STORE_VERSION, byProject: {} };
    }
    if (parsed.version === 1) {
      const migrated = migrateV1Store(parsed as ChatStoreV1);
      writeIndex(migrated);
      return migrated;
    }
    if (parsed.version === 2) {
      const migrated = migrateV2Store(parsed as ChatStoreV2);
      writeIndex(migrated);
      return migrated;
    }
    return { version: STORE_VERSION, byProject: parsed.byProject as Record<string, ProjectIndexRecord> };
  } catch {
    return { version: STORE_VERSION, byProject: {} };
  }
}

let storageErrorCallback: ((msg: string) => void) | null = null;

export function onStorageError(cb: (msg: string) => void) {
  storageErrorCallback = cb;
}

function writeIndex(index: ChatStoreIndex): boolean {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(index));
    return true;
  } catch (e) {
    console.warn("[vibeChatStorage] localStorage index write failed:", e);
    storageErrorCallback?.("浏览器索引写入失败，会话已保存到项目目录。");
    return false;
  }
}

function persistRecord(key: string, record: ProjectChatRecord): boolean {
  memoryByProject.set(key, cloneRecord(record));
  const index = readIndex();
  index.byProject[key] = projectIndexFromRecord(record);
  return writeIndex(index);
}

function getProjectRecord(key: string): ProjectChatRecord | undefined {
  const cached = memoryByProject.get(key);
  if (cached?.sessions?.length) return cloneRecord(cached);

  readIndex();
  const migrated = memoryByProject.get(key);
  if (migrated?.sessions?.length) return cloneRecord(migrated);

  const index = readIndex().byProject[key];
  if (!index?.sessions?.length) return undefined;

  const record: ProjectChatRecord = {
    activeSessionId: index.activeSessionId,
    sessions: index.sessions.map((entry) => ({
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      messages: [],
    })),
  };
  const activeExists = record.sessions.some((s) => s.id === record.activeSessionId);
  if (!activeExists && record.sessions.length) {
    record.activeSessionId = record.sessions[0].id;
  }
  return record;
}

function ensureProjectRecord(key: string): ProjectChatRecord {
  let record = getProjectRecord(key);
  if (!record?.sessions?.length) {
    const session = createSession();
    record = { activeSessionId: session.id, sessions: [session] };
    persistRecord(key, record);
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

export function getVibeChatProjectSnapshot(projectPath: string): VibeChatProjectSnapshot {
  const key = normalizeProjectKey(projectPath);
  const record = key ? getProjectRecord(key) : undefined;
  return {
    version: STORE_VERSION,
    projectPath,
    activeSessionId: record?.activeSessionId || "",
    sessions:
      record?.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
        messages: sanitizeMessages(s.messages, { forDisk: true }),
      })) || [],
  };
}

export function getActiveSessionSnapshot(
  projectPath: string,
  sessionId: string,
): { id: string; title: string; createdAt: string; updatedAt: string; messages: PersistedChatMessage[] } | null {
  const key = normalizeProjectKey(projectPath);
  if (!key) return null;
  const record = getProjectRecord(key);
  const session = record?.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: sanitizeMessages(session.messages, { forDisk: true }),
  };
}

export function listVibeChatSessions(projectPath: string): VibeChatSessionMeta[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const record = getProjectRecord(key);
  if (!record?.sessions?.length) return [];
  return [...record.sessions]
    .filter((s) => s.messages.length > 0 || readIndex().byProject[key]?.sessions.some((m) => m.id === s.id && m.messageCount > 0))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((s) => {
      const indexed = readIndex().byProject[key]?.sessions.find((m) => m.id === s.id);
      return {
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length || indexed?.messageCount || 0,
      };
    });
}

export function getActiveVibeChatSessionId(projectPath: string): string {
  const key = normalizeProjectKey(projectPath);
  if (!key) return "";
  const record = getProjectRecord(key);
  return record?.activeSessionId || readIndex().byProject[key]?.activeSessionId || "";
}

export function loadVibeChatHistory(projectPath: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const record = getProjectRecord(key);
  if (!record?.sessions?.length) return [];
  return sanitizeMessages(getActiveSession(record).messages);
}

export function hasVibeChatHistory(projectPath: string): boolean {
  const key = normalizeProjectKey(projectPath);
  if (!key) return false;
  const record = getProjectRecord(key);
  if (record?.sessions.some((s) => s.messages.length > 0)) return true;
  const indexed = readIndex().byProject[key];
  return Boolean(indexed?.sessions.some((s) => s.messageCount > 0));
}

/** True when localStorage index says a session has messages but memory is empty or missing image refs. */
export function projectChatNeedsDiskRestore(projectPath: string, sessionId?: string): boolean {
  const key = normalizeProjectKey(projectPath);
  if (!key) return false;
  const record = getProjectRecord(key);
  const indexed = readIndex().byProject[key];
  if (!indexed?.sessions?.length) return false;

  const metas = sessionId
    ? indexed.sessions.filter((s) => s.id === sessionId)
    : indexed.sessions;

  for (const meta of metas) {
    const expected = meta.messageCount ?? 0;
    if (expected <= 0) continue;
    const session = record?.sessions.find((s) => s.id === meta.id);
    if (!session || session.messages.length === 0) return true;
    if (session.messages.length < expected) return true;
    const missingImages = session.messages.some(
      (m) =>
        m.role === "user" &&
        ((m.imageCount ?? 0) > 0 || (m.imageRefs?.length ?? 0) > 0) &&
        !m.imageRefs?.length &&
        !m.imageDataUrls?.length,
    );
    if (missingImages) return true;
  }
  return false;
}

export function restoreChatStoreFromSnapshot(snapshot: VibeChatProjectSnapshot): boolean {
  const key = normalizeProjectKey(snapshot.projectPath);
  if (!key || !snapshot.sessions?.length) return false;
  const sessions: VibeChatSession[] = snapshot.sessions.map((s) => ({
    id: s.id,
    title: s.title || "新会话",
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || new Date().toISOString(),
    messages: sanitizeMessages(s.messages, { forDisk: true }),
  }));
  const record: ProjectChatRecord = {
    activeSessionId:
      snapshot.activeSessionId && sessions.some((s) => s.id === snapshot.activeSessionId)
        ? snapshot.activeSessionId
        : sessions[0].id,
    sessions,
  };
  persistRecord(key, record);
  return true;
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

  let record = getProjectRecord(key);
  if (!record) {
    const session = createSession(sanitized);
    record = { activeSessionId: session.id, sessions: [session] };
    return { ok: persistRecord(key, record), sessionId: session.id };
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
  return { ok: persistRecord(key, record), sessionId: session.id };
}

export function switchVibeChatSession(projectPath: string, sessionId: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const record = getProjectRecord(key);
  if (!record) return [];
  const target = record.sessions.find((s) => s.id === sessionId);
  if (!target) return sanitizeMessages(getActiveSession(record).messages);
  record.activeSessionId = sessionId;
  persistRecord(key, record);
  return sanitizeMessages(target.messages);
}

export function createVibeChatSession(projectPath: string): { id: string; messages: PersistedChatMessage[] } {
  const key = normalizeProjectKey(projectPath);
  if (!key) return { id: "", messages: [] };
  let record = getProjectRecord(key);
  if (!record) {
    record = { activeSessionId: "", sessions: [] };
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
  persistRecord(key, record);
  return { id: session.id, messages: [] };
}

export function deleteVibeChatSession(projectPath: string, sessionId: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const record = getProjectRecord(key);
  if (!record?.sessions?.length) return [];

  if (record.sessions.length === 1) {
    memoryByProject.delete(key);
    const index = readIndex();
    delete index.byProject[key];
    writeIndex(index);
    return [];
  }

  record.sessions = record.sessions.filter((s) => s.id !== sessionId);
  if (record.activeSessionId === sessionId) {
    record.activeSessionId = record.sessions[0].id;
  }
  persistRecord(key, record);
  return sanitizeMessages(getActiveSession(record).messages);
}

export function clearVibeChatHistory(projectPath: string) {
  const key = normalizeProjectKey(projectPath);
  if (!key) return;
  const record = getProjectRecord(key);
  if (!record?.sessions?.length) return;
  record.sessions = record.sessions.filter((s) => s.id !== record.activeSessionId);
  if (!record.sessions.length) {
    memoryByProject.delete(key);
    const index = readIndex();
    delete index.byProject[key];
    writeIndex(index);
  } else {
    record.activeSessionId = record.sessions[0].id;
    persistRecord(key, record);
  }
}
