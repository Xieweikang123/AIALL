import type { AgentRoundTool } from "./agentRoundGroups";
import {
  aggregateToolSteps,
  type ToolAggregateCard,
} from "./agentToolAggregates";
import {
  computeExplorationStats,
  formatCollapsedStepsSummary,
  formatExplorationSummary,
  type CursorFeedBlock,
} from "./agentCursorFeed";
import { isAgentToolTurnNarration, thoughtDuplicatesBubble } from "./agentMessageDisplay";
import { sanitizeFeedThoughtText } from "./agentProgressMarker";
import { getToolPath } from "../utils/toolHelpers";

export type TimelineNodeStatus = "running" | "ok" | "fail";

export type TimelineChip = {
  key: string;
  label: string;
  path?: string;
  title?: string;
};

export type TimelineNode = {
  key: string;
  kind: "explore" | "read" | "search" | "edit" | "command" | "misc";
  icon: string;
  title: string;
  subtitle?: string;
  status: TimelineNodeStatus;
  chips: TimelineChip[];
  previewLines: string[];
  expandable: boolean;
};

export type TimelineThoughtEntry = {
  kind: "thought";
  key: string;
  text: string;
};

export type TimelineCollapsedEntry = {
  kind: "collapsed";
  key: string;
  summary: string;
  nodes: TimelineNode[];
};

export type TimelineNodeEntry = {
  kind: "node";
  key: string;
  node: TimelineNode;
};

export type TimelineAnswerEntry = {
  kind: "answer";
  key: string;
  text: string;
  streaming: boolean;
};

export type TimelineRenderEntry =
  | TimelineThoughtEntry
  | TimelineCollapsedEntry
  | TimelineNodeEntry
  | TimelineAnswerEntry;

export type TimelineFeedView = {
  entries: TimelineRenderEntry[];
  toolEntries: Array<TimelineNodeEntry | TimelineCollapsedEntry>;
  thoughtEntries: TimelineThoughtEntry[];
  answerEntries: TimelineAnswerEntry[];
  actionSteps: AgentRoundTool[];
};

type StepCategory = "explore" | "read" | "search" | "edit" | "command" | "misc";

const SEARCH_TOOLS = new Set(["grep", "search_files"]);
const WRITE_TOOLS = new Set(["write_file", "patch_file", "delete_file"]);

function stepCategory(name: string): StepCategory {
  if (name === "list_dir") return "explore";
  if (name === "read_file") return "read";
  if (SEARCH_TOOLS.has(name)) return "search";
  if (WRITE_TOOLS.has(name)) return "edit";
  if (name === "run_command") return "command";
  return "misc";
}

function fileNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || filePath;
}

const BREADCRUMB_TAIL_SEGMENTS = 4;

function formatPathSegment(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= BREADCRUMB_TAIL_SEGMENTS) return parts.join("/");
  return `…/${parts.slice(-BREADCRUMB_TAIL_SEGMENTS).join("/")}`;
}

export function deriveTimelineNodeStatus(steps: AgentRoundTool[]): TimelineNodeStatus {
  if (steps.some((step) => step.running)) return "running";
  if (steps.some((step) => !step.ok && !step.running)) return "fail";
  return "ok";
}

function cardToChips(cards: ToolAggregateCard[]): TimelineChip[] {
  const chips: TimelineChip[] = [];
  for (const card of cards) {
    if (card.kind === "file" || card.kind === "edit") {
      chips.push({
        key: card.key,
        label: card.stepCount > 1 ? `${card.title} ×${card.stepCount}` : card.title,
        path: card.path,
        title: card.path || card.subtitle,
      });
      continue;
    }
    if (card.kind === "search") {
      const patterns = card.subtitle
        .replace(/^\d+ 次搜索 · ?/, "")
        .split("、")
        .map((part) => part.trim())
        .filter(Boolean);
      if (patterns.length) {
        for (const [index, pattern] of patterns.entries()) {
          chips.push({
            key: `${card.key}:${index}:${pattern}`,
            label: pattern.replace(/…$/, ""),
            title: pattern,
          });
        }
      } else {
        chips.push({
          key: card.key,
          label: `${card.stepCount} 次`,
          title: card.subtitle,
        });
      }
      continue;
    }
    chips.push({
      key: card.key,
      label: card.title,
      title: card.subtitle,
    });
  }
  return chips;
}

