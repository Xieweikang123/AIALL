import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useSessionManager } from "./useSessionManager";
import { useChatSessionStore } from "./useChatSessionStore";
import {
  deleteVibeChatSession,
  listVibeChatSessions,
  loadVibeChatHistory,
  markSessionLocallyDeleted,
  peekVibeChatSessionMessages,
  saveVibeChatHistory,
} from "../services/vibeChatStorage";
import { composerDraftStorageKey } from "../utils/composerDraftStorage";

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

function createStore(
  projectPath: string,
  opts?: {
    chatSending?: () => boolean;
    persistComposerDraft?: () => void;
  },
) {
  const session = useSessionManager(() => projectPath);
  const chatError = ref("");
  const store = useChatSessionStore({
    projectPath: () => projectPath,
    chatError,
    chatSending: opts?.chatSending ?? (() => false),
    session,
    normalizeMessages: (msgs) => msgs,
    confirm: async () => true,
    persistComposerDraft: opts?.persistComposerDraft,
  });
  return { session, store, chatMessages: store.activeMessages, chatError };
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

    const { session, store, chatMessages } = createStore(projectPath);
    session.setActiveSession(existingId);
    session.refreshSessionList();
    store.activateSession(existingId, [{ id: "u1", role: "user", content: "hello" }]);

    store.startNewSession();

    expect(session.activeSessionId.value).not.toBe(existingId);
    expect(session.activeSessionId.value).toBeTruthy();
    expect(chatMessages.value).toEqual([]);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual([existingId]);
  });

  it("switchSession keeps composer-only draft in session list", () => {
    const projectPath = "D:/projects/switch-composer-draft";
    const { sessionId: existingId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "existing" },
      { id: "a1", role: "assistant", content: "ok" },
    ]);

    const session = useSessionManager(() => projectPath);
    session.setActiveSession(existingId);
    session.refreshSessionList();

    const store = useChatSessionStore({
      projectPath: () => projectPath,
      chatError: ref(""),
      chatSending: () => false,
      session,
      normalizeMessages: (msgs) => msgs,
      confirm: async () => true,
      persistComposerDraft: () => {
        localStorage.setItem(
          composerDraftStorageKey(session.activeSessionId.value),
          "composer only draft",
        );
      },
    });

    store.startNewSession();
    const draftId = session.activeSessionId.value;
    store.switchSession(existingId);

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toContain(draftId);
    const draftMeta = listVibeChatSessions(projectPath).find((s) => s.id === draftId);
    expect(draftMeta?.title).toContain("composer only draft");
    expect(localStorage.getItem(composerDraftStorageKey(draftId))).toBe("composer only draft");
  });

  it("ensureSessionForSend creates session without clearing chat messages", () => {
    const projectPath = "D:/projects/ensure-send";
    const { store, session, chatMessages } = createStore(projectPath);
    chatMessages.value.push({ id: "u1", role: "user", content: "draft text" });

    expect(session.activeSessionId.value).toBe("");
    const id = store.ensureSessionForSend();
    expect(id).toBeTruthy();
    expect(session.activeSessionId.value).toBe(id);
    expect(chatMessages.value).toEqual([{ id: "u1", role: "user", content: "draft text" }]);
    expect(listVibeChatSessions(projectPath)).toHaveLength(0);
  });

  it("persistChatNow promotes draft to listable session", () => {
    const projectPath = "D:/projects/persist";
    const { store, session, chatMessages } = createStore(projectPath);

    store.startNewSession();
    const draftId = session.activeSessionId.value;
    chatMessages.value.push({ id: "u-new", role: "user", content: "first message" });
    store.persistChatNow();

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toContain(draftId);
  });

  it("persistChatNow refreshes updatedAt for sidebar date grouping", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-15T08:00:00.000Z"));
    const projectPath = "D:/projects/persist-updated-at";
    const { store, session, chatMessages } = createStore(projectPath);

    store.startNewSession();
    const sessionId = session.activeSessionId.value;
    chatMessages.value.push({ id: "u-new", role: "user", content: "today's message" });

    vi.setSystemTime(new Date("2026-06-23T10:00:00.000Z"));
    store.persistChatNow();

    const meta = listVibeChatSessions(projectPath).find((s) => s.id === sessionId)!;
    expect(meta.updatedAt).toBe("2026-06-23T10:00:00.000Z");
    vi.useRealTimers();
  });

  it("schedulePersistDuringAgentRun skips mid-run persist (done handler persists)", async () => {
    const projectPath = "D:/projects/persist-during-run";
    const { store, session, chatMessages } = createStore(projectPath, { chatSending: () => true });

    store.startNewSession();
    const draftId = session.activeSessionId.value;
    chatMessages.value.push(
      { id: "u1", role: "user", content: "hello from new session" },
      { id: "a1", role: "assistant", content: "", statusLog: ["连接中…"] },
    );
    store.schedulePersistDuringAgentRun({ sessionId: draftId });
    store.schedulePersistChat();
    await new Promise((r) => setTimeout(r, 450));

    expect(session.activeSessionId.value).toBe(draftId);
    expect(loadVibeChatHistory(projectPath)).toEqual([]);
  });

  it("switchSession does not bump target updatedAt when debounced persist fires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T08:00:00.000Z"));
    const projectPath = "D:/projects/switch-no-reorder";
    const { sessionId: sessionB } = saveVibeChatHistory(projectPath, [
      { id: "u2", role: "user", content: "older session" },
    ]);
    const originalUpdatedAtB = listVibeChatSessions(projectPath).find((s) => s.id === sessionB)!.updatedAt;

    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    const { sessionId: sessionA } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "newer session" },
    ]);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)[0]).toBe(sessionA);

    const { session, store } = createStore(projectPath);
    session.setActiveSession(sessionA);
    session.refreshSessionList();
    store.activateSession(sessionA, [{ id: "u1", role: "user", content: "newer session" }]);

    store.switchSession(sessionB);
    store.schedulePersistChat();
    await vi.advanceTimersByTimeAsync(450);

    const updatedAtBAfter = listVibeChatSessions(projectPath).find((s) => s.id === sessionB)!.updatedAt;
    expect(updatedAtBAfter).toBe(originalUpdatedAtB);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)[0]).toBe(sessionA);
  });

  it("persistSessionNow writes registry content for the active session", () => {
    const projectPath = "D:/projects/persist-registry";
    const { sessionId: sessionA } = saveVibeChatHistory(projectPath, [
      { id: "u-a", role: "user", content: "session A" },
    ]);
    saveVibeChatHistory(projectPath, [{ id: "u-b", role: "user", content: "session B" }]);

    const { session, store } = createStore(projectPath);
    session.setActiveSession(sessionA);
    session.refreshSessionList();
    store.activateSession(sessionA, [{ id: "u-a", role: "user", content: "session A" }]);

    store.persistChatNow();

    expect(peekVibeChatSessionMessages(projectPath, sessionA)[0]?.content).toBe("session A");
  });

  it("switchSession preserves in-memory message object references", async () => {
    const projectPath = "D:/projects/switch-preserve-refs";
    const { sessionId: sessionA } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "session A" },
    ]);
    const { sessionId: sessionB } = saveVibeChatHistory(projectPath, [
      { id: "u2", role: "user", content: "session B" },
    ]);

    const session = useSessionManager(() => projectPath);
    const store = useChatSessionStore({
      projectPath: () => projectPath,
      chatError: ref(""),
      chatSending: () => false,
      session,
      // Mirror production: normalize clones message objects.
      normalizeMessages: (msgs) => msgs.map((m) => ({ ...m })),
      confirm: async () => true,
    });
    const chatMessages = store.activeMessages;

    session.setActiveSession(sessionA);
    session.refreshSessionList();

    const assistantMsg = { id: "a1", role: "assistant" as const, content: "", statusLog: ["running"] };
    const liveA = [
      { id: "u1", role: "user" as const, content: "session A live" },
      assistantMsg,
    ];
    store.activateSession(sessionA, liveA);

    store.switchSession(sessionB);
    expect(session.activeSessionId.value).toBe(sessionB);
    expect(store.getSessionMessages(sessionA)?.find((m) => m.id === "a1")).toBe(assistantMsg);

    store.switchSession(sessionA);

    expect(session.activeSessionId.value).toBe(sessionA);
    expect(store.getSessionMessages(sessionA)?.find((m) => m.id === "a1")).toBe(assistantMsg);
    expect(chatMessages.value).toBe(store.getSessionMessages(sessionA));
    expect(chatMessages.value.find((m) => m.id === "a1")).toBe(assistantMsg);
    expect(chatMessages.value.find((m) => m.id === "u1")?.content).toBe("session A live");
  });

  it("switchSession applies local state immediately without waiting on disk hydrate", async () => {
    const projectPath = "D:/projects/switch-immediate";
    const { sessionId: sessionA } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "session A" },
    ]);
    const { sessionId: sessionB } = saveVibeChatHistory(projectPath, [
      { id: "u2", role: "user", content: "session B" },
    ]);

    const { session, store, chatMessages } = createStore(projectPath, { chatSending: () => true });
    session.setActiveSession(sessionA);
    session.refreshSessionList();
    store.activateSession(sessionA, [{ id: "u1", role: "user", content: "session A" }]);

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
    const { session, store, chatMessages } = createStore(projectPath, { chatSending: () => true });
    const fromSessionId = saveVibeChatHistory(projectPath, [{ id: "u0", role: "user", content: "old" }]).sessionId;
    session.setActiveSession(fromSessionId);
    session.refreshSessionList();
    store.activateSession(fromSessionId, [
      { id: "u-run", role: "user", content: "in flight" },
      { id: "a-run", role: "assistant", content: "", statusLog: ["运行中…"] },
    ]);

    store.persistChatNow();
    store.startNewSession();

    expect(loadVibeChatHistory(projectPath)).toEqual([]);
    expect(listVibeChatSessions(projectPath).some((s) => s.id === fromSessionId)).toBe(true);
    const saved = listVibeChatSessions(projectPath).find((s) => s.id === fromSessionId);
    expect(saved?.messageCount).toBeGreaterThan(0);
  });

  it("delayed disk sync does not resurrect a recently deleted session", async () => {
    const projectPath = "D:/projects/delayed-sync-delete";
    const { store, session, chatMessages } = createStore(projectPath);

    store.startNewSession();
    const draftId = session.activeSessionId.value;
    chatMessages.value.push(
      { id: "u1", role: "user", content: "滚动条紫色 太显眼" },
      { id: "a1", role: "assistant", content: "assistant reply" },
      { id: "u2", role: "user", content: "follow up" },
      { id: "a2", role: "assistant", content: "ok" },
    );
    store.persistChatNow();

    deleteVibeChatSession(projectPath, draftId);
    markSessionLocallyDeleted(projectPath, draftId);
    session.refreshSessionList();
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).not.toContain(draftId);

    await new Promise((r) => setTimeout(r, 150));

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).not.toContain(draftId);
  });
});
