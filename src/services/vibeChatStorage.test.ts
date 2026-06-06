import { describe, expect, it } from "vitest";
import { buildAgentHistoryFromMessages, formatSessionTitle } from "./vibeChatStorage";

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
});
