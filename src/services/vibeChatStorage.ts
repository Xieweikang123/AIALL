import type {
  PersistedAgentRoundGroup,
  PersistedChatMessage,
  PersistedImageRef,
  PersistedTurnTrace,
  ProjectChatRecord,
  ProjectIndexRecord,
  SessionIndexEntry,
  VibeChatProjectSnapshot,
  VibeChatSession,
  VibeChatSessionMeta,
} from "./vibeChatStorageTypes";
import { hasAgentProgressMarker } from "./agentProgressMarker";
import { sanitizeUserVisibleAssistantText } from "./agentVisibleText";
import { MAX_AGENT_IMAGE_BYTES } from "./imageCompress";
import { resolveChatMessageImageUrls } from "./vibeChatImageStore";
import {
  composerDraftPreviewText,
  hasComposerDraft,
  removeComposerDraft,
} from "../utils/composerDraftStorage";
import { sessionDiag } from "../utils/sessionDiagLog";
import { lsGet, lsSetJson } from "../utils/localStorageSafe";

export type {
  PersistedAgentContext,
  PersistedAgentModelStep,
  PersistedAgentRoundGroup,
  PersistedChatMessage,
  PersistedFileDiff,
  PersistedImageRef,
  PersistedTurnTrace,
  VibeChatProjectSnapshot,
  VibeChatSessionMeta,
} from "./vibeChatStorageTypes";

/** Whether an assistant row should be kept despite empty final content. */
export function shouldPersistAssistantMessage(m: PersistedChatMessage): boolean {
  if (m.role !== "assistant") return false;
  return Boolean(
    m.content.trim() ||
      (m.tools?.length ?? 0) > 0 ||
      (m.roundGroups?.length ?? 0) > 0 ||
      (m.statusLog?.length ?? 0) > 0 ||
      m.agentRecoverable ||
      m.agentFailed ||
      m.agentAborted ||
      m.agentContext ||
      (m.totalTurns ?? 0) > 0 ||
      (m.streamChars ?? 0) > 0 ||
      (m.writtenFiles?.length ?? 0) > 0 ||
      m.pendingApproval ||
      m.agentPhase ||
      m.status?.trim() ||
      m.streaming,
  );
}

export const STORE_VERSION = 3 as const;
const CHAT_STORAGE_KEY = "vibe-coding-chat";
const MAX_MESSAGES_PER_SESSION = 120;
const MAX_SESSIONS_PER_PROJECT = 40;
const MAX_STATUS_LOG_LINES = 32;
const MAX_TURN_TRACES = 24;
const MAX_NARRATIVE_CHARS = 800;
const MAX_PROGRESS_NARRATIVE_CHARS = 2400;
const MAX_MODEL_STEP_CHARS = 500;
const MAX_TOOL_CALL_ARGS_CHARS = 240;
const MAX_TOOL_ARGS_DISK_CHARS = 400;
const MAX_PERSISTED_IMAGES = 4;
/** Align with agent compress cap so memory previews match what session-sync can externalize. */
const MAX_PERSISTED_IMAGE_CHARS = MAX_AGENT_IMAGE_BYTES;
const MAX_DISK_IMAGES = 8;
const MAX_DISK_IMAGE_CHARS = MAX_AGENT_IMAGE_BYTES;

/** Full session payloads live in memory (and on disk); not in localStorage. */
const memoryByProject = new Map<string, ProjectChatRecord>();
/** Parsed localStorage index; invalidated when backing storage changes. */
let indexCache: ChatStoreIndex | null = null;
let indexCacheRaw: string | null = null;

const MAX_DELETED_SESSION_IDS = 200;

function readDeletedSessionIds(projectKey: string): string[] {
  return readIndex().byProject[projectKey]?.deletedSessionIds || [];
}

function persistDeletedSessionId(projectPath: string, sessionId: string): void {
  const key = normalizeProjectKey(projectPath);
  const id = sessionId.trim();
  if (!key || !id) return;
  const index = readIndex();
  const previous = index.byProject[key]?.deletedSessionIds || [];
  if (previous.includes(id)) return;
  const deletedSessionIds = [...previous, id].slice(-MAX_DELETED_SESSION_IDS);
  const existing = index.byProject[key];
  index.byProject[key] = existing
    ? { ...existing, deletedSessionIds }
    : { activeSessionId: "", sessions: [], deletedSessionIds };
  writeIndex(index);
}

export function markSessionLocallyDeleted(projectPath: string, sessionId: string) {
  persistDeletedSessionId(projectPath, sessionId);
}

export function isSessionRecentlyDeletedLocally(projectPath: string, sessionId: string): boolean {
  return isRecentlyDeletedSession(projectPath, sessionId);
}

function isRecentlyDeletedSession(projectPath: string, sessionId: string): boolean {
  const key = normalizeProjectKey(projectPath);
  const id = sessionId.trim();
  if (!key || !id) return false;
  return readDeletedSessionIds(key).includes(id);
}

function mergeDeletedSessionIds(existing?: string[], incoming?: string[]): string[] | undefined {
  const merged = [...new Set([...(existing || []), ...(incoming || [])])];
  if (!merged.length) return undefined;
  return merged.slice(-MAX_DELETED_SESSION_IDS);
}

function syncDeletedSessionIdsFromSnapshot(projectPath: string, incoming?: string[]): void {
  const key = normalizeProjectKey(projectPath);
  if (!key || !incoming?.length) return;
  const index = readIndex();
  const existing = index.byProject[key];
  const deletedSessionIds = mergeDeletedSessionIds(existing?.deletedSessionIds, incoming);
  if (!deletedSessionIds) return;
  index.byProject[key] = existing
    ? { ...existing, deletedSessionIds }
    : { activeSessionId: "", sessions: [], deletedSessionIds };
  writeIndex(index);
}

function filterOutRecentlyDeletedDiskSessions(
  projectPath: string,
  sessions: VibeChatSession[],
): VibeChatSession[] {
  return sessions.filter((s) => !isRecentlyDeletedSession(projectPath, s.id));
}

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

import { normalizeProjectPath as normalizeProjectKey } from "../utils/normalizePath";

export function vibeProjectPathsMatch(a: string, b: string): boolean {
  const left = normalizeProjectKey(a);
  const right = normalizeProjectKey(b);
  return Boolean(left && right && left === right);
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
  writtenFiles?: string[];
  planFilePath?: string;
  imageRefs?: PersistedImageRef[];
  imageCount?: number;
  tools?: Array<{
    name?: string;
    title?: string;
    summary?: string;
    ok?: boolean;
    running?: boolean;
  }>;
  roundGroups?: Array<{
    turn: number;
    narrative?: string;
    response?: { assistantText: string; isFinal: boolean };
  }>;
  turnTraces?: PersistedTurnTrace[];
};

const TOOL_SUMMARY_MARKER = /(?:\[工具摘要\]|<!--\s*agent-tool-log\s*-->)/u;

