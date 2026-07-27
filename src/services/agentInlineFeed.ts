import {
  thoughtDuplicatesBubble,
  isAgentToolTurnNarration,
} from "./agentMessageDisplay";
import {
  computeExplorationStats,
  formatCollapsedStepsSummary,
  formatExplorationSummary,
  type CursorFeedItem,
} from "./agentCursorFeed";
import type { AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";
import { buildFilteredCursorAgentFeedItems, type UnifiedAgentTimelineInput } from "./agentCompactStatus";
import { debugLog } from "../utils/debugLog";

export type InlineFeedTextItem = {
  kind: "text";
  key: string;
  text: string;
  variant: "narrative" | "answer";
  streaming?: boolean;
};

export type InlineFeedToolItem = {
  kind: "tool";
  key: string;
  step: AgentRoundTool;
};

export type InlineFeedStatusItem = {
  kind: "status";
  key: string;
  text: string;
};

export type InlineFeedCollapsedItem = {
  kind: "collapsed";
  key: string;
  summary: string;
  items: InlineFeedProcessItem[];
};

export type InlineFeedProcessItem =
  | InlineFeedTextItem
  | InlineFeedToolItem
  | InlineFeedStatusItem;

export type InlineFeedItem = InlineFeedProcessItem | InlineFeedCollapsedItem;

export type InlineFeedCollapseOptions = {
  collapseAfter: number;
  keepVisible: number;
  disabled?: boolean;
};

export type InlineAgentFeedInput = UnifiedAgentTimelineInput & {
  showProcess?: boolean;
};

export type InlineAgentFeed = {
  items: InlineFeedItem[];
  hasAnswer: boolean;
  toolCount: number;
  answerStreaming: boolean;
};

const DEFAULT_COLLAPSE_AFTER = 5;
const DEFAULT_KEEP_VISIBLE = 4;

export function resolveInlineFeedCollapseOptions(
  input: Pick<UnifiedAgentTimelineInput, "activityDetailed" | "compactFeed" | "isRunning" | "chatMode">,
): InlineFeedCollapseOptions {
  if (input.activityDetailed) {
    return { collapseAfter: 12, keepVisible: 8, disabled: true };
  }
  if (input.chatMode === "ask" && input.isRunning) {
    return { collapseAfter: 2, keepVisible: 2, disabled: false };
  }
  if (input.compactFeed && input.isRunning) {
    return { collapseAfter: 4, keepVisible: 3, disabled: false };
  }
  if (input.isRunning) {
    return { collapseAfter: 5, keepVisible: 4, disabled: false };
  }
  return { collapseAfter: DEFAULT_COLLAPSE_AFTER, keepVisible: DEFAULT_KEEP_VISIBLE, disabled: false };
}

/** Drop tool-turn filler and narratives already shown in the answer slot. */
export function filterInlineTimelineItems(
  items: InlineFeedItem[],
  options?: { answerPreview?: string; hideNarratives?: boolean },
): InlineFeedItem[] {
  if (options?.hideNarratives) {
    return items.filter((item) => item.kind !== "text" || item.variant !== "narrative");
  }
  const answerPreview = options?.answerPreview?.trim() ?? "";
  return items.filter((item) => {
    if (item.kind !== "text" || item.variant !== "narrative") return true;
    const text = item.text.trim();
    if (!text) return false;
    if (isAgentToolTurnNarration(text)) return false;
    if (answerPreview && thoughtDuplicatesBubble(text, answerPreview)) return false;
    return true;
  });
}

function isAnswerItem(item: InlineFeedItem): item is InlineFeedTextItem {
  return item.kind === "text" && item.variant === "answer";
}

function isProcessItem(item: InlineFeedItem): item is InlineFeedProcessItem {
  if (item.kind === "collapsed") return false;
  if (item.kind === "text" && item.variant === "answer") return false;
  return true;
}

function collectToolsFromProcessItems(items: InlineFeedProcessItem[]): AgentRoundTool[] {
  return items.filter((item): item is InlineFeedToolItem => item.kind === "tool").map((item) => item.step);
}

export function countToolsInInlineFeed(items: InlineFeedItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.kind === "tool") count += 1;
    else if (item.kind === "collapsed") count += countToolsInInlineFeed(item.items);
  }
  return count;
}

