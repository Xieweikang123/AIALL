import type { ChatCompletionMessage } from "./chatCompletionTypes";

/** Normalize message shapes for picky OpenAI-compatible gateways (e.g. Xiaomi). */
export function normalizeMessagesForChatApi(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      const toolCalls = message.tool_calls.filter((call) => call.id && call.function?.name);
      return {
        ...message,
        content: message.content == null ? "" : message.content,
        tool_calls: toolCalls,
      };
    }
    if (message.role === "tool") {
      return {
        ...message,
        content: message.content == null ? "" : String(message.content),
      };
    }
    return message;
  });
}