const TOOL_SUMMARY_BLOCK_RE =
  /\n*(?:(?:\[工具摘要\]|<!--\s*agent-tool-log\s*-->)\n(?:- .*(?:\n|$))+)+\n*/gu;

/** Incomplete tail while streaming (header / marker with partial bullet list). */
const TOOL_SUMMARY_TAIL_RE =
  /\n*(?:\[工具摘要\]|<!--\s*agent-tool-log\s*-->)\s*[\s\S]*$/u;

const TOOL_SUMMARY_MARKDOWN_TAIL_RE = /\n*#{1,3}\s*工具摘要\s*[\s\S]*$/u;

/** Lines echoing tool step labels + summaries (model leak, with or without marker header). */
const TOOL_ACTION_LINE_RE =
  /^[-*•>\s]*(?:读取文件|列出目录|浏览目录|搜索代码|搜索内容|搜索文件|写入文件|局部修改|删除文件|执行命令|联网搜索|抓取网页)[：:]\s*.+$/u;

const TOOL_SUMMARY_HEADING_RE = /^#{1,3}\s*工具摘要\s*$/;

/** Strip tool-log blocks and leaked tool-action bullet lines from assistant text shown to the user. */
export function stripToolSummaryFromAssistantContent(text: string): string {
  if (!text?.trim()) return text;

  const markerIdx = text.search(/<!--\s*agent-tool-log\b/i);
  let result = markerIdx >= 0 ? text.slice(0, markerIdx) : text;

  result = result
    .replace(TOOL_SUMMARY_BLOCK_RE, "\n")
    .replace(TOOL_SUMMARY_TAIL_RE, "")
    .replace(TOOL_SUMMARY_MARKDOWN_TAIL_RE, "");

  const kept: string[] = [];

  for (const line of result.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push("");
      continue;
    }
    if (TOOL_SUMMARY_HEADING_RE.test(trimmed)) continue;
    if (TOOL_SUMMARY_MARKER.test(trimmed)) continue;
    if (TOOL_ACTION_LINE_RE.test(trimmed)) continue;
    kept.push(line);
  }

  return sanitizeUserVisibleAssistantText(kept.join("\n").replace(/\n{3,}/g, "\n\n"));
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
  return lines.length ? `\n\n<!-- agent-tool-log -->\n${lines.join("\n")}` : "";
}

/**
 * Extract agent analysis from roundGroups for history context.
 * When a run is interrupted, msg.content only has the failure banner,
 * but the actual analysis lives in roundGroups[].narrative.
 */
function extractRoundGroupAnalysisForHistory(
  msg: Pick<AgentHistorySourceMessage, "roundGroups" | "turnTraces" | "content">,
): string {
  const direct = stripToolSummaryFromAssistantContent(msg.content?.trim() || "");
  const hasRunStructure = Boolean(
    msg.roundGroups?.some((g) => g.turn > 0) || msg.turnTraces?.length,
  );
  const hasFinalAnswer = Boolean(
    msg.roundGroups?.filter((g) => g.response?.isFinal && g.response.assistantText.trim()).length,
  );
  if (!hasRunStructure || hasFinalAnswer || !direct) return "";

  const narratives: string[] = [];
  for (const g of msg.roundGroups ?? []) {
    if (g.turn <= 0) continue;
    const text = g.narrative?.trim() || g.response?.assistantText?.trim() || "";
    if (text && !narratives.includes(text)) narratives.push(text);
  }
  if (!narratives.length) return "";
  const joined = narratives.join("\n");
  return joined.length > 1200 ? `${joined.slice(0, 1200)}…` : joined;
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
): Array<{ role: "user" | "assistant"; content: string; writtenFiles?: string[]; planFilePath?: string }> {
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
        const analysis = extractRoundGroupAnalysisForHistory(m);
        if (analysis) {
          content = `${content}\n\n[前轮 Agent 分析]\n${analysis}`.trim();
        }
        content = `${content}${summarizeToolsForHistory(m.tools)}`.trim();
      }
      if (!content) return null;
      return {
        role: m.role,
        content,
        ...(m.role === "assistant" && m.writtenFiles?.length ? { writtenFiles: [...m.writtenFiles] } : {}),
        ...(m.role === "assistant" && m.planFilePath?.trim()
          ? { planFilePath: m.planFilePath.trim() }
          : {}),
      };
    })
    .filter((m): m is { role: "user" | "assistant"; content: string; writtenFiles?: string[]; planFilePath?: string } => m !== null);
}

function sessionTitleFromMessages(messages: PersistedChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (firstUser) return formatSessionTitle(firstUser.content);
  return "新会话";
}

function normalizeSessionTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function sessionHasLoadedMessages(session: Pick<VibeChatSession, "messages">): boolean {
  return session.messages.some(
    (m) =>
      (m.role === "user" && m.content.trim()) ||
      (m.role === "assistant" && m.content.trim()) ||
      (m.tools?.length ?? 0) > 0,
  );
}

function sessionMessageAnchor(session: Pick<VibeChatSession, "messages">): string {
  const firstUser = session.messages.find((m) => m.role === "user");
  const firstAssistant = session.messages.find((m) => m.role === "assistant");
  return `${firstUser?.id?.trim() || ""}|${firstAssistant?.id?.trim() || ""}`;
}

function sessionSignature(
  session: Pick<VibeChatSession, "id" | "title" | "createdAt" | "messages">,
  indexedMessageCount?: number,
): string {
  // Index-only sessions (messages not loaded into memory) must not dedupe by metadata alone.
  if (!sessionHasLoadedMessages(session)) {
    return `id|${session.id}`;
  }
  const firstUser = session.messages.find((m) => m.role === "user")?.content?.trim() || "";
  const firstAssistant = session.messages.find((m) => m.role === "assistant")?.content?.trim() || "";
  const messageCount = Math.max(session.messages.length, indexedMessageCount ?? 0);
  return [
    normalizeSessionTitle(session.title),
    messageCount,
    sessionMessageAnchor(session),
    firstUser.slice(0, 120),
    firstAssistant.slice(0, 120),
  ].join("|");
}

function pickDedupeSessionWinner(
  a: VibeChatSession,
  b: VibeChatSession,
  preferredSessionIds?: ReadonlySet<string>,
): VibeChatSession {
  if (preferredSessionIds?.size) {
    const aPreferred = preferredSessionIds.has(a.id);
    const bPreferred = preferredSessionIds.has(b.id);
    if (aPreferred && !bPreferred) return a;
    if (bPreferred && !aPreferred) return b;
  }
  return a.updatedAt.localeCompare(b.updatedAt) > 0 ? a : b;
}

