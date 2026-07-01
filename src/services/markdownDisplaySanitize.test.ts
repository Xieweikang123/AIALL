import { describe, expect, it } from "vitest";
import {
  collapseDuplicateMarkdownHeaders,
  mergeSplitOptionalTypeInlineCode,
  sanitizeMarkdownForDisplay,
  stripVisibleHtmlComments,
} from "./markdownDisplaySanitize";

describe("stripVisibleHtmlComments", () => {
  it("removes complete HTML comments anywhere", () => {
    const text = "正文\n\n<!-- 隐藏注释 -->\n\n继续。";
    expect(stripVisibleHtmlComments(text)).toBe("正文\n\n\n\n继续。");
  });

  it("removes malformed single-bang comments", () => {
    const text = "说明\n\n<! 畸形注释 -->\n\n结尾";
    expect(stripVisibleHtmlComments(text)).toBe("说明\n\n\n\n结尾");
  });

  it("removes trailing incomplete comment during streaming", () => {
    expect(stripVisibleHtmlComments("正文\n\n<!-- agent-suggestions")).toBe("正文\n\n");
    expect(stripVisibleHtmlComments("正文 <!")).toBe("正文 ");
  });
});

describe("mergeSplitOptionalTypeInlineCode", () => {
  it("merges split optional TS inline type", () => {
    const input = "类型 `size?`: `'proportional' | 'fill' | 'fit';`";
    expect(mergeSplitOptionalTypeInlineCode(input)).toBe(
      "类型 `size?: 'proportional' | 'fill' | 'fit';`",
    );
  });

  it("leaves already correct inline code unchanged", () => {
    const input = "类型 `size?: 'proportional' | 'fill' | 'fit';`";
    expect(mergeSplitOptionalTypeInlineCode(input)).toBe(input);
  });
});

describe("collapseDuplicateMarkdownHeaders", () => {
  it("removes repeated section headers while streaming", () => {
    const text = "## 截图描述\n\n## 截图描述\n\n顶部导航栏。";
    expect(collapseDuplicateMarkdownHeaders(text)).toBe("## 截图描述\n\n顶部导航栏。");
  });
});

describe("sanitizeMarkdownForDisplay", () => {
  it("strips agent-suggestions json block", () => {
    const text = [
      "分析结论如下。",
      "",
      "<!-- agent-suggestions -->",
      "```json",
      '[{"label":"修正","action":"implement","text":"改吧"}]',
      "```",
    ].join("\n");
    expect(sanitizeMarkdownForDisplay(text)).toBe("分析结论如下。");
  });

  it("strips html comments and merges split type inline code", () => {
    const text = [
      "类型 `size?`: `'proportional' | 'fill' | 'fit';`",
      "",
      "<! 设置面板说明 -->",
    ].join("\n");
    expect(sanitizeMarkdownForDisplay(text)).toBe(
      "类型 `size?: 'proportional' | 'fill' | 'fit';`",
    );
  });

  it("fast path skips pipeline for plain prose", () => {
    const text = "这是普通回答，没有工具标记或 HTML 注释。";
    expect(sanitizeMarkdownForDisplay(text)).toBe(text);
  });
});
