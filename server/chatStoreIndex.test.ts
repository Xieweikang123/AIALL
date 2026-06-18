import { describe, expect, it } from "vitest";
import { buildSessionIndexEntry, patchChatStoreIndex, removeChatStoreIndexSession } from "./chatStoreIndex";

describe("chatStoreIndex", () => {
  it("builds index entry from session payload", () => {
    const entry = buildSessionIndexEntry(
      {
        id: "s1",
        title: "测试",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        messages: [{ role: "user" }, { role: "assistant" }],
      },
      "s1",
    );
    expect(entry.messageCount).toBe(2);
    expect(entry.file).toBe("chat-s1.json");
  });

  it("patches existing session meta without dropping others", () => {
    const next = patchChatStoreIndex(
      {
        syncedAt: "old",
        version: 3,
        projectPath: "D:/proj",
        activeSessionId: "s1",
        sessions: [
          {
            id: "s2",
            title: "other",
            createdAt: "a",
            updatedAt: "a",
            messageCount: 0,
            file: "chat-s2.json",
          },
        ],
      },
      {
        id: "s1",
        title: "active",
        createdAt: "c",
        updatedAt: "u",
        messageCount: 2,
        file: "chat-s1.json",
      },
      { activeSessionId: "s1", projectPath: "D:/proj" },
    );
    expect(next.sessions).toHaveLength(2);
    expect(next.sessions.find((s) => s.id === "s1")?.messageCount).toBe(2);
    expect(next.syncedAt).not.toBe("old");
  });

  it("removes session from index and reassigns activeSessionId", () => {
    const next = removeChatStoreIndexSession(
      {
        syncedAt: "old",
        version: 3,
        projectPath: "D:/proj",
        activeSessionId: "s1",
        sessions: [
          {
            id: "s1",
            title: "gone",
            createdAt: "a",
            updatedAt: "a",
            messageCount: 1,
            file: "chat-s1.json",
          },
          {
            id: "s2",
            title: "keep",
            createdAt: "b",
            updatedAt: "b",
            messageCount: 2,
            file: "chat-s2.json",
          },
        ],
      },
      "s1",
    );
    expect(next.sessions.map((s) => s.id)).toEqual(["s2"]);
    expect(next.activeSessionId).toBe("s2");
  });
});