/** Fold early tools when count exceeds threshold; answer items stay visible. */
export function collapseInlineFeedItems(
  items: InlineFeedItem[],
  options: InlineFeedCollapseOptions,
): InlineFeedItem[] {
  if (options.disabled) return items;

  // Count tool items across the full array
  const toolIndices: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]?.kind === "tool") toolIndices.push(index);
  }

  if (toolIndices.length <= options.collapseAfter) return items;

  const runningIndex = items.findIndex(
    (item) => item.kind === "tool" && item.step.running,
  );

  let splitAt = toolIndices[toolIndices.length - options.keepVisible] ?? items.length;
  if (runningIndex >= 0 && runningIndex < splitAt) {
    splitAt = runningIndex;
  }
  if (splitAt <= 0) return items;

  // Preserve answer items outside the hidden portion
  const hidden: InlineFeedProcessItem[] = [];
  const visible: InlineFeedItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (i < splitAt && isProcessItem(item)) {
      hidden.push(item);
    } else {
      visible.push(item);
    }
  }

  const hiddenTools = collectToolsFromProcessItems(hidden);
  if (!hiddenTools.length) return items;

  return [
    {
      kind: "collapsed",
      key: "inline-collapsed-prefix",
      summary: formatCollapsedStepsSummary(hiddenTools),
      items: hidden,
    },
    ...visible,
  ];
}

function cursorItemsToInline(items: CursorFeedItem[]): InlineFeedItem[] {
  const inline: InlineFeedItem[] = [];
  for (const item of items) {
    if (item.kind === "thought") {
      inline.push({ kind: "text", key: item.key, text: item.text, variant: "narrative" });
    } else if (item.kind === "action") {
      inline.push({ kind: "tool", key: item.key, step: item.step });
    } else if (item.kind === "status") {
      inline.push({ kind: "status", key: item.key, text: item.text });
    }
  }
  return inline;
}

function normalizeInlineAnswerText(text: string, lastNarrative: string): string {
  const answer = text.trim();
  const narrative = lastNarrative.trim();
  if (!answer || !narrative) return text;
  if (answer === narrative) return text;
  if (answer.startsWith(narrative) && answer.length > narrative.length) {
    const rest = answer.slice(narrative.length).trimStart();
    return rest || text;
  }
  return text;
}

function resolveInlineAnswerHasContent(
  items: InlineFeedItem[],
): boolean {
  return items.some(
    (item) => item.kind === "text" && item.variant === "answer" && (item.text.trim() || item.streaming),
  );
}

/** Per-turn answer blocks from roundGroups — stable key for the first/streaming answer. */
function buildPerTurnAnswerItems(
  roundGroups: AgentRoundGroupView[],
  answerStreaming: boolean,
  answerPreview: string,
): InlineFeedTextItem[] {
  const items: InlineFeedTextItem[] = [];
  let firstFinal = true;

  for (const group of roundGroups) {
    if (group.turn <= 0) continue;
    const text = group.response?.assistantText?.trim();
    if (!text || !group.response?.isFinal) continue;
    // First answer reuses "inline-answer" key to avoid Vue unmount flash
    items.push({
      kind: "text",
      key: firstFinal ? "inline-answer" : `turn-answer-${group.turn}`,
      text,
      variant: "answer",
      streaming: false,
    });
    firstFinal = false;
  }

  // Streaming placeholder when no completed answer yet — uses answerPreview for live text
  if (!items.length && answerStreaming) {
    items.push({
      kind: "text",
      key: "inline-answer",
      text: answerPreview,
      variant: "answer",
      streaming: true,
    });
  }

  debugLog("[inlineFeed] buildPerTurnAnswerItems", {
    roundGroupCount: roundGroups.length,
    answerItemCount: items.length,
    turnKeys: items.map((i) => i.key),
  });

  return items;
}

/** Single merged-answer fallback when no per-turn data is available (pre-stream / plain assistant). */
function mergedAnswerFallback(answerPreview: string, answerStreaming: boolean): InlineFeedTextItem[] {
  const text = answerPreview.trim();
  if (!text && !answerStreaming) return [];
  return [{
    kind: "text",
    key: "inline-answer",
    text: answerPreview,
    variant: "answer",
    streaming: answerStreaming,
  }];
}

