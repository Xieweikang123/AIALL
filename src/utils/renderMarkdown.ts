import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  getCachedMarkdownHtml,
  markdownLiteRenderCache,
  markdownRenderCache,
} from "./markdownRenderCache";

/** Mermaid source lives in <code> textContent so both render paths survive DOMPurify. */
function renderMermaidPlaceholder(code: string): string {
  return `<div class="mermaid-render"><code class="language-mermaid">${escapeHtml(code)}</code></div>`;
}

const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  if (lang === "mermaid") {
    return renderMermaidPlaceholder(text);
  }
  const langAttr = lang ? ` class="language-${lang}"` : "";
  const { html } = highlightCode(text, lang || "");
  return `<pre${langAttr}><code${langAttr}>${html}</code></pre>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

const liteRenderer = new marked.Renderer();
liteRenderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  if (lang === "mermaid") {
    return renderMermaidPlaceholder(text);
  }
  const langAttr = lang ? ` class="language-${lang}"` : "";
  return `<pre${langAttr}><code${langAttr}>${escapeHtml(text)}</code></pre>`;
};

/** Skip regex tokenization on very large blocks — full render still escapes HTML. */
const HIGHLIGHT_MAX_CHARS = 8_192;

export function resetCodeBlockIndex() {
  // 已不再为代码块生成按钮,保留为空函数以保持兼容。
}

let purifyHookInstalled = false;

/**
 * LLM output often uses fullwidth asterisks or inserts spaces before closing `**`,
 * which breaks GFM bold (e.g. `**text **` stays literal).
 */
export function normalizeLooseMarkdownEmphasis(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let result = line.replace(/\uFF0A/g, "*");
      // Repair list markers already glued to bold (`-**路由**` → `- **路由**`).
      result = result.replace(/^(\s*[-*+])(\*\*)/, "$1 $2");
      result = result.replace(/^(\s*\d+\.\s+)(\*\*)/, "$1$2");
      // Trim spaces inside each **pair** (`** 重点 **` / `**简单说：**`).
      result = result.replace(/\*\*[ \t]*([^*\n]+?)[ \t]*\*\*/g, (_, inner) => `**${inner.trim()}**`);
      return result;
    })
    .join("\n");
}

const CORNER_OPEN = "\uE000";
const CORNER_CLOSE = "\uE001";

/** marked fails inline **bold** when the span contains CJK corner quotes 「」. */
function protectCornerBracketsForMarkdown(source: string): string {
  return source.replace(/「/g, CORNER_OPEN).replace(/」/g, CORNER_CLOSE);
}

/**
 * marked leaves literal ** when bold wraps inline code: **`table`说明**
 * → **<code>table</code>说明**
 */
function expandBoldWithInlineCode(source: string): string {
  return source.replace(
    /\*\*`([^`\n]+)`([^*\n]*?)\*\*/g,
    "<strong><code>$1</code>$2</strong>",
  );
}

function restoreCornerBrackets(html: string): string {
  return html.replaceAll(CORNER_OPEN, "「").replaceAll(CORNER_CLOSE, "」");
}

