import {
  isAgentToolTurnNarration,
} from "./agentMessageDisplay";
import {
  computeExplorationStats,
  formatCollapsedStepsSummary,
  formatExplorationSummary,
  buildCursorAgentFeed,
  type CursorFeedItem,
} from "./agentCursorFeed";
import type { AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";
import type { UnifiedAgentTimelineInput } from "./agentCompactStatus";
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
  // Completed messages: never collapse — keep all steps visible in linear order
  return { collapseAfter: 99, keepVisible: 99, disabled: true };
}

function isProcessItem(item: InlineFeedItem): item is InlineFeedProcessItem {
  if (item.kind === "collapsed") return false;
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

/** Fold early tools when count exceeds threshold. */
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

function resolveInlineStreaming(
  items: InlineFeedItem[],
  answerStreaming: boolean,
): boolean {
  return answerStreaming || items.some(
    (item) => item.kind === "tool" && item.step.running,
  );
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
    (item): item is InlineFeedTextItem => item.kind === "text",
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

/** Single linear narrative+tools feed — no separate answer block. */
export function buildInlineAgentFeed(input: InlineAgentFeedInput): InlineAgentFeed {
  debugLog("[inlineFeed] buildInlineAgentFeed", {
    showProcess: input.showProcess,
    answerPreview: input.answerPreview.slice(0, 80),
    answerStreaming: input.answerStreaming,
    roundGroupsCount: input.roundGroups?.length,
    isRunning: input.isRunning,
  });

  if (input.showProcess === false) {
    return {
      items: [],
      hasAnswer: false,
      toolCount: 0,
      answerStreaming: input.answerStreaming,
    };
  }

  const feedItems = buildCursorAgentFeed({
    groups: input.roundGroups,
    isRunning: input.isRunning,
    agentPhase: input.agentPhase,
    agentDetail: input.agentDetail,
    answerPreview: input.answerPreview,
    streaming: input.answerStreaming,
  });

  debugLog("[inlineFeed] feedItems built", {
    feedItemCount: feedItems.length,
    kinds: feedItems.map((i) => i.kind).join(","),
  });

  const inline = cursorItemsToInline(feedItems);

  const collapseOptions = resolveInlineFeedCollapseOptions(input);
  const collapsed = collapseInlineFeedItems(inline, collapseOptions);
  const items = stripInlineStatusItems(collapsed, input.isRunning);

  return {
    items,
    hasAnswer: resolveInlineHasContent(items),
    toolCount: countToolsInInlineFeed(items),
    answerStreaming: resolveInlineStreaming(items, input.answerStreaming),
  };
}

function resolveInlineHasContent(items: InlineFeedItem[]): boolean {
  return items.some(
    (item) => item.kind === "text" && item.text.trim(),
  );
}