function buildExploreNode(steps: AgentRoundTool[]): TimelineNode {
  const status = deriveTimelineNodeStatus(steps);
  const chips = steps.map((step, index) => {
    const path = getToolPath(step);
    return {
      key: `dir-${index}-${path}`,
      label: formatPathSegment(path),
      title: path,
    };
  });
  const count = steps.length;
  return {
    key: `explore:${steps[0]?.id ?? "batch"}`,
    kind: "explore",
    icon: "📁",
    title: count > 1 ? `浏览目录 · ${count} 级` : "浏览目录",
    subtitle: chips[chips.length - 1]?.title,
    status,
    chips,
    previewLines: [],
    expandable: false,
  };
}

function buildNodeFromCards(
  kind: TimelineNode["kind"],
  icon: string,
  title: string,
  steps: AgentRoundTool[],
  cards: ToolAggregateCard[],
): TimelineNode {
  const status = deriveTimelineNodeStatus(steps);
  const previewLines = cards.flatMap((card) => card.previewLines).slice(0, 8);
  const subtitle =
    cards.length === 1
      ? cards[0]?.subtitle
      : cards.map((card) => card.title).slice(0, 3).join("、") +
        (cards.length > 3 ? "…" : "");
  return {
    key: `${kind}:${steps[0]?.id ?? "batch"}`,
    kind,
    icon,
    title,
    subtitle,
    status,
    chips: cardToChips(cards),
    previewLines,
    expandable: previewLines.length > 0,
  };
}

function buildNodeFromGroup(category: StepCategory, steps: AgentRoundTool[]): TimelineNode | null {
  if (!steps.length) return null;

  if (category === "explore") {
    return buildExploreNode(steps);
  }

  const cards = aggregateToolSteps(steps);
  if (!cards.length) return null;

  switch (category) {
    case "read":
      return buildNodeFromCards(
        "read",
        "📄",
        cards.length > 1 ? `读取 · ${cards.length} 个文件` : "读取",
        steps,
        cards,
      );
    case "search":
      return buildNodeFromCards(
        "search",
        "🔍",
        cards[0]?.stepCount && cards[0].stepCount > 1 ? `代码搜索 · ${cards[0].stepCount} 次` : "代码搜索",
        steps,
        cards,
      );
    case "edit":
      return buildNodeFromCards(
        "edit",
        "🔧",
        cards.length > 1 ? `修改 · ${cards.length} 个文件` : "修改",
        steps,
        cards,
      );
    case "command":
      return buildNodeFromCards("command", "▶️", "执行命令", steps, cards);
    default:
      return buildNodeFromCards("misc", cards[0]?.icon || "⚡", cards[0]?.title || "工具", steps, cards);
  }
}

