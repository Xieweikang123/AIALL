import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useSessionManager } from "./useSessionManager";
import { useChatSessionStore } from "./useChatSessionStore";
import {
  deleteVibeChatSession,
  listVibeChatSessions,
  loadVibeChatHistory,
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("ensureSessionForSend creates session without clearing chat messages", () => {
    const projectPath = "D:/projects/ensure-send";
    const session = useSessionManager(() => projectPath);
    const chatMessages = ref([{ id: "u1", role: "user" as const, content: "draft text" }]);
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

    expect(session.activeSessionId.value).toBe("");
    const id = store.ensureSessionForSend();
    expect(id).toBeTruthy();
    expect(session.activeSessionId.value).toBe(id);
    expect(chatMessages.value).toEqual([{ id: "u1", role: "user", content: "draft text" }]);
    expect(listVibeChatSessions(projectPath)).toHaveLength(0);
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

  it("persistChatNow refreshes updatedAt for sidebar date grouping", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-15T08:00:00.000Z"));
    const projectPath = "D:/projects/persist-updated-at";
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
    const sessionId = session.activeSessionId.value;
    chatMessages.value = [{ id: "u-new", role: "user", content: "today's message" }];

    vi.setSystemTime(new Date("2026-06-23T10:00:00.000Z"));
    store.persistChatNow();

    const meta = listVibeChatSessions(projectPath).find((s) => s.id === sessionId)!;
    expect(meta.updatedAt).toBe("2026-06-23T10:00:00.000Z");
    vi.useRealTimers();
  });

  it("schedulePersistDuringAgentRun persists while chatSending blocks schedulePersistChat", async () => {
    const projectPath = "D:/projects/persist-during-run";
    const session = useSessionManager(() => projectPath);
    const chatMessages = ref<Array<{ id: string; role: "user" | "assistant"; content: string; statusLog?: string[] }>>([]);
    const chatError = ref("");

    const store = useChatSessionStore({
      projectPath: () => projectPath,
      chatMessages,
      chatError,
      chatSending: () => true,
      session,
      normalizeMessages: (msgs) => msgs,
      confirm: async () => true,
    });

    store.startNewSession();
    const draftId = session.activeSessionId.value;
    chatMessages.value = [
      { id: "u1", role: "user", content: "hello from new session" },
      { id: "a1", role: "assistant", content: "", statusLog: ["连接中…"] },
    ];
    store.schedulePersistDuringAgentRun({ sessionId: draftId });
    store.schedulePersistChat();
    await new Promise((r) => setTimeout(r, 450));

    expect(session.activeSessionId.value).toBe(draftId);
    expect(loadVibeChatHistory(projectPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "u1", role: "user", content: "hello from new session" }),
      ]),
    );
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toContain(draftId);
  });

  it("switchSession applies local state immediately without waiting on disk hydrate", async () => {
    const projectPath = "D:/projects/switch-immediate";
    const { sessionId: sessionA } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "session A" },
    ]);
    const { sessionId: sessionB } = saveVibeChatHistory(projectPath, [
      { id: "u2", role: "user", content: "session B" },
    ]);

    const session = useSessionManager(() => projectPath);
    session.setActiveSession(sessionA);
    session.refreshSessionList();

    const chatMessages = ref([{ id: "u1", role: "user" as const, content: "session A" }]);
    const chatError = ref("");
    let diskHydrateStarted = false;
    let releaseDiskHydrate: (() => void) | undefined;

    const { fetchSessionMessages } = await import("../services/vibeCodingClient");
    vi.mocked(fetchSessionMessages).mockImplementation(
      () =>
        new Promise((resolve) => {
          diskHydrateStarted = true;
          releaseDiskHydrate = () => resolve({ ok: true, data: { messages: [] } });
        }),
    );

    const store = useChatSessionStore({
      projectPath: () => projectPath,
      chatMessages,
      chatError,
      chatSending: () => true,
      session,
      normalizeMessages: (msgs) => msgs,
      confirm: async () => true,
    });

    store.switchSession(sessionB);

    expect(session.activeSessionId.value).toBe(sessionB);
    expect(chatMessages.value).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "u2", content: "session B" })]),
    );
    expect(diskHydrateStarted).toBe(false);

    releaseDiskHydrate?.();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("startNewSession saves in-flight messages before canceling pending persistence", async () => {
    const projectPath = "D:/projects/new-session-save-order";
    const session = useSessionManager(() => projectPath);
    session.setActiveSession(
      saveVibeChatHistory(projectPath, [{ id: "u0", role: "user", content: "old" }]).sessionId,
    );
    session.refreshSessionList();

    const chatMessages = ref([
      { id: "u-run", role: "user" as const, content: "in flight" },
      { id: "a-run", role: "assistant" as const, content: "", statusLog: ["运行中…"] },
    ]);
    const fromSessionId = session.activeSessionId.value;
    const chatError = ref("");

    const store = useChatSessionStore({
      projectPath: () => projectPath,
      chatMessages,
      chatError,
      chatSending: () => true,
      session,
      normalizeMessages: (msgs) => msgs,
      confirm: async () => true,
    });

    store.persistChatNow();
    store.startNewSession();

    expect(loadVibeChatHistory(projectPath)).toEqual([]);
    expect(listVibeChatSessions(projectPath).some((s) => s.id === fromSessionId)).toBe(true);
    const saved = listVibeChatSessions(projectPath).find((s) => s.id === fromSessionId);
    expect(saved?.messageCount).toBeGreaterThan(0);
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
