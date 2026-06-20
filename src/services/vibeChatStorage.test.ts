import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { externalizeMessageImages } from "../../server/vibeChatImages";
import { stampImageRefsAfterSync } from "./vibeChatImageStore";
import { shapeAgentHistoryForProfile } from "./agentRunProfile";
import {
  buildAgentHistoryFromMessages,
  formatSessionTitle,
  buildActiveSessionDiskSyncPayload,
  chatMessagesHavePendingImageBase64,
  cloneChatMessagesForDiskSync,
  getActiveSessionSnapshot,
  compactProjectSessionRecord,
  beginVibeChatDraftSession,
  abandonVibeChatDraftIfEmpty,
  resolveActiveVibeChatSessionId,
  createVibeChatSession,
  deleteVibeChatSession,
  diskChatStoreAheadOfLocalIndex,
  markSessionLocallyDeleted,
  sessionIdsWithDiskAheadMessageCounts,
  getActiveVibeChatSessionId,
  getVibeChatProjectSnapshot,
  getSessionDiagSnapshot,
  listVibeChatSessions,
  loadVibeChatHistory,
  mirrorLocalIndexFromDiskMeta,
  projectChatNeedsDiskRestore,
  replaceChatStoreFromDiskSnapshot,
  restoreChatStoreFromSnapshot,
  syncLocalIndexFromRecord,
  sanitizePersistedChatMessages,
  saveVibeChatHistory,
  shouldPersistAssistantMessage,
  type PersistedChatMessage,
  STORE_VERSION,
  stripReferenceAttachments,
  stripToolSummaryFromAssistantContent,
  vibeChatSessionDiskFilePath,
  vibeChatSessionLocalFileName,
  vibeChatSessionStoreDiskPath,
  VIBE_CHAT_SESSIONS_LOGICAL_DIR,
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
    expect(history[0].content).toContain("<!-- agent-tool-log -->");
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
      "完成了。\n\n<!-- agent-tool-log -->\n- 局部修改: 已修改 a.ts",
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

  it("strips leaked tool action bullet lines without [工具摘要] header", () => {
    const leaked = [
      "- 读取文件：读取 62 行内容",
      "- 读取文件：读取 51 行内容",
      "- 局部修改：已修改 src/components/ChatMarkdown.vue",
    ].join("\n");
    expect(stripToolSummaryFromAssistantContent(leaked)).toBe("");
  });

  it("keeps prose while stripping trailing tool action lines", () => {
    const mixed = [
      "已修复 Markdown 渲染问题。",
      "- 读取文件：读取 20 行内容",
      "- 局部修改：已修改 src/foo.ts",
    ].join("\n");
    expect(stripToolSummaryFromAssistantContent(mixed)).toBe("已修复 Markdown 渲染问题。");
  });

  it("strips partial streaming tool summary tail", () => {
    const streaming = [
      "你只需要等它跑完即可。",
      "",
      "[工具摘要]",
      "- 读取文件: 读取 73 行内容",
      "- 读取文件: 读取 59 行内容",
      "- 搜索代码: 找到 5 处",
    ].join("\n");
    expect(stripToolSummaryFromAssistantContent(streaming)).toBe("你只需要等它跑完即可。");
  });

  it("strips agent-tool-log marker blocks for model history leaks", () => {
    const leaked = [
      "正文。",
      "",
      "<!-- agent-tool-log -->",
      "- 读取文件: 读取 20 行内容",
    ].join("\n");
    expect(stripToolSummaryFromAssistantContent(leaked)).toBe("正文。");
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
  it("keeps in-flight assistant placeholders with roundGroups or agentPhase", () => {
    const connecting: PersistedChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      chatMode: "build",
      agentPhase: "connecting_local",
      status: "正在连接本地服务（127.0.0.1:37891）…",
      roundGroups: [
        {
          turn: 0,
          modelSteps: [{ id: "s0", phase: "connecting_local", text: "正在连接本地服务（127.0.0.1:37891）…" }],
          toolIds: [],
        },
      ],
    };
    expect(shouldPersistAssistantMessage(connecting)).toBe(true);
    const sanitized = sanitizePersistedChatMessages([
      { id: "u1", role: "user", content: "hello" },
      connecting,
    ]);
    expect(sanitized).toHaveLength(2);
    expect(sanitized[1].agentPhase).toBe("connecting_local");
    expect(sanitized[1].status).toContain("正在连接本地服务");
    expect(sanitized[1].roundGroups?.length).toBe(1);
  });

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

  it("large agent-compressed screenshots keep imageDataUrls up to disk cap", () => {
    const largeDataUrl = `data:image/jpeg;base64,${"A".repeat(150_000)}`;
    const sanitized = sanitizePersistedChatMessages([
      { id: "u1", role: "user", content: "红色线框 是啥？", imageDataUrls: [largeDataUrl] },
    ]);
    expect(sanitized[0].imageDataUrls?.[0]).toBe(largeDataUrl);
    expect(sanitized[0].imageCount).toBe(1);
  });

  describe("image sync pipeline (persistChatNow → sync)", () => {
    let tmpDir = "";

    afterEach(async () => {
      if (tmpDir) {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
        tmpDir = "";
      }
    });

    it("forDisk from live Vue messages retains base64 for externalize", () => {
      const largeDataUrl = `data:image/jpeg;base64,${"B".repeat(150_000)}`;
      const vueMessages = [
        { id: "u1", role: "user" as const, content: "附图", imageDataUrls: [largeDataUrl] },
      ];
      const diskPayload = sanitizePersistedChatMessages(vueMessages, { forDisk: true });
      expect(diskPayload[0].imageDataUrls?.[0]).toBe(largeDataUrl);
    });

    it("getActiveSessionSnapshot alone still lacks base64 when memory record has orphan refs", () => {
      installLocalStorageMock();
      const projectPath = "D:/projects/image-sync-gap";
      const largeDataUrl = `data:image/jpeg;base64,${"C".repeat(150_000)}`;
      const { sessionId } = saveVibeChatHistory(projectPath, [
        {
          id: "u1",
          role: "user",
          content: "附图",
          imageRefs: [{ path: "images/s/u1-0.jpg" }],
          imageCount: 1,
        },
      ]);
      const snapshot = getActiveSessionSnapshot(projectPath, sessionId);
      expect(snapshot?.messages[0].imageDataUrls).toBeUndefined();
      expect(snapshot?.messages[0].imageRefs).toHaveLength(1);
    });

    it("live forDisk payload externalizes images before stamp writes orphan refs", async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-chat-loss-"));
      const sessionId = "1781746585762-afb69c5f9de258";
      const messageId = "1781746585759-cd6d837676bb18";
      const largeDataUrl = `data:image/jpeg;base64,${"B".repeat(150_000)}`;
      const vueMessages = [
        { id: messageId, role: "user" as const, content: "红色线框 是啥？", imageDataUrls: [largeDataUrl] },
      ];

      const captured = cloneChatMessagesForDiskSync(vueMessages);
      expect(chatMessagesHavePendingImageBase64(captured)).toBe(true);
      expect(captured[0].imageDataUrls?.[0]).toBe(largeDataUrl);

      const diskPayload = sanitizePersistedChatMessages(captured, { forDisk: true });
      const externalized = await externalizeMessageImages(tmpDir, sessionId, diskPayload);
      expect(externalized[0].imageRefs).toHaveLength(1);
      expect(externalized[0].imageCount).toBe(1);
      expect(externalized[0].imageDataUrls).toBeUndefined();

      const stamped = stampImageRefsAfterSync(sessionId, captured);
      expect(stamped[0].imageRefs?.[0].path).toBe(externalized[0].imageRefs![0].path);
    });

    it("captured disk sync keeps base64 after simulated session switch clears Vue", () => {
      const largeDataUrl = `data:image/jpeg;base64,${"D".repeat(150_000)}`;
      const captured = cloneChatMessagesForDiskSync([
        { id: "u1", role: "user", content: "附图", imageDataUrls: [largeDataUrl] },
      ]);
      const emptyVue: PersistedChatMessage[] = [];
      expect(sanitizePersistedChatMessages(emptyVue, { forDisk: true })).toEqual([]);
      const diskPayload = sanitizePersistedChatMessages(captured, { forDisk: true });
      expect(diskPayload[0].imageDataUrls?.[0]).toBe(largeDataUrl);
    });
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
    }, projectPath);

    expect(loadVibeChatHistory(projectPath)).toEqual([
      { id: "u1", role: "user", content: "从磁盘恢复" },
    ]);
    const snapshot = getVibeChatProjectSnapshot(projectPath);
    expect(snapshot.sessions[0]?.messages[0]?.content).toBe("从磁盘恢复");
  });

  it("deduplicates visually identical sessions in the session list", () => {
    const projectPath = "D:/projects/session-dedupe";
    restoreChatStoreFromSnapshot({
      version: STORE_VERSION,
      projectPath,
      activeSessionId: "newer",
      sessions: [
        {
          id: "older",
          title: "重复会话",
          createdAt: "2026-03-01T00:00:05.000Z",
          updatedAt: "2026-03-01T00:01:00.000Z",
          messageCount: 2,
          messages: [
            { id: "u1", role: "user", content: "同一个问题" },
            { id: "a1", role: "assistant", content: "同一个回答" },
          ],
        },
        {
          id: "newer",
          title: "重复会话",
          createdAt: "2026-03-01T00:00:40.000Z",
          updatedAt: "2026-03-01T00:02:00.000Z",
          messageCount: 2,
          messages: [
            { id: "u1", role: "user", content: "同一个问题" },
            { id: "a1", role: "assistant", content: "同一个回答" },
          ],
        },
      ],
    }, projectPath);

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual(["newer"]);
  });

  it("uses explicit sessionId when saving instead of generating a duplicate id", () => {
    const projectPath = "D:/projects/adopt-session-id";
    const explicitId = "1781749904219-d0d46d6524c";
    const { sessionId } = saveVibeChatHistory(
      projectPath,
      [
        { id: "u1", role: "user", content: "同一个问题" },
        { id: "a1", role: "assistant", content: "同一个回答" },
      ],
      explicitId,
    );
    expect(sessionId).toBe(explicitId);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual([explicitId]);
  });

  it("does not adopt a recently deleted session id when saving", () => {
    const projectPath = "D:/projects/adopt-deleted";
    const explicitId = "1781749904219-deleted-session";
    saveVibeChatHistory(
      projectPath,
      [
        { id: "u1", role: "user", content: "同一个问题" },
        { id: "a1", role: "assistant", content: "同一个回答" },
      ],
      explicitId,
    );
    deleteVibeChatSession(projectPath, explicitId);
    markSessionLocallyDeleted(projectPath, explicitId);

    saveVibeChatHistory(
      projectPath,
      [
        { id: "u1", role: "user", content: "同一个问题" },
        { id: "a1", role: "assistant", content: "同一个回答" },
      ],
      explicitId,
    );

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).not.toContain(explicitId);
  });

  it("merges disk duplicate signatures into one session during merge", () => {
    const projectPath = "D:/projects/merge-dedupe-disk";
    restoreChatStoreFromSnapshot(
      {
        version: STORE_VERSION,
        projectPath,
        activeSessionId: "disk-newer",
        sessions: [
          {
            id: "disk-older",
            title: "重复会话",
            createdAt: "2026-03-01T00:00:05.000Z",
            updatedAt: "2026-03-01T00:01:00.000Z",
            messageCount: 2,
            messages: [
              { id: "u1", role: "user", content: "同一个问题" },
              { id: "a1", role: "assistant", content: "同一个回答" },
            ],
          },
          {
            id: "disk-newer",
            title: "重复会话",
            createdAt: "2026-03-01T00:00:40.000Z",
            updatedAt: "2026-03-02T00:00:00.000Z",
            messageCount: 2,
            messages: [
              { id: "u1", role: "user", content: "同一个问题" },
              { id: "a1", role: "assistant", content: "同一个回答" },
            ],
          },
        ],
      },
      projectPath,
    );

    const ids = listVibeChatSessions(projectPath).map((s) => s.id);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("disk-newer");
  });

  it("keeps same-title sessions when their content differs", () => {
    const projectPath = "D:/projects/session-dedupe-distinct";
    restoreChatStoreFromSnapshot({
      version: STORE_VERSION,
      projectPath,
      activeSessionId: "s2",
      sessions: [
        {
          id: "s1",
          title: "同名会话",
          createdAt: "2026-03-01T00:00:05.000Z",
          updatedAt: "2026-03-01T00:01:00.000Z",
          messageCount: 1,
          messages: [{ id: "u1", role: "user", content: "第一个问题" }],
        },
        {
          id: "s2",
          title: "同名会话",
          createdAt: "2026-03-01T00:00:40.000Z",
          updatedAt: "2026-03-01T00:02:00.000Z",
          messageCount: 1,
          messages: [{ id: "u2", role: "user", content: "第二个问题" }],
        },
      ],
    }, projectPath);

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("rejects disk snapshot when project path mismatches", () => {
    const projectPath = "D:/projects/target";
    const ok = restoreChatStoreFromSnapshot(
      {
        version: STORE_VERSION,
        projectPath: "D:/projects/other",
        activeSessionId: "disk-s1",
        sessions: [
          {
            id: "disk-s1",
            title: "其他项目会话",
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-02T00:00:00.000Z",
            messageCount: 1,
            messages: [{ id: "u1", role: "user", content: "不应写入" }],
          },
        ],
      },
      projectPath,
    );

    expect(ok).toBe(false);
    expect(loadVibeChatHistory(projectPath)).toEqual([]);
  });

  it("compacts duplicate sessions in memory on demand", () => {
    const projectPath = "D:/projects/compact-on-load";
    restoreChatStoreFromSnapshot(
      {
        version: STORE_VERSION,
        projectPath,
        activeSessionId: "newer",
        sessions: [
          {
            id: "older",
            title: "重复会话",
            createdAt: "2026-03-01T00:00:05.000Z",
            updatedAt: "2026-03-01T00:01:00.000Z",
            messageCount: 2,
            messages: [
              { id: "u1", role: "user", content: "同一个问题" },
              { id: "a1", role: "assistant", content: "同一个回答" },
            ],
          },
          {
            id: "newer",
            title: "重复会话",
            createdAt: "2026-03-01T00:00:40.000Z",
            updatedAt: "2026-03-02T00:00:00.000Z",
            messageCount: 2,
            messages: [
              { id: "u1", role: "user", content: "同一个问题" },
              { id: "a1", role: "assistant", content: "同一个回答" },
            ],
          },
        ],
      },
      projectPath,
    );
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual(["newer"]);
    expect(compactProjectSessionRecord(projectPath)).toBe(false);
  });

  it("does not drop other sessions when saving one with index-only peers", () => {
    const projectPath = "D:/projects/no-false-dedupe-on-save";
    replaceChatStoreFromDiskSnapshot(
      {
        version: STORE_VERSION,
        projectPath,
        activeSessionId: "session-a",
        sessions: [
          {
            id: "session-a",
            title: "同标题",
            createdAt: "2026-03-01T00:00:05.000Z",
            updatedAt: "2026-03-01T00:01:00.000Z",
            messageCount: 2,
            messages: [],
          },
          {
            id: "session-b",
            title: "同标题",
            createdAt: "2026-03-01T00:00:40.000Z",
            updatedAt: "2026-03-01T00:02:00.000Z",
            messageCount: 2,
            messages: [],
          },
        ],
      },
      projectPath,
    );

    saveVibeChatHistory(
      projectPath,
      [
        { id: "u1", role: "user", content: "第一个问题" },
        { id: "a1", role: "assistant", content: "第一个回答" },
      ],
      "session-a",
    );

    const ids = listVibeChatSessions(projectPath).map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("session-a");
    expect(ids).toContain("session-b");
  });

  it("does not treat empty indexed sessions as disk restore candidates", () => {
    const projectPath = "D:/projects/empty-session-index";
    createVibeChatSession(projectPath);
    expect(projectChatNeedsDiskRestore(projectPath)).toBe(false);
  });

  it("beginVibeChatDraftSession creates a draft not shown in list until messages exist", () => {
    const projectPath = "D:/projects/draft-flow";
    const { sessionId: existingId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "existing" },
      { id: "a1", role: "assistant", content: "ok" },
    ]);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual([existingId]);

    const { id: draftId } = beginVibeChatDraftSession(projectPath);
    expect(draftId).not.toBe(existingId);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual([existingId]);
    expect(getActiveVibeChatSessionId(projectPath)).toBe(draftId);

    saveVibeChatHistory(
      projectPath,
      [{ id: "u2", role: "user", content: "new thread" }],
      draftId,
    );
    const ids = listVibeChatSessions(projectPath).map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(draftId);
  });

  it("abandonVibeChatDraftIfEmpty removes empty draft without touching active sessions", () => {
    const projectPath = "D:/projects/abandon-draft";
    const { id: draftId } = beginVibeChatDraftSession(projectPath);
    abandonVibeChatDraftIfEmpty(projectPath, draftId);
    expect(getActiveVibeChatSessionId(projectPath)).toBe("");
    expect(listVibeChatSessions(projectPath)).toHaveLength(0);

    const { sessionId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "keep" },
      { id: "a1", role: "assistant", content: "ok" },
    ]);
    abandonVibeChatDraftIfEmpty(projectPath, sessionId);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual([sessionId]);
  });

  it("resolveActiveVibeChatSessionId creates draft for empty project", () => {
    const projectPath = "D:/projects/resolve-empty";
    const id = resolveActiveVibeChatSessionId(projectPath);
    expect(id).toBeTruthy();
    expect(getActiveVibeChatSessionId(projectPath)).toBe(id);
  });

  it("does not treat disk-only orphan sessions as ahead of local index", () => {
    const projectPath = "D:/projects/disk-ahead";
    saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "local only" },
      { id: "a1", role: "assistant", content: "ok" },
    ]);

    expect(
      diskChatStoreAheadOfLocalIndex(projectPath, [
        {
          id: "disk-only",
          messageCount: 4,
          updatedAt: "2026-03-02T00:00:00.000Z",
        },
      ]),
    ).toBe(false);
  });

  it("detects when an indexed session has more messages on disk", () => {
    const projectPath = "D:/projects/disk-ahead-count";
    const { sessionId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "local only" },
      { id: "a1", role: "assistant", content: "ok" },
    ]);

    expect(
      diskChatStoreAheadOfLocalIndex(projectPath, [
        {
          id: sessionId,
          messageCount: 4,
          updatedAt: "2026-03-02T00:00:00.000Z",
        },
      ]),
    ).toBe(true);
    expect(
      sessionIdsWithDiskAheadMessageCounts(projectPath, [
        { id: sessionId, messageCount: 4 },
        { id: "disk-only", messageCount: 4 },
      ]),
    ).toEqual([sessionId]);
  });

  it("merges disk sessions without dropping unsynced local-only sessions", () => {
    const projectPath = "D:/projects/merge-local-disk";
    const { sessionId: localOnlyId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "仅本地" },
      { id: "a1", role: "assistant", content: "本地回复" },
    ]);

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
          messages: [{ id: "u2", role: "user", content: "磁盘消息" }],
        },
      ],
    }, projectPath);

    const snapshot = getVibeChatProjectSnapshot(projectPath);
    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.sessions.some((s) => s.id === localOnlyId)).toBe(true);
    expect(snapshot.sessions.some((s) => s.id === "disk-s1")).toBe(true);
  });

  it("replaces local store from disk on cold start instead of merging", () => {
    const projectPath = "D:/projects/replace-from-disk";
    saveVibeChatHistory(projectPath, [
      { id: "u-local", role: "user", content: "仅本地" },
      { id: "a-local", role: "assistant", content: "本地" },
    ]);

    const ok = replaceChatStoreFromDiskSnapshot(
      {
        version: STORE_VERSION,
        projectPath,
        activeSessionId: "disk-s1",
        sessions: [
          {
            id: "disk-s1",
            title: "磁盘",
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-02T00:00:00.000Z",
            messageCount: 1,
            messages: [{ id: "u1", role: "user", content: "磁盘消息" }],
          },
        ],
      },
      projectPath,
    );
    expect(ok).toBe(true);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toEqual(["disk-s1"]);
    expect(loadVibeChatHistory(projectPath)[0]?.content).toBe("磁盘消息");
  });

  it("syncLocalIndexFromRecord writes index from memory record", () => {
    const projectPath = "D:/projects/sync-local-index";
    const { sessionId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "hi" },
    ]);
    syncLocalIndexFromRecord(projectPath);
    expect(getSessionDiagSnapshot(projectPath).indexSessionIds).toContain(sessionId);
  });

  it("mirrors disk index metadata into localStorage", () => {
    const projectPath = "D:/projects/mirror-index";
    mirrorLocalIndexFromDiskMeta(projectPath, {
      activeSessionId: "s1",
      sessions: [
        {
          id: "s1",
          title: "镜像",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
          messageCount: 3,
        },
      ],
    });
    expect(getSessionDiagSnapshot(projectPath).indexSessionIds).toEqual(["s1"]);
    expect(getSessionDiagSnapshot(projectPath).activeSessionId).toBe("s1");
  });

  it("mirrorLocalIndexFromDiskMeta keeps local-only sessions not yet in disk payload", () => {
    const projectPath = "D:/projects/mirror-keep-local";
    const { sessionId: localOnlyId } = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "仅本地" },
      { id: "a1", role: "assistant", content: "ok" },
    ]);

    mirrorLocalIndexFromDiskMeta(projectPath, {
      activeSessionId: "disk-s1",
      sessions: [
        {
          id: "disk-s1",
          title: "磁盘",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
          messageCount: 1,
        },
      ],
    });

    const ids = getSessionDiagSnapshot(projectPath).indexSessionIds;
    expect(ids).toContain("disk-s1");
    expect(ids).toContain(localOnlyId);
    expect(getSessionDiagSnapshot(projectPath).activeSessionId).toBe(localOnlyId);
  });

  it("does not resurrect locally deleted sessions when merging disk snapshot", () => {
    const projectPath = "D:/projects/deleted-no-resurrect";
    const keepId = saveVibeChatHistory(projectPath, [
      { id: "u1", role: "user", content: "keep me" },
      { id: "a1", role: "assistant", content: "ok" },
    ]).sessionId;
    const deleteId = saveVibeChatHistory(projectPath, [
      { id: "u2", role: "user", content: "delete me" },
      { id: "a2", role: "assistant", content: "bye" },
    ]).sessionId;

    deleteVibeChatSession(projectPath, deleteId);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toContain(keepId);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).not.toContain(deleteId);

    restoreChatStoreFromSnapshot({
      version: STORE_VERSION,
      projectPath,
      activeSessionId: keepId,
      sessions: [
        {
          id: keepId,
          title: "keep",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:01:00.000Z",
          messageCount: 2,
          messages: [
            { id: "u1", role: "user", content: "keep me" },
            { id: "a1", role: "assistant", content: "ok" },
          ],
        },
        {
          id: deleteId,
          title: "delete",
          createdAt: "2026-03-01T00:00:10.000Z",
          updatedAt: "2026-03-01T00:02:00.000Z",
          messageCount: 2,
          messages: [
            { id: "u2", role: "user", content: "delete me" },
            { id: "a2", role: "assistant", content: "bye" },
          ],
        },
      ],
    }, projectPath);

    expect(listVibeChatSessions(projectPath).map((s) => s.id)).not.toContain(deleteId);
    expect(listVibeChatSessions(projectPath).map((s) => s.id)).toContain(keepId);
    expect(
      diskChatStoreAheadOfLocalIndex(projectPath, [
        {
          id: deleteId,
          messageCount: 2,
          updatedAt: "2026-03-01T00:02:00.000Z",
        },
      ]),
    ).toBe(false);
  });
});

describe("vibe chat session disk paths", () => {
  it("maps session id to AppData file path", () => {
    expect(VIBE_CHAT_SESSIONS_LOGICAL_DIR).toBe("aiall/vibe-chat-sessions");
    expect(vibeChatSessionLocalFileName("1781689365698-5b7c3cda4e73e")).toBe(
      "chat-1781689365698-5b7c3cda4e73e.json",
    );
    expect(vibeChatSessionDiskFilePath("1781689365698-5b7c3cda4e73e")).toBe(
      "%APPDATA%\\aiall\\vibe-chat-sessions\\chat-1781689365698-5b7c3cda4e73e.json",
    );
    expect(vibeChatSessionStoreDiskPath()).toBe("%APPDATA%\\aiall\\vibe-chat-sessions\\chat-store.json");
  });
});
