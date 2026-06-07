import DOMPurify from "dompurify";
import { marked } from "marked";

let codeBlockIndex = 0;

let applyButtonsEnabled = true;

const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const langAttr = lang ? ` class="language-${lang}"` : "";
  if (!applyButtonsEnabled) {
    return `<pre${langAttr}><code${langAttr}>${text}</code></pre>`;
  }
  const index = codeBlockIndex++;
  return `<div class="code-block-wrapper"><pre${langAttr}><code${langAttr}>${text}</code></pre><button class="code-block-apply-btn" data-block-index="${index}">写入代码块 ${index + 1}</button></div>`;
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

export function renderMarkdown(text: string, options?: RenderMarkdownOptions): string {
  const source = String(text || "").trim();
  if (!source) return "";
  codeBlockIndex = 0;
  applyButtonsEnabled = options?.applyButtons !== false;
  const raw = marked.parse(source, { async: false }) as string;
  applyButtonsEnabled = true;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}
