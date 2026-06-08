import type { AgentRoundGroup } from "./agentRoundGroups";
import type { CursorFeedItem } from "./agentCursorFeed";

export type AssistantBubbleSource = {
  content?: string;
  roundGroups?: AgentRoundGroup[];
  turnTraces?: Array<{ assistantText: string }>;
};

export type FinalizeAssistantBubbleSource = AssistantBubbleSource & {
  writtenFiles?: string[];
  wasAborted?: boolean;
  agentFailed?: boolean;
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

function resolveFinalAssistantText(msg: AssistantBubbleSource): string {
  return (
    msg.roundGroups
      ?.filter((group) => group.response?.isFinal && group.response.assistantText.trim())
      .at(-1)?.response?.assistantText.trim() || ""
  );
}

const COMPLETION_SUMMARY_RE = /(?:修改完成|已完成|已写入|总结|变更如下|完成了)/;

/** Whether the model already gave a substantive completion summary. */
export function hasSubstantiveAgentSummary(msg: AssistantBubbleSource): boolean {
  const finalText = resolveFinalAssistantText(msg);
  if (finalText.length >= 48) return true;
  if (COMPLETION_SUMMARY_RE.test(finalText)) return true;
  const bubble = resolveAssistantBubbleContent(msg);
  return COMPLETION_SUMMARY_RE.test(bubble);
}

/** Build a short summary when tools wrote files but the model skipped a final answer turn. */
export function buildWrittenFilesSummary(writtenFiles: string[], wasAborted = false): string {
  if (!writtenFiles.length) return "";
  const list = writtenFiles.map((file) => `- \`${file}\``).join("\n");
  const heading = wasAborted ? "## 运行中断（部分修改已落盘）" : "## 修改完成";
  const lead = wasAborted
    ? `连接在总结前结束，但以下 ${writtenFiles.length} 个文件已写入：`
    : `已写入 ${writtenFiles.length} 个文件：`;
  return `${heading}\n\n${lead}\n\n${list}`;
}

/** Append file-write summary when the run ended without a model completion message. */
export function finalizeAssistantBubbleContent(msg: FinalizeAssistantBubbleSource): string {
  const base = resolveAssistantBubbleContent(msg);
  const writtenFiles = msg.writtenFiles?.filter(Boolean) ?? [];
  if (!writtenFiles.length) return base;
  if (msg.agentFailed) return base;
  if (!msg.wasAborted && hasSubstantiveAgentSummary(msg)) return base;

  const summary = buildWrittenFilesSummary(writtenFiles, Boolean(msg.wasAborted));
  if (!base.trim()) return summary;
  if (base.includes(summary)) return base;
  return `${base.trim()}\n\n${summary}`;
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
