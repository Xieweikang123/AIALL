import { describe, expect, it, vi } from "vitest";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
    addHook: vi.fn(),
  },
}));

import { renderMarkdown } from "./renderMarkdown";

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
});