function dedupeSessionsBySignature(
  sessions: VibeChatSession[],
  indexMessageCountById?: Map<string, number>,
  preferredSessionIds?: ReadonlySet<string>,
): VibeChatSession[] {
  const seen = new Map<string, VibeChatSession>();
  for (const session of sessions) {
    const signature = sessionSignature(session, indexMessageCountById?.get(session.id));
    const existing = seen.get(signature);
    if (!existing) {
      seen.set(signature, session);
      continue;
    }
    seen.set(signature, pickDedupeSessionWinner(session, existing, preferredSessionIds));
  }
  return [...seen.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeProjectRecordSessions(
  record: ProjectChatRecord,
  extraPreferredSessionIds?: Iterable<string>,
): ProjectChatRecord {
  const preferredSessionIds = new Set<string>();
  if (record.activeSessionId) preferredSessionIds.add(record.activeSessionId);
  for (const id of extraPreferredSessionIds || []) {
    const trimmed = id.trim();
    if (trimmed) preferredSessionIds.add(trimmed);
  }
  const sessions = dedupeSessionsBySignature(
    record.sessions,
    undefined,
    preferredSessionIds.size ? preferredSessionIds : undefined,
  );
  const activeSessionId = sessions.some((s) => s.id === record.activeSessionId)
    ? record.activeSessionId
    : sessions[0]?.id || "";
  return { activeSessionId, sessions };
}

/** Dedupe in-memory/index sessions after load; returns true when record changed. */
export function compactProjectSessionRecord(projectPath: string): boolean {
  const key = normalizeProjectKey(projectPath);
  if (!key) return false;
  const record = getProjectRecord(key);
  if (!record?.sessions?.length) return false;
  const normalized = normalizeProjectRecordSessions(record);
  const sameOrder =
    normalized.sessions.length === record.sessions.length
    && normalized.sessions.every((s, i) => s.id === record.sessions[i]?.id);
  if (sameOrder && normalized.activeSessionId === record.activeSessionId) return false;
  persistRecord(key, normalized);
  return true;
}

function truncateText(text: string | undefined | null, max: number): string {
  if (text == null) return "";
  const str = String(text);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

function truncateNarrativeForStorage(text: string | undefined | null): string {
  if (text == null) return "";
  const cleaned = stripToolSummaryFromAssistantContent(text);
  const max = hasAgentProgressMarker(text) ? MAX_PROGRESS_NARRATIVE_CHARS : MAX_NARRATIVE_CHARS;
  return truncateText(cleaned, max);
}

function compactRoundGroupsForStorage(
  groups: PersistedAgentRoundGroup[] | undefined,
): PersistedAgentRoundGroup[] | undefined {
  if (!groups?.length) return undefined;
  return groups.map((group) => {
    const isFinalWithText = group.response?.isFinal && group.response?.assistantText?.trim();
    return {
      turn: group.turn,
      maxTurns: group.maxTurns,
      narrative: isFinalWithText
        ? undefined
        : group.narrative
          ? truncateNarrativeForStorage(group.narrative)
          : undefined,
      modelSteps: (group.modelSteps || []).map((step) => ({
        id: step.id,
        phase: step.phase,
        text: truncateText(step.text, MAX_MODEL_STEP_CHARS),
      })),
      toolIds: group.toolIds ? [...group.toolIds] : [],
      request: group.request
        ? {
            model: group.request.model,
            contextMessages: group.request.contextMessages,
            contextChars: group.request.contextChars,
            messages: group.request.messages.length
              ? [{ role: "system", content: `${group.request.messages.length} 条消息，${group.request.contextChars} 字符` }]
              : [],
          }
        : undefined,
      response: group.response
        ? {
            assistantText: group.response.isFinal
              ? stripToolSummaryFromAssistantContent(group.response.assistantText)
              : truncateNarrativeForStorage(group.response.assistantText),
            hasToolCalls: group.response.hasToolCalls,
            isFinal: group.response.isFinal,
            toolCalls: (group.response.toolCalls || []).map((call) => ({
              id: call.id,
              name: call.name,
              arguments: truncateText(call.arguments, MAX_TOOL_CALL_ARGS_CHARS),
            })),
          }
        : undefined,
    };
  });
}

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

/** Truncate string values inside a tool args object to prevent file bloat. */
function truncateToolArgs(
  args: Record<string, unknown> | undefined,
  maxChars: number,
): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object") return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === "string" && v.length > maxChars ? `${v.slice(0, maxChars)}…` : v;
  }
  return out;
}

function sanitizeMessages(
  messages: PersistedChatMessage[],
  options?: { forDisk?: boolean },
): PersistedChatMessage[] {
  return messages
    .filter(
      (m) =>
        m.role === "user" ||
        shouldPersistAssistantMessage(m) ||
        (m.imageDataUrls?.length ?? 0) > 0 ||
        (m.imageRefs?.length ?? 0) > 0 ||
        (m.imageCount ?? 0) > 0,
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
          args: options?.forDisk ? truncateToolArgs(t.args, MAX_TOOL_ARGS_DISK_CHARS) : t.args,
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
        planFilePath: m.planFilePath || undefined,
        turnFileDiffs:
          m.pendingApproval && m.turnFileDiffs ? { ...m.turnFileDiffs } : undefined,
        pendingApproval: m.pendingApproval || undefined,
        agentAborted: m.agentAborted || undefined,
        agentAbortReason: m.agentAbortReason || undefined,
        agentFailed: m.agentFailed || undefined,
        agentRecoverable: m.agentRecoverable || undefined,
        agentFailureReason: m.agentFailureReason || undefined,
        agentFailureDetail: m.agentFailureDetail || undefined,
        agentRecoveryDismissed: m.agentRecoveryDismissed || undefined,
        agentContinueCount: m.agentContinueCount || undefined,
        rejected: m.rejected || undefined,
        reverted: m.reverted || undefined,
        activityExpanded: m.activityExpanded || undefined,
        activityDetailed: m.activityDetailed || undefined,
        agentSuggestions: m.agentSuggestions?.length ? [...m.agentSuggestions] : undefined,
        streamChars: m.streamChars || undefined,
        contextChars: m.contextChars || undefined,
        ...(options?.forDisk && m.role === "assistant"
          ? {}
          : {
              agentPhase: m.agentPhase || undefined,
              status: m.status?.trim() ? m.status : undefined,
              streaming: m.streaming || undefined,
            }),
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

function createSession(
  messages: PersistedChatMessage[] = [],
  options?: { draft?: boolean },
): VibeChatSession {
  const now = new Date().toISOString();
  const sanitized = sanitizeMessages(messages);
  return {
    id: genSessionId(),
    title: sessionTitleFromMessages(sanitized),
    createdAt: now,
    updatedAt: now,
    messages: sanitized,
    status: options?.draft ? "draft" : "active",
  };
}

function isEmptyDraftSession(session: VibeChatSession): boolean {
  return session.status === "draft" && !session.messages.length;
}

function isDisposableEmptyDraftSession(session: VibeChatSession): boolean {
  return isEmptyDraftSession(session) && !hasComposerDraft(session.id);
}

function resolveSessionListTitle(session: VibeChatSession): string {
  if (session.messages.length) return session.title;
  const preview = composerDraftPreviewText(session.id);
  return preview ? formatSessionTitle(preview) : session.title;
}

function pruneEmptyDraftSessions(record: ProjectChatRecord): void {
  record.sessions = record.sessions.filter((s) => !isDisposableEmptyDraftSession(s));
  if (
    record.activeSessionId
    && !record.sessions.some((s) => s.id === record.activeSessionId)
  ) {
    record.activeSessionId = record.sessions[0]?.id || "";
  }
}

/** Restore a session using an explicit id (e.g. from disk/index) instead of generating a new one. */
function adoptSessionWithId(
  sessionId: string,
  messages: PersistedChatMessage[],
  projectPath: string,
): VibeChatSession {
  const sanitized = sanitizeMessages(messages);
  const key = normalizeProjectKey(projectPath);
  const indexed = key ? readIndex().byProject[key]?.sessions.find((s) => s.id === sessionId) : undefined;
  const now = new Date().toISOString();
  return {
    id: sessionId,
    title: sessionTitleFromMessages(sanitized),
    createdAt: indexed?.createdAt || now,
    updatedAt: now,
    messages: sanitized,
    status: "active",
  };
}

function cloneMessagesShallow(messages: PersistedChatMessage[]): PersistedChatMessage[] {
  return messages.map((m) => ({ ...m }));
}

function cloneRecord(
  record: ProjectChatRecord,
  options?: { sanitizeMessages?: boolean },
): ProjectChatRecord {
  const sanitize = options?.sanitizeMessages !== false;
  return {
    activeSessionId: record.activeSessionId,
    sessions: record.sessions.map((session) => ({
      ...session,
      messages: sanitize
        ? sanitizeMessages(session.messages)
        : cloneMessagesShallow(session.messages),
    })),
  };
}

function projectIndexFromRecord(
  record: ProjectChatRecord,
  previousIndex?: ProjectIndexRecord,
): ProjectIndexRecord {
  const previousById = previousIndex
    ? new Map(previousIndex.sessions.map((s) => [s.id, s]))
    : undefined;
  return {
    activeSessionId: record.activeSessionId,
    sessions: record.sessions.map((session) => {
      const previous = previousById?.get(session.id);
      const memoryCount = session.messages.length;
      const messageCount = memoryCount > 0 ? memoryCount : (previous?.messageCount ?? 0);
      return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount,
      };
    }),
    ...(previousIndex?.deletedSessionIds?.length
      ? { deletedSessionIds: previousIndex.deletedSessionIds }
      : {}),
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
  const raw = lsGet(CHAT_STORAGE_KEY);
  const rawKey = raw ?? "";
  if (indexCache && indexCacheRaw === rawKey) return indexCache;
  if (!raw) {
    indexCache = { version: STORE_VERSION, byProject: {} };
    indexCacheRaw = rawKey;
    return indexCache;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ChatStoreIndex | ChatStoreV2 | ChatStoreV1>;
    if (!parsed || typeof parsed !== "object" || !parsed.byProject) {
      indexCache = { version: STORE_VERSION, byProject: {} };
      indexCacheRaw = rawKey;
      return indexCache;
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
    indexCache = { version: STORE_VERSION, byProject: parsed.byProject as Record<string, ProjectIndexRecord> };
    indexCacheRaw = rawKey;
    return indexCache;
  } catch {
    indexCache = { version: STORE_VERSION, byProject: {} };
    indexCacheRaw = rawKey;
    return indexCache;
  }
}

let storageErrorCallback: ((msg: string) => void) | null = null;

export function onStorageError(cb: (msg: string) => void) {
  storageErrorCallback = cb;
}

function writeIndex(index: ChatStoreIndex): boolean {
  if (!lsSetJson(CHAT_STORAGE_KEY, index)) {
    console.debug("[vibeChatStorage] localStorage index write failed");
    storageErrorCallback?.("浏览器索引写入失败，会话已保存到项目目录。");
    return false;
  }
  indexCache = index;
  indexCacheRaw = JSON.stringify(index);
  return true;
}

function persistRecord(key: string, record: ProjectChatRecord, options?: { preferredSessionIds?: string[] }): boolean {
  const normalized = normalizeProjectRecordSessions(record, options?.preferredSessionIds);
  memoryByProject.set(key, cloneRecord(normalized));
  const index = readIndex();
  const previous = index.byProject[key];
  index.byProject[key] = projectIndexFromRecord(normalized, previous);
  return writeIndex(index);
}

/** Switch active session without re-sanitizing every session payload. */
function persistActiveSessionId(key: string, sessionId: string): boolean {
  const id = sessionId.trim();
  if (!key || !id) return false;

  const cached = memoryByProject.get(key);
  if (cached?.sessions.some((s) => s.id === id)) {
    cached.activeSessionId = id;
  }

  const index = readIndex();
  const previous = index.byProject[key];
  if (!previous?.sessions.some((s) => s.id === id)) return false;
  if (previous.activeSessionId === id && (!cached || cached.activeSessionId === id)) return true;

  index.byProject[key] = { ...previous, activeSessionId: id };
  return writeIndex(index);
}

function getProjectRecord(key: string): ProjectChatRecord | undefined {
  const readOnlyClone = { sanitizeMessages: false as const };
  const cached = memoryByProject.get(key);
  if (cached?.sessions?.length) return cloneRecord(cached, readOnlyClone);

  readIndex();
  const migrated = memoryByProject.get(key);
  if (migrated?.sessions?.length) return cloneRecord(migrated, readOnlyClone);

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

function touchSession(
  session: VibeChatSession,
  messages: PersistedChatMessage[],
  options?: { touchTimestamp?: boolean; skipSanitize?: boolean },
) {
  session.messages = options?.skipSanitize ? messages : sanitizeMessages(messages);
  if (options?.touchTimestamp !== false) {
    session.updatedAt = new Date().toISOString();
  }
  session.title = sessionTitleFromMessages(session.messages);
  if (session.status === "draft" && session.messages.length) {
    session.status = "active";
  }
}

function updateSessionStatus(
  session: VibeChatSession,
  status: "active" | "completed" | "failed" | "interrupted",
) {
  session.status = status;
  session.updatedAt = new Date().toISOString();
}

export function getVibeChatProjectSnapshot(projectPath: string): VibeChatProjectSnapshot {
  const key = normalizeProjectKey(projectPath);
  const record = key ? getProjectRecord(key) : undefined;
  const indexed = key ? readIndex().byProject[key]?.sessions : undefined;
  const listableSessions = key
    ? record?.sessions.filter((s) => sessionHasListableContent(key, s)) || []
    : [];
  const activeRecordId = record?.activeSessionId || "";
  const sessionsForSnapshot = [...listableSessions];
  if (
    activeRecordId
    && !sessionsForSnapshot.some((s) => s.id === activeRecordId)
  ) {
    const activeDraft = record?.sessions.find((s) => s.id === activeRecordId);
    if (activeDraft) sessionsForSnapshot.unshift(activeDraft);
  }
  const activeSessionId =
    activeRecordId && sessionsForSnapshot.some((s) => s.id === activeRecordId)
      ? activeRecordId
      : sessionsForSnapshot[0]?.id || activeRecordId || "";
  return {
    version: STORE_VERSION,
    projectPath,
    activeSessionId,
    deletedSessionIds: key ? readIndex().byProject[key]?.deletedSessionIds : undefined,
    sessions:
      sessionsForSnapshot.map((s) => {
        const indexMeta = indexed?.find((m) => m.id === s.id);
        const messageCount = s.messages.length || indexMeta?.messageCount || 0;
        return {
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount,
          messages: sanitizeMessages(s.messages, { forDisk: true }),
          status: s.status,
        };
      }) || [],
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
  const messages = sanitizeMessages(session.messages, { forDisk: true }).map((message) => {
    if (message.role !== "user" || message.imageDataUrls?.length || !message.imageRefs?.length) {
      return message;
    }
    const previewUrls = resolveChatMessageImageUrls(projectPath, message, sessionId);
    if (!previewUrls.length) return message;
    return { ...message, imageDataUrls: previewUrls };
  });
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages,
  };
}

/** Shallow-clone messages at persist time so delayed disk sync keeps attached base64. */
export function cloneChatMessagesForDiskSync(messages: PersistedChatMessage[]): PersistedChatMessage[] {
  return messages.map((m) => ({
    ...m,
    ...(m.imageDataUrls?.length ? { imageDataUrls: [...m.imageDataUrls] } : {}),
    ...(m.imageRefs?.length ? { imageRefs: m.imageRefs.map((r) => ({ path: r.path })) } : {}),
  }));
}

export function chatMessagesHavePendingImageBase64(messages: PersistedChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "user" &&
      Boolean(m.imageDataUrls?.some((url) => typeof url === "string" && url.startsWith("data:image/"))),
  );
}

/** Disk sync payload: session metadata from store + live Vue messages (keeps image base64 for externalize). */
export function buildActiveSessionDiskSyncPayload(
  projectPath: string,
  sessionId: string,
  liveMessages: PersistedChatMessage[],
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
    messages: sanitizeMessages(liveMessages, { forDisk: true }),
  };
}

/** 诊断用：memory / localStorage 索引 / 列表视图 的 sessionId 快照。 */
export function getSessionDiagSnapshot(projectPath: string): {
  activeSessionId: string;
  memorySessionIds: string[];
  indexSessionIds: string[];
  listSessionIds: string[];
} {
  const key = normalizeProjectKey(projectPath);
  if (!key) {
    return { activeSessionId: "", memorySessionIds: [], indexSessionIds: [], listSessionIds: [] };
  }
  const cached = memoryByProject.get(key);
  const index = readIndex().byProject[key];
  return {
    activeSessionId: cached?.activeSessionId || index?.activeSessionId || "",
    memorySessionIds: cached?.sessions.map((s) => s.id) || [],
    indexSessionIds: index?.sessions.map((s) => s.id) || [],
    listSessionIds: listVibeChatSessions(projectPath).map((s) => s.id),
  };
}

function sessionHasListableContent(key: string, session: VibeChatSession): boolean {
  if (session.status === "draft") {
    return session.messages.length > 0 || hasComposerDraft(session.id);
  }
  if (session.messages.length > 0) return true;
  return Boolean(
    readIndex().byProject[key]?.sessions.some((m) => m.id === session.id && m.messageCount > 0),
  );
}

/** Session list is a direct projection of persisted record; dedupe runs only on write (persistRecord). */
export function listVibeChatSessions(projectPath: string): VibeChatSessionMeta[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const record = getProjectRecord(key);
  if (!record?.sessions?.length) return [];
  return record.sessions
    .filter((s) => sessionHasListableContent(key, s))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((s) => {
      const indexed = readIndex().byProject[key]?.sessions.find((m) => m.id === s.id);
      return {
        id: s.id,
        title: resolveSessionListTitle(s),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length || indexed?.messageCount || 0,
        status: s.status,
      };
    });
}

export function getSessionTitle(projectPath: string, sessionId: string): string | undefined {
  const key = normalizeProjectKey(projectPath);
  if (!key) return undefined;
  const record = getProjectRecord(key);
  return record?.sessions.find((s) => s.id === sessionId)?.title;
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
  if (!record?.sessions?.length || !record.activeSessionId) return [];
  const session = record.sessions.find((s) => s.id === record.activeSessionId);
  if (!session || isEmptyDraftSession(session)) return [];
  return sanitizeMessages(session.messages);
}

export function hasVibeChatHistory(projectPath: string): boolean {
  const key = normalizeProjectKey(projectPath);
  if (!key) return false;
  const record = getProjectRecord(key);
  if (record?.sessions.some((s) => s.messages.length > 0)) return true;
  const indexed = readIndex().byProject[key];
  return Boolean(indexed?.sessions.some((s) => s.messageCount > 0));
}

/** True when disk index has sessions or message counts not reflected in localStorage. */
export function diskChatStoreAheadOfLocalIndex(
  projectPath: string,
  diskSessions: Array<Pick<VibeChatSessionMeta, "id" | "messageCount" | "updatedAt">>,
): boolean {
  const key = normalizeProjectKey(projectPath);
  if (!key || !diskSessions.length) return false;
  const diskFiltered = diskSessions.filter((d) => !isRecentlyDeletedSession(projectPath, d.id));
  const indexed = readIndex().byProject[key];
  const localSessions = indexed?.sessions || [];
  if (!localSessions.length) return diskFiltered.length > 0;

  const localMap = new Map(localSessions.map((s) => [s.id, s]));
  for (const disk of diskFiltered) {
    const local = localMap.get(disk.id);
    if (!local) continue;
    const diskCount = disk.messageCount ?? 0;
    const localCount = local.messageCount ?? 0;
    if (diskCount > localCount) return true;
  }
  return false;
}

/** Session ids present in local index whose disk copy has more messages than the index records. */
export function sessionIdsWithDiskAheadMessageCounts(
  projectPath: string,
  diskSessions: Array<Pick<VibeChatSessionMeta, "id" | "messageCount">>,
): string[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const indexed = readIndex().byProject[key]?.sessions || [];
  if (!indexed.length) return [];
  const localMap = new Map(indexed.map((s) => [s.id, s]));
  const ids: string[] = [];
  for (const disk of diskSessions) {
    if (isRecentlyDeletedSession(projectPath, disk.id)) continue;
    const local = localMap.get(disk.id);
    if (!local) continue;
    if ((disk.messageCount ?? 0) > (local.messageCount ?? 0)) ids.push(disk.id);
  }
  return ids;
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
    const session = record?.sessions.find((s) => s.id === meta.id);
    if (expected <= 0) continue;
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

function snapshotSessionsToRecord(snapshot: VibeChatProjectSnapshot): VibeChatSession[] {
  return snapshot.sessions.map((s) => ({
    id: s.id,
    title: s.title || "新会话",
    createdAt: s.createdAt || new Date().toISOString(),
    updatedAt: s.updatedAt || new Date().toISOString(),
    messages: sanitizeMessages(s.messages || [], { forDisk: true }),
    status: s.status || "active",
  }));
}

function pickMergedSession(local: VibeChatSession, disk: VibeChatSession): VibeChatSession {
  const localCount = local.messages.length;
  const diskCount = disk.messages.length;
  if (localCount === 0 && diskCount > 0) {
    return { ...local, ...disk, messages: disk.messages };
  }
  if (diskCount > localCount) {
    return { ...local, ...disk, messages: disk.messages };
  }
  if (diskCount > 0 && disk.updatedAt.localeCompare(local.updatedAt) > 0) {
    return { ...local, ...disk, messages: disk.messages };
  }
  return local;
}

/** Merge disk snapshot into local store without dropping unsynced local-only sessions. */
export function mergeChatStoreFromDiskSnapshot(
  snapshot: VibeChatProjectSnapshot,
  expectedProjectPath?: string,
): boolean {
  const key = normalizeProjectKey(snapshot.projectPath);
  if (!key || !snapshot.sessions?.length) return false;
  if (expectedProjectPath && normalizeProjectKey(expectedProjectPath) !== key) return false;

  syncDeletedSessionIdsFromSnapshot(snapshot.projectPath, snapshot.deletedSessionIds);

  // #region session-diag
  sessionDiag("storage:merge-from-disk:before", {
    projectPath: snapshot.projectPath,
    diskSessionIds: snapshot.sessions.map((s) => s.id),
    diskActiveSessionId: snapshot.activeSessionId,
    localBefore: getSessionDiagSnapshot(expectedProjectPath || snapshot.projectPath),
  });
  // #endregion

  const diskSessions = filterOutRecentlyDeletedDiskSessions(
    snapshot.projectPath,
    snapshotSessionsToRecord(snapshot),
  );
  if (!diskSessions.length) return false;
  const existing = getProjectRecord(key);
  if (!existing?.sessions?.length) {
    const record: ProjectChatRecord = {
      activeSessionId:
        snapshot.activeSessionId && diskSessions.some((s) => s.id === snapshot.activeSessionId)
          ? snapshot.activeSessionId
          : diskSessions[0].id,
      sessions: diskSessions,
    };
    persistRecord(key, record);
    return true;
  }

  const mergedMap = new Map<string, VibeChatSession>();
  for (const local of existing.sessions) {
    mergedMap.set(local.id, local);
  }
  for (const disk of diskSessions) {
    const local = mergedMap.get(disk.id);
    if (local) {
      mergedMap.set(disk.id, pickMergedSession(local, disk));
      continue;
    }
    const diskSig = sessionSignature(disk);
    let mergedIntoExisting = false;
    for (const [existingId, existingSession] of mergedMap) {
      if (sessionSignature(existingSession) === diskSig) {
        mergedMap.set(existingId, pickMergedSession(existingSession, disk));
        mergedIntoExisting = true;
        break;
      }
    }
    if (!mergedIntoExisting) {
      mergedMap.set(disk.id, disk);
    }
  }

  const preferredSessionIds = new Set<string>();
  if (existing.activeSessionId) preferredSessionIds.add(existing.activeSessionId);
  if (snapshot.activeSessionId) preferredSessionIds.add(snapshot.activeSessionId);
  const sessions = dedupeSessionsBySignature(
    [...mergedMap.values()],
    undefined,
    preferredSessionIds.size ? preferredSessionIds : undefined,
  );
  const sessionIdSet = new Set(sessions.map((s) => s.id));
  const activeSessionId =
    existing.activeSessionId && sessionIdSet.has(existing.activeSessionId)
      ? existing.activeSessionId
      : snapshot.activeSessionId && sessionIdSet.has(snapshot.activeSessionId)
        ? snapshot.activeSessionId
        : sessions[0]?.id || "";

  persistRecord(key, { activeSessionId, sessions });
  // #region session-diag
  sessionDiag("storage:merge-from-disk:after", {
    projectPath: snapshot.projectPath,
    mergedSessionIds: sessions.map((s) => s.id),
    activeSessionId,
    localAfter: getSessionDiagSnapshot(expectedProjectPath || snapshot.projectPath),
  });
  // #endregion
  return true;
}

type DiskIndexMirrorInput = {
  activeSessionId: string;
  deletedSessionIds?: string[];
  sessions: Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    status?: string;
  }>;
};

/** Project index in localStorage is authoritative on write; disk is read-only on hydrate. */
export function syncLocalIndexFromRecord(projectPath: string): void {
  const key = normalizeProjectKey(projectPath);
  if (!key) return;
  const record = getProjectRecord(key);
  if (!record) return;
  const index = readIndex();
  index.byProject[key] = projectIndexFromRecord(record, index.byProject[key]);
  writeIndex(index);
}

/** Align localStorage index with disk chat-store.json metadata (hydrate read path only). */
export function mirrorLocalIndexFromDiskMeta(projectPath: string, disk: DiskIndexMirrorInput): void {
  const key = normalizeProjectKey(projectPath);
  if (!key) return;
  const index = readIndex();
  const localMeta = index.byProject[key];
  const localRecord = getProjectRecord(key);
  const diskIds = new Set(disk.sessions.map((s) => s.id));
  const merged = disk.sessions.map((s) => ({
    id: s.id,
    title: s.title || "新会话",
    createdAt: s.createdAt || "",
    updatedAt: s.updatedAt || "",
    messageCount: s.messageCount ?? 0,
  }));

  for (const local of localMeta?.sessions || []) {
    if (diskIds.has(local.id)) continue;
    const mem = localRecord?.sessions.find((s) => s.id === local.id);
    const hasContent = (mem?.messages.length ?? 0) > 0 || (local.messageCount ?? 0) > 0;
    if (!hasContent) continue;
    merged.push({
      id: local.id,
      title: local.title || mem?.title || "新会话",
      createdAt: local.createdAt || mem?.createdAt || "",
      updatedAt: local.updatedAt || mem?.updatedAt || "",
      messageCount: mem?.messages.length || local.messageCount || 0,
    });
    diskIds.add(local.id);
  }

  for (const mem of localRecord?.sessions || []) {
    if (diskIds.has(mem.id)) continue;
    if (!mem.messages.length) continue;
    merged.push({
      id: mem.id,
      title: mem.title || "新会话",
      createdAt: mem.createdAt || "",
      updatedAt: mem.updatedAt || "",
      messageCount: mem.messages.length,
    });
  }

  const localActive = localMeta?.activeSessionId || localRecord?.activeSessionId || "";
  const diskActive = disk.activeSessionId || "";
  const activeSessionId =
    localActive && !disk.sessions.some((s) => s.id === localActive) && merged.some((s) => s.id === localActive)
      ? localActive
      : diskActive || localActive;

  const deletedSessionIds = mergeDeletedSessionIds(localMeta?.deletedSessionIds, disk.deletedSessionIds);
  index.byProject[key] = {
    activeSessionId,
    sessions: merged,
    ...(deletedSessionIds ? { deletedSessionIds } : {}),
  };
  writeIndex(index);
}

export function mirrorLocalIndexFromDiskSnapshot(projectPath: string, snapshot: VibeChatProjectSnapshot): void {
  mirrorLocalIndexFromDiskMeta(projectPath, {
    activeSessionId: snapshot.activeSessionId || "",
    deletedSessionIds: snapshot.deletedSessionIds,
    sessions: snapshot.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount ?? s.messages?.length ?? 0,
      status: s.status,
    })),
  });
}