/** Drop trailing narrative text duplicated by the final answer block. */
export function appendInlineAnswerBlock(
  items: InlineFeedItem[],
  answerPreview: string,
  answerStreaming: boolean,
): InlineFeedItem[] {
  const trimmed = answerPreview.trim();
  if (!trimmed && !answerStreaming) return items;

  const result = [...items];
  let lastNarrative = "";

  debugLog("[inlineFeed] appendInlineAnswerBlock", {
    itemCount: items.length,
    answerPreview: trimmed.slice(0, 80),
    answerStreaming,
    itemKinds: items.map((i) => `${i.kind}:${i.kind === "text" ? i.variant : ""}`).join(", "),
  });

  for (let index = result.length - 1; index >= 0; index -= 1) {
    const item = result[index];
    if (item?.kind !== "text" || item.variant !== "narrative") continue;
    lastNarrative = item.text;
    if (trimmed && thoughtDuplicatesBubble(item.text, trimmed)) {
      debugLog("[inlineFeed] removing duplicate narrative", {
        index,
        narrative: item.text.slice(0, 80),
        answer: trimmed.slice(0, 80),
      });
      result.splice(index, 1);
    }
    break;
  }

  const answerText = trimmed
    ? normalizeInlineAnswerText(answerPreview, lastNarrative)
    : answerPreview;

  debugLog("[inlineFeed] pushing answer item", {
    answerText: answerText.slice(0, 80),
    lastNarrative: lastNarrative.slice(0, 80),
    resultLength: result.length,
  });

  result.push({
    kind: "text",
    key: "inline-answer",
    text: answerText,
    variant: "answer",
    streaming: answerStreaming,
  });
  return result;
}

export function splitInlineFeedItems(items: InlineFeedItem[]): {
  process: InlineFeedItem[];
  answers: InlineFeedTextItem[];
} {
  const process: InlineFeedItem[] = [];
  const answers: InlineFeedTextItem[] = [];
  for (const item of items) {
    if (isAnswerItem(item)) {
      answers.push(item);
    } else {
      process.push(item);
    }
  }
  debugLog("[inlineFeed] splitInlineFeedItems", {
    inputCount: items.length,
    processCount: process.length,
    answerCount: answers.length,
    answerTexts: answers.map((a) => a.text.slice(0, 60)),
  });
  return { process, answers };
}

export function collectToolsFromInlineFeed(items: InlineFeedItem[]): AgentRoundTool[] {
  const tools: AgentRoundTool[] = [];
  for (const item of items) {
    if (item.kind === "tool") tools.push(item.step);
    else if (item.kind === "collapsed") tools.push(...collectToolsFromInlineFeed(item.items));
  }
  return tools;
}

/** One-line process summary for collapsed details (streamlined UI). */
export function summarizeInlineFeedProcess(
  items: InlineFeedItem[],
  toolCount: number,
  isRunning: boolean,
): string {
  const tools = collectToolsFromInlineFeed(items);
  if (tools.length) {
    const stats = computeExplorationStats(tools);
    const body = formatExplorationSummary(stats, isRunning).replace(/^已完成 · /, "");
    if (isRunning) return body;
    return toolCount > 0 ? `${toolCount} 步 · ${body}` : body;
  }
  const narratives = items.filter(
    (item): item is InlineFeedTextItem => item.kind === "text" && item.variant === "narrative",
  );
  if (narratives.length) {
    return isRunning ? "思考中…" : `${narratives.length} 段分析`;
  }
  return isRunning ? "准备中…" : "查看过程";
}

function stripInlineStatusItems(items: InlineFeedItem[], isRunning: boolean): InlineFeedItem[] {
  if (!isRunning) return items;
  const result: InlineFeedItem[] = [];
  for (const item of items) {
    if (item.kind === "status") continue;
    if (item.kind === "collapsed") {
      result.push({
        ...item,
        items: stripInlineStatusItems(item.items, isRunning) as InlineFeedProcessItem[],
      });
      continue;
    }
    result.push(item);
  }
  return result;
}

