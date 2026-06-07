import { describe, expect, it } from "vitest";
import { shapeAgentHistoryForProfile } from "./agentRunProfile";
import {
  buildAgentHistoryFromMessages,
  formatSessionTitle,
  sanitizePersistedChatMessages,
  stripReferenceAttachments,
} from "./vibeChatStorage";

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
    expect(msg.roundGroups?.[0]?.request?.messages).toEqual([]);
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
});
