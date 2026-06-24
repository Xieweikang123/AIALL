import { describe, expect, it, vi } from "vitest";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
    addHook: vi.fn(),
  },
}));

import { renderMarkdown, renderMarkdownLite } from "./renderMarkdown";
import { sanitizeMarkdownForDisplay } from "../services/markdownDisplaySanitize";

const MERMAID_SAMPLE = "```mermaid\ngraph TD\n    A[开始] --> B[结束]\n```";

function expectMermaidPlaceholder(html: string) {
  expect(html).toContain('class="mermaid-render"');
  expect(html).toContain('class="language-mermaid"');
  expect(html).not.toContain("data-mermaid-code");
  expect(html.replace(/<[^>]+>/g, "")).toContain("graph TD");
  expect(html.replace(/<[^>]+>/g, "")).toContain("A[开始]");
}

describe("renderMarkdown", () => {
  it("renders headings and inline code", () => {
    const html = renderMarkdown("### Step one\nUse `foo.ts` here.");
    expect(html).toContain("<h3");
    expect(html).toContain("Step one");
    expect(html).toContain("<code");
    expect(html).toContain("foo.ts");
  });

  it("renders lists and fenced code blocks", () => {
    const html = renderMarkdown("- first\n- second\n\n```ts\nconst x = 1;\n```");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html.replace(/<[^>]+>/g, "")).toContain("const x = 1;");
  });

  it("does not add apply buttons to code blocks", () => {
    const html = renderMarkdown("```ts\nconst x = 1;\n```");
    expect(html).not.toContain("code-block-apply-btn");
    expect(html).not.toContain("写入代码块");
  });

  it("renders gfm tables and bold inside headings", () => {
    const html = renderMarkdown("## 标题 **加粗**\n\n| 功能 | 支持 |\n|------|:---:|\n| 文本 | ✅ |");
    expect(html).toContain("<h2");
    expect(html).toContain("<strong");
    expect(html).toContain("<table");
    expect(html).toContain("<td");
  });

  it("renders mermaid blocks as sanitized code placeholders", () => {
    expectMermaidPlaceholder(renderMarkdown(MERMAID_SAMPLE));
  });

  it("renders mermaid placeholders identically in lite mode", () => {
    expectMermaidPlaceholder(renderMarkdownLite(MERMAID_SAMPLE));
  });

  it("renders bold when LLM leaves a space before closing **", () => {
    const html = renderMarkdown(
      "触发时机：每次执行时，自动以**服务器本地时间的「昨天」 **为目标日期进行补全。",
    );
    expect(html).toContain("<strong");
    expect(html).toContain("服务器本地时间的「昨天」");
    expect(html).not.toContain("**");
  });

  it("renders inline bold with CJK corner quotes", () => {
    const html = renderMarkdown("以**「昨天」**为目标");
    expect(html).toContain("<strong>「昨天」</strong>");
  });

  it("renders bold when LLM leaves a space after opening **", () => {
    const html = renderMarkdown("说明 ** 重点内容 ** 继续。");
    expect(html).toContain("<strong>重点内容</strong>");
  });

  it("renders bold wrapping inline code", () => {
    const html = renderMarkdown(
      "核心功能是对**`gw_energyrecorditem`表进行昨日能耗记录的补全**。",
    );
    expect(html).toContain("<strong>");
    expect(html).toContain("<code>gw_energyrecorditem</code>");
    expect(html).toContain("表进行昨日能耗记录的补全");
    expect(html).not.toContain("**");
  });

  it("renders merged optional TS inline type as single code span", () => {
    const html = renderMarkdown(
      sanitizeMarkdownForDisplay("类型 `size?`: `'proportional' | 'fill' | 'fit';`"),
    );
    expect(html).toContain("<code");
    expect(html.match(/<code/g)?.length).toBe(1);
    expect(html).toContain("size?:");
    expect(html).toContain("proportional");
  });

  it("breaks inline numbered lists into separate list items", () => {
    const html = renderMarkdown(
      "发现 4 个 bug：1. `VibeChatMessageItem` 缺字段 2. AgentToolStep 未导出 3. turnTraces 缺少 hasToolCalls 4. `CodeMonacoEditor.vue` 缺少导入",
    );
    expect(html).toContain("<ol");
    expect(html.match(/<li/g)?.length).toBe(4);
    expect(html).toContain("VibeChatMessageItem");
    expect(html).toContain("CodeMonacoEditor.vue");
  });

  it("breaks inline numbered lists in lite streaming mode", () => {
    const html = renderMarkdownLite("修复如下：1. 第一项 2. 第二项");
    expect(html).toContain("<ol");
    expect(html.match(/<li/g)?.length).toBe(2);
  });
});
