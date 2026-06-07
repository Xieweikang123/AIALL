import DOMPurify from "dompurify";
import { marked } from "marked";

let codeBlockIndex = 0;

let applyButtonsEnabled = true;

const NO_APPLY_LANGS = new Set([
  "vue",
  "html",
  "htm",
  "xml",
  "markdown",
  "md",
  "bash",
  "sh",
  "shell",
  "zsh",
  "powershell",
  "ps1",
  "yaml",
  "yml",
  "text",
  "plaintext",
  "diff",
  "log",
]);

const MARKUP_HEURISTIC_RE = /<template[\s>]|@click=|v-if=|v-else|\{\{[\s\S]*?\}\}/;

function shouldOfferApplyButton(text: string, lang?: string): boolean {
  if (!applyButtonsEnabled) return false;
  const normalized = (lang || "").trim().toLowerCase();
  if (normalized && NO_APPLY_LANGS.has(normalized)) return false;
  if (!normalized) {
    const sample = text.trim();
    if (MARKUP_HEURISTIC_RE.test(sample)) return false;
    if (/^<\w+[\s>]/m.test(sample)) return false;
  }
  return true;
}

const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const langAttr = lang ? ` class="language-${lang}"` : "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const pre = `<pre${langAttr}><code${langAttr}>${escaped}</code></pre>`;
  if (!shouldOfferApplyButton(text, lang)) {
    return pre;
  }
  const index = codeBlockIndex++;
  return `<div class="code-block-wrapper">${pre}<button type="button" class="code-block-apply-btn" data-block-index="${index}">写入代码块 ${index + 1}</button></div>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

export function resetCodeBlockIndex() {
  codeBlockIndex = 0;
}

export type RenderMarkdownOptions = {
  applyButtons?: boolean;
};

let purifyHookInstalled = false;

function sanitizeMarkdownHtml(html: string): string {
  if (!purifyHookInstalled && typeof DOMPurify.addHook === "function") {
    DOMPurify.addHook("uponSanitizeElement", (currentNode, data) => {
      if (data.tagName !== "BUTTON") return;
      const el = currentNode as HTMLElement;
      if (!el.classList?.contains("code-block-apply-btn")) {
        const text = el.textContent?.trim();
        if (text) {
          el.replaceWith(document.createTextNode(text));
        } else {
          el.remove();
        }
      }
    });
    purifyHookInstalled = true;
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["input", "form", "select", "textarea", "iframe", "script", "style", "object", "embed"],
  });
}

export function renderMarkdown(text: string, options?: RenderMarkdownOptions): string {
  const source = String(text || "").trim();
  if (!source) return "";
  codeBlockIndex = 0;
  applyButtonsEnabled = options?.applyButtons !== false;
  const raw = marked.parse(source, { async: false }) as string;
  applyButtonsEnabled = true;
  return sanitizeMarkdownHtml(raw);
}

/** @internal */
export function shouldShowCodeBlockApplyButton(text: string, lang?: string): boolean {
  return shouldOfferApplyButton(text, lang);
}
