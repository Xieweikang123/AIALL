import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useSessionManager } from "./useSessionManager";
import { useChatSessionStore } from "./useChatSessionStore";
import {
  listVibeChatSessions,
  saveVibeChatHistory,
} from "../services/vibeChatStorage";

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
});
