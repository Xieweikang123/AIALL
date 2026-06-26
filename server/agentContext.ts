import type { ChatCompletionMessage } from "./aiForward";
import type { VibeChatHistoryMessage, VibeAgentEvent } from "../shared/agentTypes";
import { contentCharSize, contentDisplayText } from "./visionMessage";
import { MAX_AGENT_CONTEXT_CHARS } from "./agentRunPolicy";

export const MAX_HISTORY_MESSAGES = 40;
export const MAX_HISTORY_CHARS = 120_000;
export const MAX_SSE_TEXT_CHARS = 24_000;
export const MAX_TOOL_RESULT_SSE_CHARS = 16_000;
export const MAX_TOOL_RESULT_MODEL_CHARS = 10_000;
export const SOFT_COMPACT_CONTEXT_CHARS = 36_000;
const PROTECTED_RECENT_TOOL_RESULTS = 2;
export const TURN_DISPLAY_MESSAGE_CHARS = 2_400;

export function truncateText(text: string, max: number, suffix: string): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n${suffix.replace("{n}", String(text.length))}`;
}

export function truncateForSse(text: string, max = MAX_SSE_TEXT_CHARS): string {
  return truncateText(text, max, "…（内容较长，已自动续跑中…）");
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

export function compactMessagesForModel(
  messages: ChatCompletionMessage[],
  maxContextChars = MAX_AGENT_CONTEXT_CHARS,
): ChatCompletionMessage[] {
  const result = messages.map((message) => {
    if (message.role !== "tool" || !message.content) return { ...message };
    return { ...message, content: truncateToolResultForModel(String(message.content)) };
  });

  let total = result.reduce((sum, message) => sum + messageCharSize(message), 0);
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