/** Cold start: replace local record from disk instead of merging with stale local state. */
export function replaceChatStoreFromDiskSnapshot(
  snapshot: VibeChatProjectSnapshot,
  expectedProjectPath?: string,
): boolean {
  const key = normalizeProjectKey(snapshot.projectPath);
  if (!key || !snapshot.sessions?.length) return false;
  if (expectedProjectPath && normalizeProjectKey(expectedProjectPath) !== key) return false;

  syncDeletedSessionIdsFromSnapshot(snapshot.projectPath, snapshot.deletedSessionIds);

  sessionDiag("storage:replace-from-disk:before", {
    projectPath: snapshot.projectPath,
    diskSessionIds: snapshot.sessions.map((s) => s.id),
    localBefore: getSessionDiagSnapshot(expectedProjectPath || snapshot.projectPath),
  });

  const diskSessions = filterOutRecentlyDeletedDiskSessions(
    snapshot.projectPath,
    snapshotSessionsToRecord(snapshot),
  );
  if (!diskSessions.length) return false;

  const activeSessionId =
    snapshot.activeSessionId && diskSessions.some((s) => s.id === snapshot.activeSessionId)
      ? snapshot.activeSessionId
      : diskSessions[0].id;

  persistRecord(key, { activeSessionId, sessions: diskSessions });
  mirrorLocalIndexFromDiskSnapshot(expectedProjectPath || snapshot.projectPath, snapshot);

  sessionDiag("storage:replace-from-disk:after", {
    projectPath: snapshot.projectPath,
    sessionIds: diskSessions.map((s) => s.id),
    activeSessionId,
    localAfter: getSessionDiagSnapshot(expectedProjectPath || snapshot.projectPath),
  });
  return true;
}