/** Position each answer after the latest item from a strictly earlier turn; append floating items at end. */
function interleaveTurnAnswers(
  items: InlineFeedItem[],
  roundGroups: AgentRoundGroupView[],
  allAnswerItems: InlineFeedTextItem[],
): InlineFeedItem[] {
  // Build toolId → turn map
  const toolIdToTurn = new Map<string, number>();
  for (const group of roundGroups) {
    for (const tool of group.tools) {
      toolIdToTurn.set(tool.id, group.turn);
    }
  }

  // Map every item to its turn (0 = unknown/untyped)
  const itemTurn = new Map<number, number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "tool") {
      const turn = toolIdToTurn.get(item.step.id);
      if (turn) itemTurn.set(i, turn);
    } else if (item.kind === "text" && item.variant === "narrative") {
      const m = item.key.match(/^thought-(\d+)/);
      if (m) itemTurn.set(i, parseInt(m[1]));
    }
  }

  // Collect isFinal turns from roundGroups for fallback turn resolution
  const finalTurns = roundGroups
    .filter((g) => g.turn > 0 && g.response?.isFinal)
    .map((g) => g.turn)
    .sort((a, b) => a - b);
  let finalIndex = 0;

  // Separate turn-keyed answers vs floating answers
  const turnAnswers: Array<{ turn: number; item: InlineFeedTextItem }> = [];
  const floating: InlineFeedTextItem[] = [];
  for (const item of allAnswerItems) {
    const m = item.key.match(/^turn-answer-(\d+)/);
    if (m) {
      turnAnswers.push({ turn: parseInt(m[1]), item });
    } else if (item.key === "inline-answer" && finalIndex < finalTurns.length) {
      // First answer without explicit turn — resolve from roundGroups
      turnAnswers.push({ turn: finalTurns[finalIndex], item });
      finalIndex += 1;
    } else {
      floating.push(item);
    }
  }

  // Sort answer turns ascending for stable insertions
  turnAnswers.sort((a, b) => a.turn - b.turn);

  const result = [...items];
  let insertedCount = 0;

  for (const ta of turnAnswers) {
    // Find last item whose turn is strictly < ta.turn
    let anchor = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      const turn = itemTurn.get(i);
      if (turn && turn < ta.turn) { anchor = i; break; }
    }
    // When no earlier turn found, fall back to before any process item or at end
    if (anchor < 0) {
      anchor = result.findIndex((it) => it.kind !== "text" || it.variant !== "answer") - 1;
    }
    result.splice(anchor + 1, 0, ta.item);
    insertedCount += 1;
    // Shift itemTurn indices for items after the insertion point
    const shifted = new Map<number, number>();
    for (const [idx, turn] of itemTurn) {
      shifted.set(idx < anchor + 1 ? idx : idx + 1, turn);
    }
    itemTurn.clear();
    for (const [idx, turn] of shifted) itemTurn.set(idx, turn);
  }

  if (floating.length) result.push(...floating);
  return result;
}

/** Linear timeline: narrative ↔ tools per turn, per-turn answer blocks interleaved. */
export function buildInlineAgentFeed(input: InlineAgentFeedInput): InlineAgentFeed {
  debugLog("[inlineFeed] buildInlineAgentFeed", {
    showProcess: input.showProcess,
    answerPreview: input.answerPreview.slice(0, 80),
    answerStreaming: input.answerStreaming,
    roundGroupsCount: input.roundGroups?.length,
    isRunning: input.isRunning,
  });

  const answerItems = buildPerTurnAnswerItems(input.roundGroups, input.answerStreaming, input.answerPreview);

  // Fallback: use answerPreview when no per-turn answer derived from roundGroups
  // (e.g. pre-stream or non-agent messages)
  const resolvedAnswerItems = answerItems.length
    ? answerItems
    : mergedAnswerFallback(input.answerPreview, input.answerStreaming);

  if (input.showProcess === false) {
    return {
      items: resolvedAnswerItems,
      hasAnswer: resolveInlineAnswerHasContent(resolvedAnswerItems),
      toolCount: 0,
      answerStreaming: input.answerStreaming,
    };
  }

  const feedItems = buildFilteredCursorAgentFeedItems(input);

  debugLog("[inlineFeed] feedItems built", {
    feedItemCount: feedItems.length,
    kinds: feedItems.map((i) => i.kind).join(","),
  });

  const inline = cursorItemsToInline(feedItems);

  // Interleave: insert turn-keyed answer items after their turn's process items
  const withAnswers = interleaveTurnAnswers(inline, input.roundGroups, resolvedAnswerItems);

  const collapseOptions = resolveInlineFeedCollapseOptions(input);
  const collapsed = collapseInlineFeedItems(withAnswers, collapseOptions);
  const items = stripInlineStatusItems(collapsed, input.isRunning);

  return {
    items,
    hasAnswer: resolveInlineAnswerHasContent(items),
    toolCount: countToolsInInlineFeed(items),
    answerStreaming: input.answerStreaming,
  };
}
