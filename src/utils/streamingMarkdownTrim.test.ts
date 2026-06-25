import { describe, expect, it } from "vitest";
import { closeStreamingInlineMarkdown, trimIncompleteStreamingMarkdown } from "./streamingMarkdownTrim";

describe("trimIncompleteStreamingMarkdown", () => {
  it("hides table until header and separator exist", () => {
    const input = "总结如下：\n\n| 区域 | 改动 |";
    expect(trimIncompleteStreamingMarkdown(input)).toBe("总结如下：");
  });

  it("hides glued table rows from streaming chunks", () => {
    const input = "总结如下：\n\n| 区域 | 改动 |\n|------|------||Template| 移除齿轮";
    expect(trimIncompleteStreamingMarkdown(input)).toBe("总结如下：");
  });

  it("shows complete table prefix with header and separator", () => {
    const input = "总结如下：\n\n| 区域 | 改动 |\n|------|------|";
    expect(trimIncompleteStreamingMarkdown(input)).toBe(input);
  });

  it("shows table with complete rows", () => {
    const input = [
      "总结如下：",
      "",
      "| 区域 | 改动 |",
      "|------|------|",
      "| Template | 移除齿轮 |",
      "| Script | 新增菜单 |",
    ].join("\n");
    expect(trimIncompleteStreamingMarkdown(input)).toBe(input);
  });

  it("drops incomplete last table row", () => {
    const input = [
      "| 区域 | 改动 |",
      "|------|------|",
      "| Template | ok |",
      "| Script | 未写完",
    ].join("\n");
    expect(trimIncompleteStreamingMarkdown(input)).toBe(
      "| 区域 | 改动 |\n|------|------|\n| Template | ok |",
    );
  });

  it("synthesizes closing fence for partial code block", () => {
    const input = "说明\n\n```typescript\nconst x = 1";
    expect(trimIncompleteStreamingMarkdown(input)).toBe("说明\n\n```typescript\nconst x = 1\n```");
  });

  it("closes unclosed bold markers during streaming", () => {
    expect(closeStreamingInlineMarkdown("这是 **Git 面板")).toBe("这是 **Git 面板**");
    expect(closeStreamingInlineMarkdown("路径 `src/foo.ts")).toBe("路径 `src/foo.ts`");
  });

  it("does not over-close when a second bold span is opening", () => {
    expect(closeStreamingInlineMarkdown("**Git 面板** 和 **组件")).toBe("**Git 面板** 和 **组件");
  });

  it("keeps closed fenced code block", () => {
    const input = "说明\n\n```typescript\nconst x = 1;\n```";
    expect(trimIncompleteStreamingMarkdown(input)).toBe(input);
  });

  it("skips work when no table or fence markers", () => {
    const input = "纯文本回答，没有表格或代码块。";
    expect(trimIncompleteStreamingMarkdown(input)).toBe(input);
  });
});