export function restoreChatStoreFromSnapshot(
  snapshot: VibeChatProjectSnapshot,
  expectedProjectPath?: string,
): boolean {
  return mergeChatStoreFromDiskSnapshot(snapshot, expectedProjectPath);
}

export function saveVibeChatHistory(
  projectPath: string,
  messages: PersistedChatMessage[],
  sessionId?: string,
  options?: { setActive?: boolean; touchTimestamp?: boolean },
): { ok: boolean; sessionId: string } {
  const key = normalizeProjectKey(projectPath);
  if (!key) return { ok: false, sessionId: "" };
  const sanitized = sanitizeMessages(messages);
  if (!sanitized.length) return { ok: true, sessionId: sessionId || "" };
  const setActive = options?.setActive !== false;

  let record = getProjectRecord(key);
  if (!record) {
    if (sessionId && isRecentlyDeletedSession(projectPath, sessionId)) {
      return { ok: true, sessionId };
    }
    const session = sessionId ? adoptSessionWithId(sessionId, sanitized, projectPath) : createSession(sanitized);
    record = { activeSessionId: session.id, sessions: [session] };
    return { ok: persistRecord(key, record), sessionId: session.id };
  }

  let session = sessionId ? record.sessions.find((s) => s.id === sessionId) : undefined;
  if (!session) {
    if (sessionId) {
      if (isRecentlyDeletedSession(projectPath, sessionId)) {
        return { ok: true, sessionId };
      }
      session = adoptSessionWithId(sessionId, sanitized, projectPath);
      record.sessions.unshift(session);
      // #region session-diag
      sessionDiag("storage:adopt-session-id", {
        projectPath,
        sessionId,
        messageCount: sanitized.length,
        localBefore: getSessionDiagSnapshot(projectPath),
      });
      // #endregion
    } else {
      session = createSession(sanitized);
      record.sessions.unshift(session);
      // #region session-diag
      sessionDiag("storage:save-new-session", {
        projectPath,
        requestedSessionId: "",
        createdSessionId: session.id,
        messageCount: sanitized.length,
        localBefore: getSessionDiagSnapshot(projectPath),
      });
      // #endregion
    }
  } else {
    touchSession(session, sanitized, {
      touchTimestamp: options?.touchTimestamp,
      skipSanitize: true,
    });
  }

  if (record.sessions.length > MAX_SESSIONS_PER_PROJECT) {
    record.sessions = record.sessions.slice(0, MAX_SESSIONS_PER_PROJECT);
  }
  if (setActive) {
    record.activeSessionId = session.id;
  }
  return { ok: persistRecord(key, record, { preferredSessionIds: [session.id] }), sessionId: session.id };
}

