import type { ChatCompletionMessage } from "../shared/chatCompletionTypes";
import type { VibeChatHistoryMessage, VibeAgentEvent } from "../shared/agentTypes";
import { contentDisplayText } from "../src/orchestration/product/visionMessage";
import {
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_SSE_TEXT_CHARS,
  truncateText,
} from "../shared/agentMessageCompact";

export {
  compactMessagesForModel,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_SSE_TEXT_CHARS,
  MAX_TOOL_RESULT_MODEL_CHARS,
  MAX_TOOL_RESULT_SSE_CHARS,
  messageCharSize,
  SOFT_COMPACT_CONTEXT_CHARS,
  truncateText,
  truncateToolResultForModel,
} from "../shared/agentMessageCompact";

export const TURN_DISPLAY_MESSAGE_CHARS = 2_400;

export function truncateForSse(text: string, max = MAX_SSE_TEXT_CHARS): string {
  return truncateText(text, max, "…（内容较长，已自动续跑中…）");
}

export function buildHistoryMessages(history?: VibeChatHistoryMessage[]): ChatCompletionMessage[] {
  if (!history?.length) return [];

  const trimmed = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES);

  let totalChars = 0;
  const result: ChatCompletionMessage[] = [];
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const item = trimmed[i];
    const len = item.content.length;
    if (totalChars + len > MAX_HISTORY_CHARS && result.length > 0) break;
    totalChars += len;
    result.unshift({ role: item.role, content: item.content });
  }
  return result;
}

export function historyForDisplay(history?: VibeChatHistoryMessage[]): Array<{ role: string; content: string }> {
  return buildHistoryMessages(history).map((m) => ({
    role: m.role,
    content: truncateForSse(String(m.content || ""), 4000),
  }));
}

export function messagesForTurnDisplay(messages: ChatCompletionMessage[]): Array<{ role: string; content: string; toolCalls?: string }> {
  return messages.map((message) => {
    const item: { role: string; content: string; toolCalls?: string } = {
      role: message.role,
      content: truncateForSse(contentDisplayText(message.content), TURN_DISPLAY_MESSAGE_CHARS),
    };
    if (message.tool_calls?.length) {
      item.toolCalls = message.tool_calls
        .map((call) => {
          const args = call.function.arguments || "{}";
          const argsPreview = args.length > 600 ? `${args.slice(0, 600)}…` : args;
          return `${call.function.name}(${argsPreview})`;
        })
        .join("\n");
    }
    return item;
  });
}

export function formatCharCount(chars: number): string {
  if (chars >= 10_000) return `${(chars / 10_000).toFixed(1)} 万字符`;
  if (chars >= 1000) return `${(chars / 1000).toFixed(1)}k 字符`;
  return `${chars} 字符`;
}

export function formatElapsedMs(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function emitAgentContext(
  onEvent: (event: VibeAgentEvent) => void,
  data: Extract<VibeAgentEvent, { type: "agent_context" }>["data"],
) {
  onEvent({
    type: "agent_context",
    data: {
      ...data,
      systemPrompt: truncateForSse(data.systemPrompt),
      projectContext: data.projectContext ? truncateForSse(data.projectContext) : undefined,
    },
  });
}