/** Group consecutive tool steps by category and map to timeline nodes. */
export function buildTimelineNodesFromSteps(steps: AgentRoundTool[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  let index = 0;

  while (index < steps.length) {
    const category = stepCategory(steps[index]!.name);
    const group: AgentRoundTool[] = [];
    while (index < steps.length && stepCategory(steps[index]!.name) === category) {
      group.push(steps[index]!);
      index += 1;
    }
    const node = buildNodeFromGroup(category, group);
    if (node) nodes.push(node);
  }

  return nodes;
}

export function buildCollapsedTimelineEntry(
  key: string,
  steps: AgentRoundTool[],
): TimelineCollapsedEntry | null {
  if (!steps.length) return null;
  const summary = formatCollapsedStepsSummary(steps);
  return {
    kind: "collapsed",
    key,
    summary,
    nodes: buildTimelineNodesFromSteps(steps),
  };
}

export function collectTimelineStepsFromBlocks(blocks: CursorFeedBlock[]): AgentRoundTool[] {
  const steps: AgentRoundTool[] = [];
  for (const block of blocks) {
    if (block.kind !== "actions") continue;
    for (const item of block.collapsed) steps.push(item.step);
    for (const item of block.visible) steps.push(item.step);
  }
  return steps;
}

export function shouldCollapseTimelineProcess(input: {
  activityDetailed?: boolean;
  hasAnswer: boolean;
  toolCount: number;
}): boolean {
  return Boolean(input.hasAnswer && input.toolCount > 0 && !input.activityDetailed);
}

export function buildTimelineProcessSummaryFromSteps(steps: AgentRoundTool[]): string {
  if (!steps.length) return "探索过程";
  const stats = computeExplorationStats(steps);
  const detail = formatExplorationSummary(stats, false).replace(/^已完成 · /, "");
  return detail ? `探索过程 · ${detail}` : `探索过程 · ${stats.total} 步`;
}

export function buildTimelineProcessSummary(blocks: CursorFeedBlock[]): string {
  return buildTimelineProcessSummaryFromSteps(collectTimelineStepsFromBlocks(blocks));
}

/** Visible thought rows for the timeline — filters narration and optionally keeps only the latest while running. */
export function selectVisibleTimelineThoughts(
  entries: TimelineThoughtEntry[],
  options: {
    showThoughts: boolean;
    isRunning: boolean;
    hasAnswer: boolean;
    answerText?: string;
  },
): TimelineThoughtEntry[] {
  if (!options.showThoughts || options.hasAnswer) return [];

  const answerText = options.answerText?.trim() ?? "";
  const visible = entries.filter((entry) => {
    const sanitized = sanitizeFeedThoughtText(entry.text);
    if (!sanitized || isAgentToolTurnNarration(entry.text)) return false;
    if (answerText && thoughtDuplicatesBubble(entry.text, answerText)) return false;
    return true;
  });

  if (options.isRunning && visible.length > 1) {
    return [visible[visible.length - 1]!];
  }
  return visible;
}

export function buildTimelineFeedFromBlocks(blocks: CursorFeedBlock[]): TimelineFeedView {
  const view: TimelineFeedView = {
    entries: [],
    toolEntries: [],
    thoughtEntries: [],
    answerEntries: [],
    actionSteps: [],
  };

  for (const block of blocks) {
    if (block.kind === "thought") {
      const entry: TimelineThoughtEntry = { kind: "thought", key: block.key, text: block.text };
      view.entries.push(entry);
      view.thoughtEntries.push(entry);
      continue;
    }

    if (block.kind === "actions") {
      for (const item of block.collapsed) view.actionSteps.push(item.step);
      for (const item of block.visible) view.actionSteps.push(item.step);
      if (block.collapsed.length) {
        const collapsed = buildCollapsedTimelineEntry(
          `${block.key}-collapsed`,
          block.collapsed.map((item) => item.step),
        );
        if (collapsed) {
          view.entries.push(collapsed);
          view.toolEntries.push(collapsed);
        }
      }
      for (const node of buildTimelineNodesFromSteps(block.visible.map((item) => item.step))) {
        const entry: TimelineNodeEntry = { kind: "node", key: node.key, node };
        view.entries.push(entry);
        view.toolEntries.push(entry);
      }
      continue;
    }

    if (block.kind === "answer") {
      const entry: TimelineAnswerEntry = {
        kind: "answer",
        key: block.key,
        text: block.text,
        streaming: block.streaming,
      };
      view.entries.push(entry);
      view.answerEntries.push(entry);
    }
  }

  return view;
}

export function buildTimelineEntriesFromBlocks(blocks: CursorFeedBlock[]): TimelineRenderEntry[] {
  return buildTimelineFeedFromBlocks(blocks).entries;
}

export { fileNameFromPath, formatPathSegment };
