export type PersistedChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: Array<{
    id: string;
    label: string;
    summary: string;
    ok: boolean;
  }>;
};

const CHAT_STORAGE_KEY = "vibe-coding-chat";
const STORE_VERSION = 1;
const MAX_MESSAGES_PER_PROJECT = 80;

type ChatStore = {
  version: number;
  byProject: Record<string, PersistedChatMessage[]>;
};

function normalizeProjectKey(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

function readStore(): ChatStore {
  const raw = localStorage.getItem(CHAT_STORAGE_KEY);
  if (!raw) return { version: STORE_VERSION, byProject: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatStore>;
    if (!parsed || typeof parsed !== "object" || !parsed.byProject) {
      return { version: STORE_VERSION, byProject: {} };
    }
    return { version: STORE_VERSION, byProject: parsed.byProject };
  } catch {
    return { version: STORE_VERSION, byProject: {} };
  }
}

function writeStore(store: ChatStore) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage 可能已满或被禁用
  }
}

function sanitizeMessages(messages: PersistedChatMessage[]): PersistedChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.content.trim() || (m.tools?.length ?? 0) > 0)
    .slice(-MAX_MESSAGES_PER_PROJECT)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      tools: m.tools?.map((t) => ({
        id: t.id,
        label: t.label,
        summary: t.summary,
        ok: t.ok,
      })),
    }));
}

export function loadVibeChatHistory(projectPath: string): PersistedChatMessage[] {
  const key = normalizeProjectKey(projectPath);
  if (!key) return [];
  const store = readStore();
  return sanitizeMessages(store.byProject[key] || []);
}

export function saveVibeChatHistory(projectPath: string, messages: PersistedChatMessage[]) {
  const key = normalizeProjectKey(projectPath);
  if (!key) return;
  const store = readStore();
  store.byProject[key] = sanitizeMessages(messages);
  writeStore(store);
}

export function clearVibeChatHistory(projectPath: string) {
  const key = normalizeProjectKey(projectPath);
  if (!key) return;
  const store = readStore();
  delete store.byProject[key];
  writeStore(store);
}
