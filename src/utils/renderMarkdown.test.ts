import { describe, expect, it, vi } from "vitest";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
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
    expect(html).toContain("const x = 1;");
  });

  it("adds apply buttons by default", () => {
    const html = renderMarkdown("```\nhello\n```");
    expect(html).toContain("code-block-apply-btn");
  });

  it("skips apply buttons when disabled", () => {
    const html = renderMarkdown("```\nhello\n```", { applyButtons: false });
    expect(html).not.toContain("code-block-apply-btn");
    expect(html).toContain("<pre");
    expect(html).toContain("hello");
  });
});