/** Read session messages without switching active session (for search / preview). */
export function peekVibeChatSessionMessages(projectPath: string, sessionId: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key || !sessionId) return [];
  const record = getProjectRecord(key);
  const session = record?.sessions.find((s) => s.id === sessionId);
  return session ? sanitizeMessages(session.messages) : [];
}

/** Reject persist when in-memory messages clearly belong to another session (anchor id mismatch). */
export function chatMessagesMatchSessionAnchor(
  projectPath: string,
  sessionId: string,
  messages: PersistedChatMessage[],
): boolean {
  const sid = sessionId.trim();
  if (!sid || !messages.length) return false;
  const stored = peekVibeChatSessionMessages(projectPath, sid);
  if (!stored.length) return true;
  const anchorId = stored[0]?.id?.trim();
  if (!anchorId) return true;
  return messages[0]?.id?.trim() === anchorId;
}

export function switchVibeChatSession(projectPath: string, sessionId: string): void {
  const key = normalizeProjectKey(projectPath);
  const id = sessionId.trim();
  if (!key || !id) return;
  persistActiveSessionId(key, id);
}

/** Update draft session metadata when leaving with unsent composer content. */
export function touchComposerOnlyDraftSession(projectPath: string, sessionId: string): void {
  const key = normalizeProjectKey(projectPath);
  if (!key || !sessionId) return;
  const record = getProjectRecord(key);
  if (!record) return;
  const session = record.sessions.find((s) => s.id === sessionId);
  if (!session || session.status !== "draft" || session.messages.length) return;
  const preview = composerDraftPreviewText(sessionId);
  if (preview) session.title = formatSessionTitle(preview);
  session.updatedAt = new Date().toISOString();
  persistRecord(key, record);
}

