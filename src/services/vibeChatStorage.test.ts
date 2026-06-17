import { beforeEach, describe, expect, it, vi } from "vitest";
import { shapeAgentHistoryForProfile } from "./agentRunProfile";
import {
  buildAgentHistoryFromMessages,
  formatSessionTitle,
  getActiveSessionSnapshot,
  getVibeChatProjectSnapshot,
  loadVibeChatHistory,
  restoreChatStoreFromSnapshot,
  sanitizePersistedChatMessages,
  saveVibeChatHistory,
  STORE_VERSION,
  stripReferenceAttachments,
  stripToolSummaryFromAssistantContent,
} from "./vibeChatStorage";

const CHAT_STORAGE_KEY = "vibe-coding-chat";

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

describe("formatSessionTitle", () => {
  it("strips attached reference file blocks", () => {
    const raw = "@new-file121.ts 这是啥文件\n\n## 📎 参考文件\n\n### 📄 new-file121.ts\n```\n2331\n```";
    expect(formatSessionTitle(raw)).toBe("@new-file121.ts 这是啥文件");
  });

  it("truncates long titles", () => {
    const raw = "a".repeat(40);
    expect(formatSessionTitle(raw)).toBe(`${"a".repeat(36)}…`);
  });
});

describe("buildAgentHistoryFromMessages", () => {
  it("includes the first completed exchange when starting turn two", () => {
    const history = buildAgentHistoryFromMessages([
      { role: "user", content: "@new-file121.ts 这是啥文件" },
      { role: "assistant", content: "只有一行数字 2331。" },
    ]);

    expect(history).toEqual([
      { role: "user", content: "@new-file121.ts 这是啥文件" },
      { role: "assistant", content: "只有一行数字 2331。" },
    ]);
  });

  it("skips empty assistant placeholders", () => {
    const history = buildAgentHistoryFromMessages([
      { role: "user", content: "hello" },
      { role: "assistant", content: "   " },
    ]);

    expect(history).toEqual([{ role: "user", content: "hello" }]);
  });

  it("strips reference attachments from user history", () => {
    const raw = "问题\n\n## 📎 参考文件\n\n### file.ts\n```\ncode\n```";
    const history = buildAgentHistoryFromMessages([{ role: "user", content: raw }]);
    expect(history).toEqual([{ role: "user", content: "问题" }]);
    expect(stripReferenceAttachments(raw)).toBe("问题");
  });

  it("appends tool summaries to assistant history", () => {
    const history = buildAgentHistoryFromMessages([
      {
        role: "assistant",
        content: "找到了文件。",
        tools: [{ name: "search_files", title: "搜索文件", summary: "找到 1 个文件", ok: true }],
      },
    ]);
    expect(history[0].content).toContain("找到了文件。");
    expect(history[0].content).toContain("[工具摘要]");
    expect(history[0].content).toContain("搜索文件: 找到 1 个文件");
  });

  it("strips leaked tool summaries before rebuilding assistant history", () => {
    const leaked =
      "完成了。\n\n[工具摘要]\n- 读取文件: 读取 200 行内容\n\n[工具摘要]\n- 搜索代码: 找到 1 处匹配";
    const history = buildAgentHistoryFromMessages([
      {
        role: "assistant",
        content: leaked,
        tools: [{ name: "patch_file", title: "局部修改", summary: "已修改 a.ts", ok: true }],
      },
    ]);
    expect(history[0].content).toBe(
      "完成了。\n\n[工具摘要]\n- 局部修改: 已修改 a.ts",
    );
  });

  it("sanitizes persisted assistant bubbles", () => {
    const cleaned = sanitizePersistedChatMessages([
      {
        id: "1",
        role: "assistant",
        content: "正文\n\n[工具摘要]\n- 读取文件: 读取 20 行内容",
      },
    ]);
    expect(cleaned[0].content).toBe("正文");
  });

  it("shapes history for execute_plan profile", () => {
    const plan = "## 修改方案\n改 `src/foo.ts`：\n```ts\nconst x = 1;\n```";
    const base = buildAgentHistoryFromMessages([
      { role: "user", content: "能改吗" },
      { role: "assistant", content: plan },
    ]);
    const history = shapeAgentHistoryForProfile(
      base,
      { kind: "execute_plan", targetFiles: ["src/foo.ts"] },
      "改吧",
    );
    expect(history).toHaveLength(2);
    expect(history[1].content).toContain("[已确认方案]");
    expect(history[1].content).toContain("const x = 1");
  });
});

