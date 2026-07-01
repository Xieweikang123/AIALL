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
import type { AgentRoundTool } from "./agentRoundGroups";
import { buildFilteredCursorAgentFeedItems, type UnifiedAgentTimelineInput } from "./agentCompactStatus";

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

/** Fold early process steps when tool count exceeds threshold; answer block is never collapsed. */
export function collapseInlineFeedItems(
  items: InlineFeedItem[],
  options: InlineFeedCollapseOptions,
): InlineFeedItem[] {
  if (options.disabled) return items;

  const answerItems = items.filter(isAnswerItem);
  const processItems = items.filter(isProcessItem);

  const toolIndices: number[] = [];
  for (let index = 0; index < processItems.length; index += 1) {
    if (processItems[index]?.kind === "tool") toolIndices.push(index);
  }

  if (toolIndices.length <= options.collapseAfter) return items;

  const runningIndex = processItems.findIndex(
    (item) => item.kind === "tool" && item.step.running,
  );

  let splitAt = toolIndices[toolIndices.length - options.keepVisible] ?? processItems.length;
  if (runningIndex >= 0 && runningIndex < splitAt) {
    splitAt = runningIndex;
  }
  if (splitAt <= 0) return items;

  const hidden = processItems.slice(0, splitAt);
  const visible = processItems.slice(splitAt);
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
    ...answerItems,
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

  for (let index = result.length - 1; index >= 0; index -= 1) {
    const item = result[index];
    if (item?.kind !== "text" || item.variant !== "narrative") continue;
    lastNarrative = item.text;
    if (trimmed && thoughtDuplicatesBubble(item.text, trimmed)) {
      result.splice(index, 1);
    }
    break;
  }

  const answerText = trimmed
    ? normalizeInlineAnswerText(answerPreview, lastNarrative)
    : answerPreview;

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
  answer: InlineFeedTextItem | null;
} {
  const process: InlineFeedItem[] = [];
  let answer: InlineFeedTextItem | null = null;
  for (const item of items) {
    if (isAnswerItem(item)) {
      answer = item;
    } else {
      process.push(item);
    }
  }
  return { process, answer };
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

/** Chronological inline stream: narrative ↔ tools interleaved, answer appended last. */
export function buildInlineAgentFeed(input: InlineAgentFeedInput): InlineAgentFeed {
  if (input.showProcess === false) {
    const items = appendInlineAnswerBlock([], input.answerPreview, input.answerStreaming);
    return {
      items,
      hasAnswer: resolveInlineAnswerHasContent(items),
      toolCount: 0,
      answerStreaming: input.answerStreaming,
    };
  }

  const feedItems = buildFilteredCursorAgentFeedItems(input);

  const withAnswer = appendInlineAnswerBlock(
    cursorItemsToInline(feedItems),
    input.answerPreview,
    input.answerStreaming,
  );

  const collapseOptions = resolveInlineFeedCollapseOptions(input);
  const collapsed = collapseInlineFeedItems(withAnswer, collapseOptions);
  const items = stripInlineStatusItems(collapsed, input.isRunning);

  return {
    items,
    hasAnswer: resolveInlineAnswerHasContent(items),
    toolCount: countToolsInInlineFeed(items),
    answerStreaming: input.answerStreaming,
  };
}
