import DOMPurify from "dompurify";
import { marked } from "marked";

const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const langAttr = lang ? ` class="language-${lang}"` : "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre${langAttr}><code${langAttr}>${escaped}</code></pre>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

export function resetCodeBlockIndex() {
  // 已不再为代码块生成按钮,保留为空函数以保持兼容。
}

let purifyHookInstalled = false;

function sanitizeMarkdownHtml(html: string): string {
  if (!purifyHookInstalled && typeof DOMPurify.addHook === "function") {
    DOMPurify.addHook("uponSanitizeElement", (currentNode, data) => {
      if (data.tagName !== "BUTTON") return;
      const el = currentNode as HTMLElement;
      const text = el.textContent?.trim();
      if (text) {
        el.replaceWith(document.createTextNode(text));
      } else {
        el.remove();
      }
    });
    purifyHookInstalled = true;
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["input", "form", "select", "textarea", "iframe", "script", "style", "object", "embed"],
  });
}

export function renderMarkdown(text: string): string {
  const source = String(text || "").trim();
  if (!source) return "";
  const raw = marked.parse(source, { async: false }) as string;
  return sanitizeMarkdownHtml(raw);
}
