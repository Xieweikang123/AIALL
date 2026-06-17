import type { ChatToolCall } from "./aiForward";
import {
  parseTextToolCallsFromContent,
  stripTextToolCallMarkup,
  hasTextToolCallMarkup,
  TextToolCallStreamFilter,
  normalizeTextToolName,
  normalizeTextToolArgs,
  type ParsedTextToolCall,
} from "../src/services/textToolCallMarkup.ts";

export {
  stripTextToolCallMarkup,
  hasTextToolCallMarkup,
  TextToolCallStreamFilter,
  normalizeTextToolName,
  normalizeTextToolArgs,
  type ParsedTextToolCall,
};

export function synthesizeToolCallsFromText(content: string): ChatToolCall[] {
  const parsed = parseTextToolCallsFromContent(content);
  const stamp = Date.now();
  return parsed.map((item, index) => ({
    id: `text_tool_${stamp}_${index}`,
    type: "function" as const,
    function: {
      name: item.name,
      arguments: JSON.stringify(item.args),
    },
  }));
}

export { parseTextToolCallsFromContent };
