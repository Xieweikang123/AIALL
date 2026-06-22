import type { GrepMatch, SearchResult } from "./vibeCodingClient";
import type { PersistedChatMessage, VibeChatSessionMeta } from "./vibeChatStorage";

export type QuickSearchKind = "file" | "content" | "session-title" | "session-message";

export interface QuickSearchItem {
  id: string;
  kind: QuickSearchKind;
  title: string;
  subtitle: string;
  snippet?: string;
  filePath?: string;
  line?: number;
  sessionId?: string;
  messageId?: string;
  role?: "user" | "assistant";
}

export interface QuickSearchLocalInput {
  query: string;
  sessions: VibeChatSessionMeta[];
  /** sessionId → messages already in memory */
  sessionMessages: Map<string, PersistedChatMessage[]>;
}

export interface QuickSearchRemoteInput {
  projectPath: string;
  query: string;
  searchFiles: (dir: string, q: string) => Promise<{ ok: boolean; results: SearchResult[]; error?: string }>;
  grepContent: (dir: string, q: string) => Promise<{ ok: boolean; results: GrepMatch[]; error?: string }>;
  loadSessionMessages: (sessionId: string) => Promise<PersistedChatMessage[]>;
  sessions: VibeChatSessionMeta[];
  sessionMessages: Map<string, PersistedChatMessage[]>;
}

const MAX_FILES = 8;
const MAX_CONTENT = 8;
const MAX_SESSION_TITLES = 6;
const MAX_SESSION_MESSAGES = 10;
const MAX_DISK_SESSION_FETCH = 12;

const TOOL_LOG_TAIL_RE = /\n*(?:\[工具摘要\]|<!--\s*agent-tool-log\s*-->)\s*[\s\S]*$/u;

export function normalizeSearchQuery(raw: string): string {
  return raw.trim();
}

export function messageSearchText(content: string): string {
  return content.replace(TOOL_LOG_TAIL_RE, "").replace(/\s+/g, " ").trim();
}

export function extractSearchSnippet(text: string, query: string, maxLen = 120): string {
  const normalized = messageSearchText(text);
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen)}…`;
  const start = Math.max(0, idx - 36);
  const end = Math.min(normalized.length, idx + query.length + 48);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function matchesQuery(text: string, query: string): boolean {
  if (!text || !query) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

export function searchSessionsLocally(input: QuickSearchLocalInput): QuickSearchItem[] {
  const query = normalizeSearchQuery(input.query);
  if (!query) return [];

  const items: QuickSearchItem[] = [];
  const seenTitle = new Set<string>();
  const seenMessage = new Set<string>();

  for (const session of input.sessions) {
    if (matchesQuery(session.title, query) && !seenTitle.has(session.id)) {
      seenTitle.add(session.id);
      items.push({
        id: `session-title:${session.id}`,
        kind: "session-title",
        title: session.title || "未命名会话",
        subtitle: "会话",
        sessionId: session.id,
      });
      if (items.filter((i) => i.kind === "session-title").length >= MAX_SESSION_TITLES) break;
    }
  }

  for (const session of input.sessions) {
    const messages = input.sessionMessages.get(session.id) || [];
    for (const msg of messages) {
      const text = messageSearchText(msg.content || "");
      if (!matchesQuery(text, query)) continue;
      const key = `${session.id}:${msg.id}`;
      if (seenMessage.has(key)) continue;
      seenMessage.add(key);
      items.push({
        id: `session-message:${key}`,
        kind: "session-message",
        title: session.title || "未命名会话",
        subtitle: msg.role === "user" ? "用户消息" : "助手消息",
        snippet: extractSearchSnippet(text, query),
        sessionId: session.id,
        messageId: msg.id,
        role: msg.role,
      });
      if (items.filter((i) => i.kind === "session-message").length >= MAX_SESSION_MESSAGES) {
        return items;
      }
    }
  }

  return items;
}

export function mapFileResults(results: SearchResult[]): QuickSearchItem[] {
  return results.slice(0, MAX_FILES).map((item) => ({
    id: `file:${item.path}`,
    kind: "file" as const,
    title: item.name,
    subtitle: item.path,
    filePath: item.path,
  }));
}

export function mapContentResults(results: GrepMatch[]): QuickSearchItem[] {
  return results.slice(0, MAX_CONTENT).map((item) => ({
    id: `content:${item.path}:${item.line}`,
    kind: "content" as const,
    title: `${item.relative}:${item.line}`,
    subtitle: item.path,
    snippet: item.text.trim(),
    filePath: item.path,
    line: item.line,
  }));
}

export async function runQuickSearchRemote(input: QuickSearchRemoteInput): Promise<{
  files: QuickSearchItem[];
  content: QuickSearchItem[];
  sessions: QuickSearchItem[];
  error?: string;
}> {
  const query = normalizeSearchQuery(input.query);
  if (!query || !input.projectPath.trim()) {
    return { files: [], content: [], sessions: [] };
  }

  const localSessions = searchSessionsLocally({
    query,
    sessions: input.sessions,
    sessionMessages: input.sessionMessages,
  });

  const sessionsNeedingDisk = input.sessions.filter((s) => {
    if ((s.messageCount ?? 0) <= 0) return false;
    const loaded = input.sessionMessages.get(s.id);
    return !loaded?.length;
  }).slice(0, MAX_DISK_SESSION_FETCH);

  const diskMessageMap = new Map(input.sessionMessages);
  if (sessionsNeedingDisk.length) {
    const fetched = await Promise.all(
      sessionsNeedingDisk.map(async (s) => {
        try {
          const messages = await input.loadSessionMessages(s.id);
          return [s.id, messages] as const;
        } catch {
          return [s.id, [] as PersistedChatMessage[]] as const;
        }
      }),
    );
    for (const [sessionId, messages] of fetched) {
      if (messages.length) diskMessageMap.set(sessionId, messages);
    }
  }

  const mergedSessions = searchSessionsLocally({
    query,
    sessions: input.sessions,
    sessionMessages: diskMessageMap,
  });

  const seen = new Set(localSessions.map((i) => i.id));
  const sessions = [...localSessions];
  for (const item of mergedSessions) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      sessions.push(item);
    }
  }

  const [fileResult, grepResult] = await Promise.all([
    input.searchFiles(input.projectPath.trim(), query),
    input.grepContent(input.projectPath.trim(), query),
  ]);

  const errors = [fileResult.error, grepResult.error].filter(Boolean);
  return {
    files: fileResult.ok ? mapFileResults(fileResult.results) : [],
    content: grepResult.ok ? mapContentResults(grepResult.results) : [],
    sessions,
    error: errors.length ? errors.join(" · ") : undefined,
  };
}

export function groupQuickSearchItems(items: {
  files: QuickSearchItem[];
  content: QuickSearchItem[];
  sessions: QuickSearchItem[];
}): Array<{ label: string; items: QuickSearchItem[] }> {
  const groups: Array<{ label: string; items: QuickSearchItem[] }> = [];
  const sessionTitles = items.sessions.filter((i) => i.kind === "session-title");
  const sessionMessages = items.sessions.filter((i) => i.kind === "session-message");
  if (sessionTitles.length) groups.push({ label: "会话", items: sessionTitles });
  if (sessionMessages.length) groups.push({ label: "会话消息", items: sessionMessages });
  if (items.files.length) groups.push({ label: "文件", items: items.files });
  if (items.content.length) groups.push({ label: "代码", items: items.content });
  return groups;
}

export function flattenQuickSearchGroups(groups: Array<{ label: string; items: QuickSearchItem[] }>): QuickSearchItem[] {
  return groups.flatMap((g) => g.items);
}
