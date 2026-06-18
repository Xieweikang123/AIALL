import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useSessionManager } from "./useSessionManager";
import { useChatSessionStore } from "./useChatSessionStore";
import {
  deleteVibeChatSession,
  listVibeChatSessions,
  markSessionLocallyDeleted,
  saveVibeChatHistory,
} from "../services/vibeChatStorage";

vi.mock("../services/vibeCodingClient", () => ({
  fetchChatStoreFromDisk: vi.fn(),
  fetchSessionMessages: vi.fn(),
  syncChatSession: vi.fn(async () => ({ ok: true })),
  syncChatStore: vi.fn(),
}));

function installLocalStorageMock() {
  const storage: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      for (const key of Object.keys(storage)) delete storage[key];
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  });
  return storage;
}

describe("useChatSessionStore", () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.restoreAllMocks();
  });

  it("startNewSession creates draft and keeps refreshSessionList from changing active", () => {
    const projectPath = "D:/projects/chat-store";
    const { sessionId: existingId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "hi" },
    ]);

    const session = useSessionManager(() => projectPath);
    session.setActiveSession(existingId);
    session.refreshSessionList();

    const chatMessages = ref([{ id: "u1", role: "user" as const, content: "hello" }]);
    const chatError = ref("");
    const store = useChatSessionStore({
      projectPath: () => projectPath,
      chatMessages,
      chatError,
      chatSending: () => false,
      session,
      normalizeMessages: (msgs) => msgs,
      confirm: async () => true,
    });

    store.startNewSession();

    expect(session.activeSessionId.value).not.toBe(existingId);
    expect(session.activeSessionId.value).toBeTruthy();
    expect(chatMessages.value).toEqual([]);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual([existingId]);
  });

  it("persistChatNow promotes draft to listable session", () => {
    const projectPath = "D:/projects/persist";
    const session = useSessionManager(() => projectPath);
    const chatMessages = ref<Array<{ id: string; role: "user"; content: string }>>([]);
    const chatError = ref("");

    const store = useChatSessionStore({
      projectPath: () => projectPath,
      chatMessages,
      chatError,
      chatSending: () => false,
      session,
      normalizeMessages: (msgs) => msgs,
      confirm: async () => true,
    });

    store.startNewSession();
    const draftId = session.activeSessionId.value;
    chatMessages.value = [{ id: "u-new", role: "user", content: "first message" }];
    store.persistChatNow();

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toContain(draftId);
  });

  it("delayed disk sync does not resurrect a recently deleted session", async () => {
    const projectPath = "D:/projects/delayed-sync-delete";
    const session = useSessionManager(() => projectPath);
    const chatMessages = ref<Array<{ id: string; role: "user" | "assistant"; content: string }>>([
      { id: "u1", role: "user", content: "滚动条紫色 太显眼" },
      { id: "a1", role: "assistant", content: "assistant reply" },
    ]);
    const chatError = ref("");

    const store = useChatSessionStore({
      projectPath: () => projectPath,
      chatMessages,
      chatError,
      chatSending: () => false,
      session,
      normalizeMessages: (msgs) => msgs,
      confirm: async () => true,
    });

    store.startNewSession();
    const draftId = session.activeSessionId.value;
    chatMessages.value = [
      { id: "u1", role: "user", content: "滚动条紫色 太显眼" },
      { id: "a1", role: "assistant", content: "assistant reply" },
      { id: "u2", role: "user", content: "follow up" },
      { id: "a2", role: "assistant", content: "ok" },
    ];
    store.persistChatNow();

    deleteVibeChatSession(projectPath, draftId);
    markSessionLocallyDeleted(projectPath, draftId);
    session.refreshSessionList();
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).not.toContain(draftId);

    await new Promise((r) => setTimeout(r, 150));

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).not.toContain(draftId);
  });
});