describe("sanitizePersistedChatMessages", () => {
  it("strips heavy agent debug payloads before persistence", () => {
    const huge = "x".repeat(20_000);
    const sanitized = sanitizePersistedChatMessages([
      {
        id: "1",
        role: "assistant",
        content: "done",
        agentContext: {
          mode: "build",
          systemPrompt: huge,
          history: [{ role: "user", content: "hi" }],
        },
        roundGroups: [
          {
            turn: 1,
            modelSteps: [{ id: "s1", phase: "streaming_model", text: "thinking" }],
            toolIds: ["t1"],
            request: {
              contextMessages: 3,
              contextChars: 999,
              messages: [{ role: "user", content: huge }],
            },
            response: {
              assistantText: "ok",
              hasToolCalls: true,
              isFinal: false,
              toolCalls: [{ id: "t1", name: "read_file", arguments: huge }],
            },
          },
        ],
      },
    ]);
    const msg = sanitized[0];
    expect(msg.agentContext).toBeUndefined();
    expect(msg.roundGroups?.[0]?.request?.messages).toEqual([
      { role: "system", content: "1 条消息，999 字符" },
    ]);
    expect(JSON.stringify(sanitized).length).toBeLessThan(5000);
  });

  it("keeps compact user image previews for chat reload", () => {
    const dataUrl = `data:image/png;base64,${"a".repeat(1000)}`;
    const sanitized = sanitizePersistedChatMessages([
      { id: "u1", role: "user", content: "看这张图", imageDataUrls: [dataUrl] },
    ]);
    expect(sanitized[0].imageDataUrls?.[0]).toBe(dataUrl);
    expect(sanitized[0].content).toBe("看这张图");
  });

  it("retains imageRefs alongside compact in-memory image previews", () => {
    const dataUrl = `data:image/png;base64,${"a".repeat(1000)}`;
    const sanitized = sanitizePersistedChatMessages([
      {
        id: "u1",
        role: "user",
        content: "看这张图",
        imageDataUrls: [dataUrl],
        imageRefs: [{ path: "images/sess/u1-0.png" }],
      },
    ]);
    expect(sanitized[0].imageDataUrls?.[0]).toBe(dataUrl);
    expect(sanitized[0].imageRefs).toEqual([{ path: "images/sess/u1-0.png" }]);
  });

  it("forDisk payload retains imageDataUrls for server externalize", () => {
    const dataUrl = `data:image/png;base64,${"a".repeat(1000)}`;
    const sanitized = sanitizePersistedChatMessages(
      [{ id: "u1", role: "user", content: "看这张图", imageDataUrls: [dataUrl] }],
      { forDisk: true },
    );
    expect(sanitized[0].imageDataUrls?.[0]).toBe(dataUrl);
    expect(sanitized[0].imageCount).toBe(1);
  });

  it("drops turnFileDiffs after approval completes", () => {
    const sanitized = sanitizePersistedChatMessages([
      {
        id: "a1",
        role: "assistant",
        content: "done",
        writtenFiles: ["src/a.ts"],
        turnFileDiffs: {
          "src/a.ts": { before: "a", after: "b" },
        },
      },
    ]);
    expect(sanitized[0].turnFileDiffs).toBeUndefined();
  });
});

describe("v3 chat storage (index + memory)", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("persists message bodies in memory, not in localStorage message payloads", () => {
    const projectPath = "D:/projects/v3-index-test";
    const body = "SECRET_MESSAGE_BODY_xyz";
    const { sessionId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: body },
    ]);

    expect(loadVibeChatHistory(projectPath)).toEqual([
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: body },
    ]);

    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('"messages"');
    expect(raw).not.toContain(body);
    const parsed = JSON.parse(raw!) as { version: number; byProject: Record<string, { sessions: Array<{ messageCount: number }> }> };
    expect(parsed.version).toBe(STORE_VERSION);
    const indexed = Object.values(parsed.byProject)[0]?.sessions[0];
    expect(indexed?.messageCount).toBe(2);

    const snapshot = getActiveSessionSnapshot(projectPath, sessionId);
    expect(snapshot?.messages).toHaveLength(2);
  });

  it("migrates v2 full store into memory and writes a lightweight v3 index", () => {
    const projectKey = "d:/projects/v2-migrate";
    const payload = {
      version: 2,
      byProject: {
        [projectKey]: {
          activeSessionId: "sess-v2",
          sessions: [
            {
              id: "sess-v2",
              title: "旧会话",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
              messages: [
                { id: "u1", role: "user", content: "v2 迁移正文" },
                { id: "a1", role: "assistant", content: "v2 回复" },
              ],
            },
          ],
        },
      },
    };
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload));

    const loaded = loadVibeChatHistory("D:/projects/v2-migrate");
    expect(loaded).toEqual([
      { id: "u1", role: "user", content: "v2 迁移正文" },
      { id: "a1", role: "assistant", content: "v2 回复" },
    ]);

    const migratedRaw = localStorage.getItem(CHAT_STORAGE_KEY)!;
    expect(migratedRaw).not.toContain("v2 迁移正文");
    expect(JSON.parse(migratedRaw).version).toBe(STORE_VERSION);
  });

  it("restores disk snapshot into memory for reload", () => {
    const projectPath = "D:/projects/disk-restore";
    restoreChatStoreFromSnapshot({
      version: STORE_VERSION,
      projectPath,
      activeSessionId: "disk-s1",
      sessions: [
        {
          id: "disk-s1",
          title: "磁盘会话",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
          messageCount: 1,
          messages: [{ id: "u1", role: "user", content: "从磁盘恢复" }],
        },
      ],
    });

    expect(loadVibeChatHistory(projectPath)).toEqual([
      { id: "u1", role: "user", content: "从磁盘恢复" },
    ]);
    const snapshot = getVibeChatProjectSnapshot(projectPath);
    expect(snapshot.sessions[0]?.messages[0]?.content).toBe("从磁盘恢复");
  });
});