/** Drop an empty draft session (e.g. when switching away or starting a new draft). */
export function abandonVibeChatDraftIfEmpty(projectPath: string, sessionId: string): void {
  const key = normalizeProjectKey(projectPath);
  if (!key || !sessionId) return;
  const record = getProjectRecord(key);
  if (!record) return;
  const session = record.sessions.find((s) => s.id === sessionId);
  if (!session || !isDisposableEmptyDraftSession(session)) return;

  record.sessions = record.sessions.filter((s) => s.id !== sessionId);
  removeComposerDraft(sessionId);
  if (record.activeSessionId === sessionId) {
    record.activeSessionId = record.sessions[0]?.id || "";
  }
  if (!record.sessions.length) {
    memoryByProject.delete(key);
    const index = readIndex();
    delete index.byProject[key];
    writeIndex(index);
    return;
  }
  persistRecord(key, record);
}

/** Persist or drop a draft when leaving it (composer-only drafts stay listable). */
export function finalizeDraftSessionOnLeave(projectPath: string, sessionId: string): void {
  if (!sessionId) return;
  if (hasComposerDraft(sessionId)) {
    touchComposerOnlyDraftSession(projectPath, sessionId);
    return;
  }
  abandonVibeChatDraftIfEmpty(projectPath, sessionId);
}