/** LLM output often glues ordered lists inline: "如下：1. foo 2. bar". */
export function normalizeInlineMarkdownBlocks(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      // Skip ATX headings (`#### 2. Title`) — otherwise `#` + `2.` gets split into a bogus list.
      if (/^#{1,6}\s/.test(line)) return line;
      let result = line;
      result = result.replace(/([。：；！？)])([ \t]*)(\d+\.\s+)/g, "$1\n\n$3");
      result = result.replace(
        /(\S)[ \t]+(\d+\.\s+(?=[\u4e00-\u9fffA-Za-z「『（(`]))/g,
        "$1\n\n$2",
      );
      result = result.replace(
        /([：:])([ \t]*)([-*•]\s+(?=[\u4e00-\u9fffA-Za-z「『（(]))/g,
        "$1\n\n$3",
      );
      return result;
    })
    .join("\n");
}

/** `####1. Title` → `#### 1. Title` so marked treats it as ATX heading. */
export function normalizeAtxHeadings(source: string): string {
  // LLM often indents module headings under a section; 4 spaces become a fenced code block in marked.
  let result = source.replace(/^[ \t]{1,4}(#{1,6}\S[^\n]*)$/gm, "$1");
  result = result.replace(/^(#{1,6})([^\s#\n])/gm, "$1 $2");
  return result;
}

/** Remove stray `\` before headings or emoji section lines (`\ 🔧 核心特点`). */
export function normalizeStrayLineEscapes(source: string): string {
  return source
    .replace(/^\\(\s*(?:#{1,6}\s*))/gm, "$1")
    .replace(/^\\(\s+[^\n\\])/gm, "$1");
}

/** Insert blank line before list items when glued to prior paragraph/heading line. */
export function normalizeListBlockBreaks(source: string): string {
  return source.replace(/([^\n|*+\-])\n([*+\-]\s+)/g, "$1\n\n$2");
}

/** SSE may glue English tool preamble to Chinese answer (`data:全部验证`). */
export function normalizeGluedLatinCjkBoundary(source: string): string {
  return source.replace(/([A-Za-z0-9)])([:：])(?=[\u4e00-\u9fff])/g, "$1$2\n\n");
}

/**
 * Strip trailing empty block-level elements (hr, empty h1-h6, empty p) that render as visible
 * but content-free regions. LLM output often ends with stylistic separators like `---` (→ &lt;hr&gt;)
 * or empty headings, and round-group aggregation via `\n\n---\n\n` can leave trailing artifacts.
 *
 * We operate at the HTML level so fenced code blocks are never affected.
 */
function stripTrailingEmptyBlocks(html: string): string {
  return html.replace(
    /(?:\s*<(?:hr\b[^>]*|h[1-6]\b[^>]*>\s*<\/h[1-6]>|p\b[^>]*>\s*<\/p>)\s*)+$/i,
    "",
  );
}

const NEEDS_NORMALIZE_RE = /[：:「」\d.\-*\\#\uFF0A]/;
const NEEDS_PREPARE_RE = /[\\*_\[`「」#\uFF0A]/;

function prepareMarkdownSource(text: string): string {
  let source = String(text || "").trim();
  if (!source) return "";
  // 快速退出：不含需要 normalize 的特殊字符时跳过全部 5 步变换
  if (!NEEDS_NORMALIZE_RE.test(source)) {
    if (!NEEDS_PREPARE_RE.test(source)) return source;
    const unescaped = source.replace(/\\\*/g, "*").replace(/\\_/g, "_").replace(/\\\[/g, "[");
    return protectCornerBracketsForMarkdown(
      expandBoldWithInlineCode(normalizeLooseMarkdownEmphasis(unescaped)),
    );
  }
  source = normalizeGluedLatinCjkBoundary(source);
  source = normalizeAtxHeadings(source);
  source = normalizeStrayLineEscapes(source);
  source = normalizeListBlockBreaks(source);
  source = normalizeInlineMarkdownBlocks(source);
  if (!NEEDS_PREPARE_RE.test(source)) return source;
  const unescaped = source.replace(/\\\*/g, "*").replace(/\\_/g, "_").replace(/\\\[/g, "[");
  return protectCornerBracketsForMarkdown(
    expandBoldWithInlineCode(normalizeLooseMarkdownEmphasis(unescaped)),
  );
}

function sanitizeMarkdownHtml(html: string): string {
  if (!purifyHookInstalled && typeof DOMPurify.addHook === "function") {
    DOMPurify.addHook("uponSanitizeElement", (currentNode, data) => {
      if (data.tagName !== "BUTTON") return;
      const el = currentNode as HTMLElement;
      if (el.textContent?.trim()) {
        el.replaceWith(document.createTextNode(el.textContent));
      } else {
        el.remove();
      }
    });
    purifyHookInstalled = true;
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["data-mermaid-rendered", "data-collapsed"],
    FORBID_TAGS: ["input", "form", "select", "textarea", "iframe", "script", "style", "object", "embed"],
  });
}

export function renderMarkdown(text: string): string {
  return getCachedMarkdownHtml(text, markdownRenderCache, () => {
    const prepared = prepareMarkdownSource(text);
    if (!prepared) return "";
    const raw = marked.parse(prepared, { async: false }) as string;
    const sanitized = sanitizeMarkdownHtml(raw);
    return restoreCornerBrackets(stripTrailingEmptyBlocks(sanitized));
  });
}

/** Faster markdown for streaming: skips syntax highlighting in fenced code blocks. */
export function renderMarkdownLite(text: string): string {
  return getCachedMarkdownHtml(text, markdownLiteRenderCache, () => {
    const prepared = prepareMarkdownSource(text);
    if (!prepared) return "";
    const raw = marked.parse(prepared, { async: false, renderer: liteRenderer }) as string;
    const sanitized = sanitizeMarkdownHtml(raw);
    return restoreCornerBrackets(stripTrailingEmptyBlocks(sanitized));
  });
}

// ─── highlight.js 语法高亮（成熟方案，替换了手写正则） ───

/** 将 highlight.js 的 hljs-* 类名映射为 tok-* 以兼容现有 CSS */
function mapHljsToTok(html: string): string {
  return html.replace(/\bhljs-/g, "tok-");
}

/**
 * 对代码文本进行语法高亮，返回 HTML。
 * 使用 highlight.js 替代手写正则 tokenizer。
 */
function highlightCode(code: string, lang: string): { html: string } {
  if (code.length > HIGHLIGHT_MAX_CHARS) {
    return { html: escapeHtml(code) };
  }

  const langLower = lang.toLowerCase();

  // highlight.js 能识别的语言才高亮，否则直接转义
  if (!hljs.getLanguage(langLower)) {
    return { html: escapeHtml(code) };
  }

  try {
    const result = hljs.highlight(code, {
      language: langLower,
      ignoreIllegals: true,
    });
    return { html: mapHljsToTok(result.value) };
  } catch {
    return { html: escapeHtml(code) };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
