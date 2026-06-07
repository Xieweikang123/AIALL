import type { AgentRoundGroup } from "./agentRoundGroups";
import type { CursorFeedItem } from "./agentCursorFeed";

export type AssistantBubbleSource = {
  content?: string;
  roundGroups?: AgentRoundGroup[];
  turnTraces?: Array<{ assistantText: string }>;
};

/** Resolve the text shown in the assistant chat bubble (with fallbacks for agent runs). */
export function resolveAssistantBubbleContent(msg: AssistantBubbleSource): string {
  const direct = msg.content?.trim();
  if (direct) return direct;

  const fromFinal = msg.roundGroups
    ?.filter((group) => group.response?.isFinal && group.response.assistantText.trim())
    .at(-1)?.response?.assistantText.trim();
  if (fromFinal) return fromFinal;

  const narratives = msg.roundGroups?.map((group) => group.narrative?.trim()).filter(Boolean) ?? [];
  if (narratives.length) return narratives[narratives.length - 1]!;

  return msg.turnTraces?.at(-1)?.assistantText.trim() || "";
}

export function normalizeComparableText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Whether a feed thought duplicates text already shown in the answer bubble. */
export function thoughtDuplicatesBubble(thought: string, bubbleContent: string): boolean {
  const thoughtNorm = normalizeComparableText(thought);
  const bubbleNorm = normalizeComparableText(bubbleContent);
  if (!thoughtNorm || !bubbleNorm) return false;
  if (thoughtNorm === bubbleNorm) return true;
  const minLen = Math.min(thoughtNorm.length, bubbleNorm.length);
  if (minLen < 48) return false;
  if (bubbleNorm.includes(thoughtNorm) || thoughtNorm.includes(bubbleNorm)) return true;
  const prefixLen = Math.min(thoughtNorm.length, bubbleNorm.length, 160);
  return thoughtNorm.slice(0, prefixLen) === bubbleNorm.slice(0, prefixLen);
}

export type FilterFeedThoughtsOptions = {
  /** While agent is running, bubble is the live preview — hide all feed thoughts. */
  suppressAllWhenBubble?: boolean;
};

/** Remove thought items that repeat the assistant answer bubble (or all thoughts during live preview). */
export function filterDuplicateFeedThoughts(
  items: CursorFeedItem[],
  bubbleContent: string,
  options?: FilterFeedThoughtsOptions,
): CursorFeedItem[] {
  const bubble = bubbleContent.trim();
  if (options?.suppressAllWhenBubble && bubble) {
    return items.filter((item) => item.kind !== "thought");
  }
  if (!bubble) return items;
  return items.filter((item) => {
    if (item.kind !== "thought") return true;
    return !thoughtDuplicatesBubble(item.text, bubble);
  });
}
