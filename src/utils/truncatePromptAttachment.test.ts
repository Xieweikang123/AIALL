import { describe, expect, it } from "vitest";
import { truncatePromptAttachment } from "./truncatePromptAttachment";

describe("truncatePromptAttachment", () => {
  it("returns short content unchanged", () => {
    expect(truncatePromptAttachment("hello\nworld")).toBe("hello\nworld");
  });

  it("truncates by line count", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    const result = truncatePromptAttachment(lines.join("\n"), { maxLines: 10, maxChars: 100_000 });
    expect(result.split("\n")).toHaveLength(11);
    expect(result).toContain("原文件共 250 行");
  });

  it("truncates by character count", () => {
    const result = truncatePromptAttachment("x".repeat(500), { maxLines: 10_000, maxChars: 100 });
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("共 500 字符");
  });
});
