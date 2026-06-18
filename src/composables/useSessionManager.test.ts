import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionManager } from "./useSessionManager";
import {
  beginVibeChatDraftSession,
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

describe("useSessionManager", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("refreshSessionList is read-only and does not change activeSessionId", () => {
    const projectPath = "D:/projects/draft-session";
    const { sessionId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "hi" },
    ]);

    const session = useSessionManager(() => projectPath);
    session.setActiveSession(sessionId);
    session.refreshSessionList();
    expect(session.activeSessionId.value).toBe(sessionId);

    const draftId = beginVibeChatDraftSession(projectPath).id;
    session.setActiveSession(draftId);
    session.refreshSessionList();
    expect(session.activeSessionId.value).toBe(draftId);
  });
});
