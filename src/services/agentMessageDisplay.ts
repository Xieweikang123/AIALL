import type { AgentRoundGroup } from "./agentRoundGroups";
import type { CursorFeedItem } from "./agentCursorFeed";
import { stripToolSummaryFromAssistantContent } from "./vibeChatStorage";

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

const SUBSTANTIVE_MIN_CHARS = 48;
const THIN_EPILOGUE_MAX_CHARS = 96;

function normalizeBubbleText(text: string): string {
  return stripToolSummaryFromAssistantContent(text).trim();
}

/** Merge streaming turn text without dropping a longer substantive answer. */
export function mergeAssistantTurnText(existing: string, incoming: string): string {
  const prev = normalizeBubbleText(existing);
  const next = normalizeBubbleText(incoming);
  if (!prev) return next;
  if (!next) return prev;
  if (prev === next) return prev;
  if (prev.includes(next)) return prev;
  if (next.includes(prev)) return next;
  if (next.length >= prev.length * 0.85) return next;
  if (prev.length >= SUBSTANTIVE_MIN_CHARS && next.length <= THIN_EPILOGUE_MAX_CHARS) {
    return `${prev}\n\n${next}`;
  }
  if (prev.length > next.length * 2 && next.length <= THIN_EPILOGUE_MAX_CHARS) return prev;
  return `${prev}\n\n${next}`;
}

function collectAssistantTextCandidates(msg: AssistantBubbleSource): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw?: string) => {
    const text = normalizeBubbleText(raw || "");
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  };

  push(msg.content);
  for (const group of msg.roundGroups ?? []) {
    push(group.narrative);
    push(group.response?.assistantText);
  }
  for (const trace of msg.turnTraces ?? []) {
    push(trace.assistantText);
  }
  return out;
}

function isThinEpilogue(short: string, anchor: string): boolean {
  if (short.length >= SUBSTANTIVE_MIN_CHARS) return false;
  if (anchor.length < SUBSTANTIVE_MIN_CHARS) return false;
  return short.length <= THIN_EPILOGUE_MAX_CHARS && anchor.length > short.length * 2;
}

function pickBestAssistantBubbleText(candidates: string[], direct: string): string {
  if (!candidates.length) return "";
  if (!direct) {
    return [...candidates].sort((a, b) => b.length - a.length)[0]!;
  }

  const longest = [...candidates].sort((a, b) => b.length - a.length)[0]!;
  if (direct.length >= SUBSTANTIVE_MIN_CHARS && direct.length >= longest.length * 0.85) {
    return direct;
  }
  if (isThinEpilogue(direct, longest)) {
    return mergeAssistantTurnText(longest, direct);
  }
  if (longest.length > direct.length * 1.5) {
    return mergeAssistantTurnText(longest, direct);
  }
  return direct;
}

/** Resolve the text shown in the assistant chat bubble (with fallbacks for agent runs). */
export function resolveAssistantBubbleContent(msg: AssistantBubbleSource): string {
  const direct = normalizeBubbleText(msg.content || "");
  const candidates = collectAssistantTextCandidates(msg);
  if (!direct && !candidates.length) return "";
  return pickBestAssistantBubbleText(candidates, direct);
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
  if (finalText.length >= SUBSTANTIVE_MIN_CHARS) return true;
  if (COMPLETION_SUMMARY_RE.test(finalText)) return true;
  const bubble = resolveAssistantBubbleContent(msg);
  if (bubble.length >= SUBSTANTIVE_MIN_CHARS) return true;
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
  if (minLen < SUBSTANTIVE_MIN_CHARS) return false;
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
