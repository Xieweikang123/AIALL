import { stripAgentProgressMarker } from "./agentProgressMarker";
import { stripAgentSuggestions } from "./agentSuggestions";
import { stripTextToolCallMarkup, TOOL_MARKUP_START_RE } from "./textToolCallMarkup";
import { stripToolSummaryFromAssistantContent } from "./vibeChatStorage";

/** Quick scan — skip full sanitize pipeline for typical assistant prose. */
const SANITIZE_HINT_RE =
  /<!--|<!(?:[^->]|-(?!->))|<function|<invoke|<tool_call|<tool_invocation|\[Tool call|agent-progress|agent-suggestions|agent-tool-log|\[工具摘要\]|#\s*工具摘要|`[^`\n]+\?`\s*:\s*`[^`\n]+`|(?:^|\n)[-*•>\s]*(?:读取文件|列出目录|浏览目录|搜索代码|搜索内容|搜索文件|写入文件|局部修改|删除文件|执行命令|联网搜索|抓取网页)[：:]/i;

/**
 * Strip trailing markdown artifacts at source level — GFM horizontal rules (---, ***, ___)
 * and empty ATX headings (### on its own line) — that render as content-free block elements
 * (&lt;hr&gt;, &lt;h3&gt;&lt;/h3&gt;) at the bottom of messages.
 *
 * We strip at source level (not HTML) so the cleaned text enters the render cache;
 * stale cache entries from before the fix won't be hit because the input key has changed.
 */
function stripTrailingMarkdownArtifacts(text: string): string {
  // Remove trailing HR lines and empty headings. Match from start-of-string (^) or after \n
  // so that standalone `---` (no preceding newline) is also caught.
  let result = text.replace(
    /(?:(?:^|\n)\s*(?:[-*_]){3,}(?:\s+(?:[-*_]))*\s*)+(?:\n?\s*#+\s*)?$/,
    "",
  ).trim();
  // Post-strip guard: if after removal the entire result is still an HR or empty heading, clear it
  if (/^\s*(?:[-*_]){3,}(?:\s+(?:[-*_]))*\s*$/.test(result)) return "";
  if (/^\s*#+\s*$/.test(result)) return "";
  return result;
}

export function needsMarkdownDisplaySanitize(text: string): boolean {
  return SANITIZE_HINT_RE.test(text) || TOOL_MARKUP_START_RE.test(text);
}

/** Remove HTML comments that would leak into rendered markdown (anywhere in text). */
export function stripVisibleHtmlComments(text: string): string {
  let result = text;
  result = result.replace(/<!--[\s\S]*?-->/g, "");
  result = result.replace(/<!(?:[^->]|-(?!->))[\s\S]*?-->/g, "");
  result = result.replace(/<!--[\s\S]*$/g, "");
  result = result.replace(/<!\s*$/g, "");
  return result;
}

/**
 * Merge `` `prop?`: `type` `` → `` `prop?: type` `` — common LLM typo for TS optional fields.
 */
export function mergeSplitOptionalTypeInlineCode(source: string): string {
  return source.replace(/`([^`\n]+)\?`\s*:\s*`([^`\n]+)`/g, "`$1?: $2`");
}

/** Collapse repeated markdown section headers (common while SSE appends section blocks). */
export function collapseDuplicateMarkdownHeaders(text: string): string {
  let result = text;
  let prev = "";
  while (prev !== result) {
    prev = result;
    result = result.replace(/(^|\n)(#{1,3}\s+[^\n]+)\n+\2(?=\n|$)/gm, "$1$2");
  }
  return result;
}

/** Normalize assistant/thought markdown before ChatMarkdown rendering. */
export function sanitizeMarkdownForDisplay(text: string): string {
  if (!text) return "";
  let normalized = stripTrailingMarkdownArtifacts(text);
  if (!normalized) return "";
  normalized = collapseDuplicateMarkdownHeaders(normalized);
  if (!needsMarkdownDisplaySanitize(normalized)) return normalized;

  let result = stripTextToolCallMarkup(normalized);
  result = stripToolSummaryFromAssistantContent(result);
  result = stripAgentSuggestions(result);
  result = stripAgentProgressMarker(result);
  result = stripVisibleHtmlComments(result);
  result = mergeSplitOptionalTypeInlineCode(result);
  return result.trim();
}

/** Lighter sanitize while SSE is still growing — avoid stripping partial answer tails
 * that resemble tool logs, but still remove HTML comment leaks and completed tool markup.
 */
export function sanitizeMarkdownForStreamingDisplay(text: string): string {
  if (!text) return "";
  let result = stripTrailingMarkdownArtifacts(text);
  if (!result) return "";
  result = stripVisibleHtmlComments(result);
  if (TOOL_MARKUP_START_RE.test(result)) {
    result = stripTextToolCallMarkup(result);
  }
  result = mergeSplitOptionalTypeInlineCode(result);
  return result.trim();
}
