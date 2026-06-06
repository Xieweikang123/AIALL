import { describe, expect, it } from "vitest";
import {
  buildAgentHistoryFromMessages,
  formatSessionTitle,
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
});
