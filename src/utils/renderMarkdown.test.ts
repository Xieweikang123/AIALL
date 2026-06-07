import { describe, expect, it, vi } from "vitest";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
    addHook: vi.fn(),
  },
}));

import { renderMarkdown, shouldShowCodeBlockApplyButton } from "./renderMarkdown";

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

  it("adds apply buttons for typescript-like blocks", () => {
    const html = renderMarkdown("```ts\nconst x = 1;\n```");
    expect(html).toContain("code-block-apply-btn");
  });

  it("skips apply buttons for vue/html reference blocks", () => {
    const vue = "```vue\n<template>\n  <button @click=\"doFetch\">Fetch</button>\n  {{ gitBranch }}\n</template>\n```";
    const html = renderMarkdown(vue);
    expect(html).not.toContain("code-block-apply-btn");
    expect(html).toContain("&lt;template");
  });

  it("renders gfm tables and bold inside headings", () => {
    const html = renderMarkdown("## 标题 **加粗**\n\n| 功能 | 支持 |\n|------|:---:|\n| 文本 | ✅ |");
    expect(html).toContain("<h2");
    expect(html).toContain("<strong");
    expect(html).toContain("<table");
    expect(html).toContain("<td");
  });
});

describe("shouldShowCodeBlockApplyButton", () => {
  it("detects vue markup without language tag", () => {
    expect(shouldShowCodeBlockApplyButton("<button>Fetch</button>\n{{ gitBranch }}")).toBe(false);
  });

  it("allows plain typescript blocks", () => {
    expect(shouldShowCodeBlockApplyButton("export const x = 1;", "ts")).toBe(true);
  });
});
