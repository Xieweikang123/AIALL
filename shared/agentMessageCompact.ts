import type { ChatCompletionMessage, ChatContentPart } from "./chatCompletionTypes";

/**
 * Request-size measurement helpers.
 *
 * The message-compaction machinery that used to live here was removed: the
 * agent now sends messages to the model as-is (`run.rs`: "No auto-compression"),
 * so nothing calls it. These functions remain because the runtime still reports
 * `contextChars` (messages + tool schemas) via the `turn_request` event.
 *
 * `MAX_HISTORY_*` are re-exported for callers that historically imported them
 * from this module; the definitions live in `agentContextLimits`.
 */
export { MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES } from "./agentContextLimits";

function contentCharSize(content: string | ChatContentPart[] | null | undefined): number {
  if (!content) return 0;
  if (typeof content === "string") return content.length;
  return content.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length;
    if (part.type === "image_url") return sum + part.image_url.url.length;
    return sum;
  }, 0);
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
