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

const NEEDS_PREPARE_RE = /[\\*_\[`「」#\uFF0A]/;

function prepareMarkdownSource(text: string): string {
  let source = String(text || "").trim();
  if (!source) return "";
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
    return restoreCornerBrackets(sanitizeMarkdownHtml(raw));
  });
}

/** Faster markdown for streaming: skips syntax highlighting in fenced code blocks. */
export function renderMarkdownLite(text: string): string {
  return getCachedMarkdownHtml(text, markdownLiteRenderCache, () => {
    const prepared = prepareMarkdownSource(text);
    if (!prepared) return "";
    const raw = marked.parse(prepared, { async: false, renderer: liteRenderer }) as string;
    return restoreCornerBrackets(sanitizeMarkdownHtml(raw));
  });
}

// ─── 轻量语法高亮（零依赖） ───────────────────────────

interface Token {
  start: number;
  end: number;
  token: string; // CSS class name: tok-keyword, tok-string, etc.
}

interface TokenRule {
  pattern: RegExp;
  token: string;
}

// 通用规则（适用于大多数语言）
const commonRules: TokenRule[] = [
  { pattern: /\/\/.*$/gm, token: "comment" },
  { pattern: /#.*$/gm, token: "comment" },
  { pattern: /\/\*[\s\S]*?\*\//g, token: "comment" },
  { pattern: /"(?:[^"\\]|\\.)*"/g, token: "string" },
  { pattern: /'(?:[^'\\]|\\.)*'/g, token: "string" },
  { pattern: /`(?:[^`\\]|\\.)*`/g, token: "string" },
  { pattern: /\b\d+(?:\.\d+)?(?:_\d+)*\b/g, token: "number" },
  { pattern: /\b(?:true|false|null|undefined|None|True|False)\b/g, token: "boolean" },
];

// 语言特定规则
const langRules: Record<string, TokenRule[]> = {
  typescript: [
    { pattern: /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|from|export|default|async|await|try|catch|finally|throw|yield|static|public|private|protected|readonly|abstract|interface|type|enum|implements|declare|namespace|module|as|is|keyof|infer|satisfies|override|using)\b/g, token: "keyword" },
    { pattern: /\b(?:string|number|boolean|any|unknown|never|void|object|symbol|bigint|Promise|Record|Partial|Required|Pick|Omit|Array|Map|Set|RegExp|Date|Error)\b/g, token: "type" },
    { pattern: /(?<=\.)\w+(?=\s*\()/g, token: "function" },
    { pattern: /\b[A-Z]\w*\b/g, token: "type" },
    { pattern: /@\w+/g, token: "decorator" },
  ],
  javascript: [
    { pattern: /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|from|export|default|async|await|try|catch|finally|throw|yield|static)\b/g, token: "keyword" },
    { pattern: /\b(?:Promise|Array|Map|Set|RegExp|Date|Error|Math|JSON|console|window|document)\b/g, token: "type" },
    { pattern: /(?<=\.)\w+(?=\s*\()/g, token: "function" },
    { pattern: /\b[A-Z]\w*\b/g, token: "type" },
  ],
  python: [
    { pattern: /\b(?:def|class|return|if|elif|else|for|while|break|continue|pass|import|from|as|with|try|except|finally|raise|yield|lambda|global|nonlocal|del|assert|and|or|not|is|in|async|await)\b/g, token: "keyword" },
    { pattern: /\b(?:True|False|None|int|str|float|bool|list|dict|tuple|set|bytes|type|object|range|enumerate|zip|map|filter|len|print|super|property|staticmethod|classmethod|self|cls)\b/g, token: "type" },
    { pattern: /(?<=\.)\w+(?=\s*\()/g, token: "function" },
    { pattern: /@\w+/g, token: "decorator" },
  ],
  rust: [
    { pattern: /\b(?:fn|let|mut|const|if|else|for|while|loop|break|continue|return|match|use|pub|struct|enum|impl|trait|type|mod|crate|self|super|where|async|await|move|ref|unsafe|extern|dyn|as|in|static|box)\b/g, token: "keyword" },
    { pattern: /\b(?:i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|HashMap|HashSet|Self|true|false|Some|None|Ok|Err)\b/g, token: "type" },
    { pattern: /\b(?:println!|print!|format!|vec!|assert!|assert_eq!|todo!|unimplemented!|panic!|dbg!)\b/g, token: "function" },
    { pattern: /(?<=\.)\w+(?=\s*\()/g, token: "function" },
    { pattern: /#\[[\w:(),]+\]/g, token: "decorator" },
  ],
  html: [
    { pattern: /<\/?[\w-]+/g, token: "keyword" },
    { pattern: /\b[\w-]+(?==)/g, token: "type" },
  ],
  css: [
    { pattern: /\.[\w-]+/g, token: "type" },
    { pattern: /#[\w-]+/g, token: "number" },
    { pattern: /@[\w-]+/g, token: "keyword" },
  ],
  json: [
    { pattern: /"(?:[^"\\]|\\.)*"(?=\s*:)/g, token: "keyword" },
    { pattern: /"(?:[^"\\]|\\.)*"/g, token: "string" },
  ],
  shell: [
    { pattern: /\b(?:echo|cd|ls|mkdir|rm|cp|mv|cat|grep|sed|awk|chmod|chown|sudo|npm|npx|yarn|pnpm|git|docker|curl|wget|tar|zip|unzip|apt|brew|pip|cargo|rustc|node|tsx|ts-node)\b/g, token: "function" },
    { pattern: /#.*/g, token: "comment" },
    { pattern: /"(?:[^"\\]|\\.)*"/g, token: "string" },
    { pattern: /'(?:[^'\\]|\\.)*'/g, token: "string" },
    { pattern: /--?[\w-]+/g, token: "type" },
    { pattern: /\$\w+/g, token: "variable" },
  ],
};

/**
 * 对原始（未转义的）代码文本进行分词，
 * 返回 Token 数组。Token 不重叠，先匹配先生效。
 */
function tokenize(code: string, lang: string): Token[] {
  const key = lang.toLowerCase();
  const rules = [...commonRules, ...(langRules[key] || [])];
  const tokens: Token[] = [];
  const occupied: Array<[number, number]> = [];

  function overlaps(start: number, end: number): boolean {
    for (const [occupiedStart, occupiedEnd] of occupied) {
      if (start < occupiedEnd && end > occupiedStart) return true;
    }
    return false;
  }

  function occupy(start: number, end: number) {
    occupied.push([start, end]);
  }

  for (const rule of rules) {
    // 每条规则重置 lastIndex（因为带 g flag）
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(code)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!overlaps(start, end)) {
        tokens.push({ start, end, token: rule.token });
        occupy(start, end);
      }
    }
  }

  tokens.sort((a, b) => a.start - b.start);
  return tokens;
}

/**
 * 对代码文本进行语法高亮，返回 HTML。
 * 内部完成 HTML 转义 + span 包裹。
 */
function highlightCode(code: string, lang: string): { html: string } {
  if (code.length > HIGHLIGHT_MAX_CHARS) {
    return { html: escapeHtml(code) };
  }
  const tokens = tokenize(code, lang);
  if (!tokens.length) {
    return { html: escapeHtml(code) };
  }

  let html = "";
  let cursor = 0;

  for (const t of tokens) {
    // Token 之前的普通文本
    if (cursor < t.start) {
      html += escapeHtml(code.slice(cursor, t.start));
    }
    // Token 本身（HTML 转义后再包裹 span）
    html += `<span class="tok-${t.token}">${escapeHtml(code.slice(t.start, t.end))}</span>`;
    cursor = t.end;
  }

  // 最后的普通文本
  if (cursor < code.length) {
    html += escapeHtml(code.slice(cursor));
  }

  return { html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
