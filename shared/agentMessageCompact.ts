import type { ChatCompletionMessage, ChatContentPart } from "./chatCompletionTypes";
import {
  MAX_TOOL_RESULT_MODEL_CHARS,
  SOFT_COMPACT_CONTEXT_CHARS,
} from "./agentContextLimits";

export {
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_TOOL_RESULT_MODEL_CHARS,
  SOFT_COMPACT_CONTEXT_CHARS,
} from "./agentContextLimits";

export const MAX_SSE_TEXT_CHARS = 24_000;
export const MAX_TOOL_RESULT_SSE_CHARS = 16_000;
const PROTECTED_RECENT_TOOL_RESULTS = 2;

function contentCharSize(content: string | ChatContentPart[] | null | undefined): number {
  if (!content) return 0;
  if (typeof content === "string") return content.length;
  return content.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length;
    if (part.type === "image_url") return sum + part.image_url.url.length;
    return sum;
  }, 0);
}

export function truncateText(text: string, max: number, suffix: string): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n${suffix.replace("{n}", String(text.length))}`;
}

export function truncateToolResultForModel(text: string): string {
  return truncateText(
    text,
    MAX_TOOL_RESULT_MODEL_CHARS,
    "…（内容已截断，共 {n} 字符。如需更多请用 read_file 的 offset/limit 分段读取）",
  );
}

export function messageCharSize(message: ChatCompletionMessage): number {
  let size = contentCharSize(message.content);
  if (message.tool_calls?.length) {
    size += JSON.stringify(message.tool_calls).length;
  }
  return size;
}

/**
 * Size of the `tools` array as serialized into the request body.
 *
 * Tool schemas are sent with **every** model call but sit outside the message
 * list, so measuring messages alone under-counts the real payload. `unknown`
 * rather than a concrete type keeps this usable from callers that only have a
 * parsed JSON value.
 */
export function toolsCharSize(tools: unknown): number {
  if (tools === null || tools === undefined) return 0;
  if (Array.isArray(tools) && tools.length === 0) return 0;
  try {
    return JSON.stringify(tools).length;
  } catch {
    return 0;
  }
}

export function compactMessagesForModel(
  messages: ChatCompletionMessage[],
  tools: unknown = [],
  maxContextChars = SOFT_COMPACT_CONTEXT_CHARS,
): ChatCompletionMessage[] {
  const result = messages.map((message) => {
    if (message.role !== "tool" || !message.content) return { ...message };
    return { ...message, content: truncateToolResultForModel(String(message.content)) };
  });

  // Tool definitions ride along on every call and are never compressed, so they
  // are a constant overhead baked into the total from the start.
  const toolsSize = toolsCharSize(tools);
  let total = result.reduce((sum, message) => sum + messageCharSize(message), 0) + toolsSize;
  const needsHardCompact = total > maxContextChars;
  const needsSoftCompact = total > SOFT_COMPACT_CONTEXT_CHARS;
  if (!needsHardCompact && !needsSoftCompact) return result;

  const compressTarget = needsHardCompact ? maxContextChars : SOFT_COMPACT_CONTEXT_CHARS;

  const toolIndexes = result
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const compressible = Math.max(0, toolIndexes.length - PROTECTED_RECENT_TOOL_RESULTS);

  for (let ti = 0; ti < compressible; ti += 1) {
    const index = toolIndexes[ti];
    const raw = String(result[index].content || "");
    const lineHint = raw.match(/lines \d+-\d+/)?.[0] || "";
    const prevSize = messageCharSize(result[index]);
    result[index] = {
      ...result[index],
      content: `（较早的工具输出已压缩${lineHint ? `，${lineHint}` : ""}，约 ${raw.length} 字符）`,
    };
    total += messageCharSize(result[index]) - prevSize;
    if (total <= compressTarget) break;
  }

  if (total > maxContextChars) {
    const systemIdx = result.findIndex((message) => message.role === "system");
    if (systemIdx >= 0) {
      const sysContent = String(result[systemIdx]?.content || "");
      const excess = total - maxContextChars;
      if (sysContent.length > excess + 500) {
        result[systemIdx] = {
          ...result[systemIdx],
          content: `${sysContent.slice(0, sysContent.length - excess - 80)}\n…（system 上下文已截断）`,
        };
      }
    }
  }

  return result;
}