/** Create a draft session and optionally make it active. Empty drafts are not listed until first message. */
export function beginVibeChatDraftSession(
  projectPath: string,
  options?: { setActive?: boolean },
): { id: string; messages: PersistedChatMessage[] } {
  const key = normalizeProjectKey(projectPath);
  if (!key) return { id: "", messages: [] };
  let record = getProjectRecord(key);
  if (!record) {
    record = { activeSessionId: "", sessions: [] };
  }
  pruneEmptyDraftSessions(record);
  const session = createSession([], { draft: true });
  record.sessions.unshift(session);
  if (record.sessions.length > MAX_SESSIONS_PER_PROJECT) {
    const removed = record.sessions.pop();
    if (removed?.id === record.activeSessionId && record.sessions.length) {
      record.activeSessionId = record.sessions[0].id;
    }
  }
  if (options?.setActive !== false) record.activeSessionId = session.id;
  persistRecord(key, record);
  sessionDiag("storage:begin-draft", {
    projectPath,
    sessionId: session.id,
    local: getSessionDiagSnapshot(projectPath),
  });
  return { id: session.id, messages: [] };
}

/**
 * Resolve the active session id for UI binding.
 * Does not create sessions — composer drafts live in localStorage until first send.
 */
export function resolveActiveVibeChatSessionId(projectPath: string): string {
  const key = normalizeProjectKey(projectPath);
  if (!key) return "";
  const record = getProjectRecord(key);
  if (!record?.sessions.length) return "";

  pruneEmptyDraftSessions(record);
  if (!record.sessions.length) {
    record.activeSessionId = "";
    persistRecord(key, record);
    return "";
  }

  if (record.activeSessionId) {
    const active = record.sessions.find((s) => s.id === record.activeSessionId);
    if (
      active
      && (!isEmptyDraftSession(active) || hasComposerDraft(active.id))
    ) {
      return record.activeSessionId;
    }
  }

  const firstListable = record.sessions.find((s) => sessionHasListableContent(key, s));
  if (firstListable) {
    record.activeSessionId = firstListable.id;
    persistRecord(key, record);
    return firstListable.id;
  }

  record.activeSessionId = "";
  persistRecord(key, record);
  return "";
}

/** @deprecated Prefer beginVibeChatDraftSession for new-session UI; kept for tests. */
export function createVibeChatSession(projectPath: string): { id: string; messages: PersistedChatMessage[] } {
  const key = normalizeProjectKey(projectPath);
  if (!key) return { id: "", messages: [] };
  let record = getProjectRecord(key);
  if (!record) {
    record = { activeSessionId: "", sessions: [] };
  }
  pruneEmptyDraftSessions(record);
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

  // #region session-diag
  sessionDiag("storage:delete:before", {
    projectPath,
    sessionId,
    local: getSessionDiagSnapshot(projectPath),
  });
  // #endregion

  markSessionLocallyDeleted(projectPath, sessionId);
  removeComposerDraft(sessionId);

  if (record.sessions.length === 1) {
    memoryByProject.delete(key);
    const index = readIndex();
    const deletedSessionIds = index.byProject[key]?.deletedSessionIds;
    if (deletedSessionIds?.length) {
      index.byProject[key] = { activeSessionId: "", sessions: [], deletedSessionIds };
    } else {
      delete index.byProject[key];
    }
    writeIndex(index);
    // #region session-diag
    sessionDiag("storage:delete:after-last", {
      projectPath,
      sessionId,
      local: getSessionDiagSnapshot(projectPath),
    });
    // #endregion
    return [];
  }

  record.sessions = record.sessions.filter((s) => s.id !== sessionId);
  if (record.activeSessionId === sessionId) {
    record.activeSessionId = record.sessions[0].id;
  }
  persistRecord(key, record);
  const result = sanitizeMessages(getActiveSession(record).messages);
  // #region session-diag
  sessionDiag("storage:delete:after", {
    projectPath,
    sessionId,
    local: getSessionDiagSnapshot(projectPath),
  });
  // #endregion
  return result;
}

export function updateVibeChatSessionStatus(
  projectPath: string,
  sessionId: string,
  status: "active" | "completed" | "failed" | "interrupted",
): boolean {
  const key = normalizeProjectKey(projectPath);
  if (!key) return false;
  const record = getProjectRecord(key);
  if (!record?.sessions?.length) return false;
  const session = record.sessions.find((s) => s.id === sessionId);
  if (!session) return false;
  updateSessionStatus(session, status);
  persistRecord(key, record);
  return true;
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

/** Logical prefix in copy templates — not a path under the project root. */
export const VIBE_CHAT_SESSIONS_LOGICAL_DIR = "aiall/vibe-chat-sessions";

/** On-disk session directory (%APPDATA% on Windows). See AGENTS.md. */
export function vibeChatSessionDiskDir(): string {
  return "%APPDATA%\\aiall\\vibe-chat-sessions";
}

export function vibeChatSessionLocalFileName(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `chat-${safe}.json`;
}

export function vibeChatSessionDiskFilePath(sessionId: string): string {
  return `${vibeChatSessionDiskDir()}\\${vibeChatSessionLocalFileName(sessionId)}`;
}

export function vibeChatSessionStoreDiskPath(): string {
  return `${vibeChatSessionDiskDir()}\\chat-store.json`;
}
