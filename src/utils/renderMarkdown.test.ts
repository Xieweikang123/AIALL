import { describe, expect, it, vi } from "vitest";

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
    addHook: vi.fn(),
  },
}));

import { renderMarkdown, renderMarkdownLite } from "./renderMarkdown";
import { prepareStreamingMarkdownForRender } from "./streamingMarkdownTrim";
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

  it("separates a fenced code block glued to a bold heading", () => {
    const html = renderMarkdown(
      "**第三阶段：数据转发（Bridge → 远程服务器） ```**\nBridgeEngine.SendToRemote()\n→ UdpRemote 直接发送给 192.168.1.100:44373\n```",
    );
    expect(html).toContain("<strong>第三阶段：数据转发（Bridge → 远程服务器）</strong>");
    expect(html).toContain("<pre>");
    expect(html).toContain("BridgeEngine.SendToRemote()");
    expect(html).not.toContain("```**");
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

  it("renders common summary lead-in bold patterns", () => {
    expect(renderMarkdown("**简单说：** 正文从这里开始。")).toContain("<strong>简单说：</strong>");
    expect(renderMarkdown("**简单说：  ** 正文从这里开始。")).toContain("<strong>简单说：</strong>");
    expect(renderMarkdown("**简单说：  \n\n这是后面的段落。")).toContain("**");
  });

  it("renders bullet lists with bold labels", () => {
    const html = renderMarkdown([
      "### 1. Vibe Coding（主 IDE 页面）",
      "- **路由**：`/vibe-coding`",
      "- **功能**：打开本地项目后，包含：",
      "  - **文件树**：浏览、创建、重命名项目文件/文件夹",
      "  - **Monaco 编辑器**：支持代码编辑",
    ].join("\n"));
    expect(html).toContain("<ul");
    expect(html.match(/<li/g)?.length).toBeGreaterThan(3);
    expect(html).toContain("<strong>路由</strong>");
    expect(html).not.toMatch(/<p>-/);
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

  it("renders partial streaming bold after inline close helper", () => {
    const html = renderMarkdownLite(
      prepareStreamingMarkdownForRender("对应 **Git 面板**（`src/components/vibe/GitPanel.vue`"),
    );
    expect(html).toContain("<strong");
    expect(html).toContain("Git 面板");
    expect(html).toContain("<code");
    expect(html).not.toContain("**");
  });

  it("renders ATX headings when LLM omits space after hash marks", () => {
    const html = renderMarkdown("####1. Vibe Coding ( `/vibe-coding` ) — 主力 IDE 页面");
    expect(html).toContain("<h4");
    expect(html).toContain("Vibe Coding");
    expect(html).not.toMatch(/####1\./);
  });

  it("renders ATX headings with fullwidth parens and numbered module titles", () => {
    const html = renderMarkdown("####4. AI 配置（/ai-config）— 模型与 API 管理");
    expect(html).toContain("<h4");
    expect(html).toContain("AI 配置");
    expect(html).not.toMatch(/####4\./);
  });

  it("renders module section headings inside explore-style report blocks", () => {
    const html = renderMarkdown([
      "## 2. 📦 四大功能模块",
      "",
      "####1. Vibe Coding ( `/vibe-coding` ) — 主力 IDE 页面",
      "* 打开本地项目文件夹",
      "",
      "####4. AI 配置（/ai-config）— 模型与 API 管理",
      "* 配置 API Key",
    ].join("\n"));
    expect(html.match(/<h4/g)?.length).toBe(2);
    expect(html).toContain("AI 配置");
    expect(html.match(/<li/g)?.length).toBe(2);
    expect(html).not.toMatch(/####4\./);
  });

  it("normalizes indented and CRLF module headings from LLM output", () => {
    const html = renderMarkdown("    ####4. AI 配置（/ai-config）— 模型与 API 管理\r\n* item");
    expect(html).toContain("<h4");
    expect(html).not.toMatch(/####4\./);
  });

  it("breaks glued english preamble before chinese markdown blocks", () => {
    const html = renderMarkdown(
      "Now I have enough context:全部验证完毕，所有代码已在磁盘上就位，无需再改。\n\n**已完成的功能全链路：**\n\n| 层级 | 文件 | 内容 |\n|------|------|------|\n| 按钮 | `ChatPanel.vue` | ok |",
    );
    expect(html).toContain("<table");
    expect(html).toContain("<strong");
    expect(html).not.toMatch(/\*\*已完成的功能全链路/);
  });

  it("renders h4 when heading line is indented after a section title", () => {
    const html = renderMarkdown("## 模块\n    ####4. AI 配置（/ai-config）— 模型与 API 管理");
    expect(html).toContain("<h4");
    expect(html).toContain("AI 配置");
    expect(html).not.toMatch(/####4\./);
  });

  it("renders bullet lists after glued heading lines", () => {
    const html = renderMarkdown([
      "####2. 通用对话 ( `/chat` ) — AI 聊天助手",
      "* 打开本地项目文件夹",
      "* 集成文件树、Git 面板、Monaco 代码编辑器",
    ].join("\n"));
    expect(html).toContain("<ul");
    expect(html.match(/<li/g)?.length).toBe(2);
    expect(html).not.toMatch(/\* 打开/);
  });

  it("normalizes stray backslash before emoji section lines", () => {
    const html = renderMarkdown("\\ 🔧 核心特点\n\n* 多面板 IDE");
    expect(html).toContain("核心特点");
    expect(html).toContain("<ul");
    expect(html).not.toContain("\\ 🔧");
  });
});
