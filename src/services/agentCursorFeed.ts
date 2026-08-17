import type { AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";
import { buildNarrativeSegments } from "./agentNarrativeSegments";
import { stripTextToolCallMarkup } from "./textToolCallMarkup";
import { stripToolSummaryFromAssistantContent } from "./vibeChatStorage";
import { aggregateToolSteps } from "./agentToolAggregates";
import { formatRunCommandLabel } from "../utils/toolHelpers";

export type CursorFeedItem =
  | { kind: "thought"; key: string; text: string }
  | { kind: "action"; key: string; step: AgentRoundTool }
  | { kind: "status"; key: string; text: string; active: boolean };

export type CursorFeedBlock =
  | { kind: "thought"; key: string; text: string }
  | {
      kind: "actions";
      key: string;
      visible: Extract<CursorFeedItem, { kind: "action" }>[];
      collapsed: Extract<CursorFeedItem, { kind: "action" }>[];
    }
  | { kind: "status"; key: string; text: string; active: boolean }
  | { kind: "answer"; key: string; text: string; streaming: boolean };

export type CursorFeedProcessBlock = Exclude<CursorFeedBlock, { kind: "answer" }>;

export type CursorAgentTimeline = {
  /** Chronological feed: thoughts, tools, status, then answer. */
  blocks: CursorFeedBlock[];
  processBlocks: CursorFeedProcessBlock[];
  answer: { text: string; streaming: boolean } | null;
};

const DEFAULT_KEEP_VISIBLE = 3;
const DEFAULT_COLLAPSE_AFTER = 3;
const COMPACT_FEED_MIN_STEPS = 3;
const COMPACT_RECENT_VISIBLE = 3;

export type AgentExplorationStats = {
  reads: number;
  searches: number;
  explores: number;
  edits: number;
  total: number;
};

const EXPLORATION_TOOL_NAMES = new Set(["read_file", "grep", "search_files", "list_dir"]);

export function computeExplorationStats(steps: AgentRoundTool[]): AgentExplorationStats {
  const stats: AgentExplorationStats = {
    reads: 0,
    searches: 0,
    explores: 0,
    edits: 0,
    total: steps.length,
  };
  for (const step of steps) {
    if (step.name === "read_file") stats.reads += 1;
    else if (step.name === "grep" || step.name === "search_files") stats.searches += 1;
    else if (step.name === "list_dir") stats.explores += 1;
    else if (step.name === "write_file" || step.name === "patch_file" || step.name === "delete_file") stats.edits += 1;
  }
  return stats;
}

export function formatExplorationSummary(stats: AgentExplorationStats, running = false): string {
  const parts: string[] = [];
  if (stats.reads) parts.push(`读 ${stats.reads} 个文件`);
  if (stats.searches) parts.push(`搜索 ${stats.searches} 次`);
  if (stats.explores) parts.push(`浏览 ${stats.explores} 个目录`);
  if (stats.edits) parts.push(`修改 ${stats.edits} 处`);
  if (!parts.length) return running ? "准备中…" : "无工具步骤";
  const body = parts.join(" · ");
  return running ? `探索代码库 · ${body}` : `已完成 · ${body}`;
}

export type AgentExplorationProgressView = {
  summary: string;
  detail?: string;
  activeTool?: string;
};

function formatActiveToolLabel(step: AgentRoundTool): string {
  const detail = step.detail?.trim();
  if (detail) return `${step.title} · ${detail}`;
  return step.title || step.label || step.name;
}

/** User-facing progress while Agent explores without a final answer yet. */
export function buildAgentExplorationProgress(input: {
  tools?: AgentRoundTool[];
  agentTurn?: number;
  agentMaxTurns?: number;
  isRunning: boolean;
}): AgentExplorationProgressView | null {
  if (!input.isRunning) return null;

  const tools = input.tools ?? [];
  const runningTool = tools.find((step) => step.running);
  const completedTools = tools.filter((step) => !step.running);
  if (!runningTool && completedTools.length === 0) return null;

  const stats = computeExplorationStats(tools);
  const summary = formatExplorationSummary(stats, true);
  const detail =
    input.agentTurn && input.agentMaxTurns
      ? `第 ${input.agentTurn}/${input.agentMaxTurns} 轮`
      : input.agentTurn
        ? `第 ${input.agentTurn} 轮`
        : undefined;
  const activeTool = runningTool
    ? formatActiveToolLabel(runningTool)
    : completedTools.length
      ? formatActiveToolLabel(completedTools[completedTools.length - 1]!)
      : undefined;

  return { summary, detail, activeTool };
}

export type AgentExplorationTimelineChip = {
  key: string;
  label: string;
  kind: "file" | "search" | "edit" | "misc";
  path?: string;
};

/** Compact horizontal chips summarizing exploration steps for the process header. */
export function buildAgentExplorationTimeline(
  tools: AgentRoundTool[] | undefined,
  maxChips = 8,
): AgentExplorationTimelineChip[] {
  const steps = tools ?? [];
  if (steps.length < 2) return [];

  const cards = aggregateToolSteps(steps);
  return cards.slice(-maxChips).map((card) => ({
    key: card.key,
    kind: card.kind,
    path: card.path,
    label:
      card.kind === "file"
        ? card.stepCount > 1
          ? `${card.title} ×${card.stepCount}`
          : card.title
        : card.kind === "search"
          ? `搜索 ×${card.stepCount}`
          : card.kind === "edit"
            ? `改 ${card.title}`
            : card.title,
  }));
}

export function formatCollapsedStepsSummary(steps: AgentRoundTool[]): string {
  const stats = computeExplorationStats(steps);
  if (stats.total <= 1) return `更早的 ${stats.total} 步`;
  const summary = formatExplorationSummary(stats, false);
  return `更早的 ${stats.total} 步（${summary.replace(/^已完成 · /, "")}）`;
}

export function shouldUseCompactAgentFeed(stepCount: number, isRunning: boolean, showDetailed: boolean): boolean {
  return isRunning && stepCount >= COMPACT_FEED_MIN_STEPS && !showDetailed;
}

export function getLatestFeedThought(items: CursorFeedItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "thought" && item.text.trim()) return item.text.trim();
  }
  return null;
}

export function getRunningFeedAction(items: CursorFeedItem[]): Extract<CursorFeedItem, { kind: "action" }> | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "action" && item.step.running) return item;
  }
  return null;
}

export function getLatestFeedStatus(items: CursorFeedItem[]): Extract<CursorFeedItem, { kind: "status" }> | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "status") return item;
  }
  return null;
}

export function getRecentFeedActions(
  items: CursorFeedItem[],
  maxVisible = COMPACT_RECENT_VISIBLE,
): { recent: Extract<CursorFeedItem, { kind: "action" }>[]; hiddenCount: number } {
  const actions = items.filter(
    (item): item is Extract<CursorFeedItem, { kind: "action" }> => item.kind === "action",
  );
  const hiddenCount = Math.max(0, actions.length - maxVisible);
  return { recent: actions.slice(-maxVisible), hiddenCount };
}

export function layoutCursorFeedBlocks(
  items: CursorFeedItem[],
  options?: { keepVisible?: number; collapseAfter?: number; compactWhileRunning?: boolean },
): CursorFeedProcessBlock[] {
  const keepVisible = options?.keepVisible ?? DEFAULT_KEEP_VISIBLE;
  const collapseAfter = options?.collapseAfter ?? DEFAULT_COLLAPSE_AFTER;
  const blocks: CursorFeedProcessBlock[] = [];
  let actionBatch: Extract<CursorFeedItem, { kind: "action" }>[] = [];
  let batchIndex = 0;

  const flushActions = () => {
    if (!actionBatch.length) return;
    const shouldCollapse = actionBatch.length > collapseAfter;
    const visible = shouldCollapse ? actionBatch.slice(-keepVisible) : actionBatch;
    const collapsed = shouldCollapse ? actionBatch.slice(0, actionBatch.length - keepVisible) : [];
    blocks.push({
      kind: "actions",
      key: `actions-${batchIndex}`,
      visible,
      collapsed,
    });
    actionBatch = [];
    batchIndex += 1;
  };

  for (const item of items) {
    if (item.kind === "action") {
      actionBatch.push(item);
      continue;
    }
    flushActions();
    if (item.kind === "thought") {
      blocks.push({ kind: "thought", key: item.key, text: item.text });
    } else if (item.kind === "status") {
      blocks.push({ kind: "status", key: item.key, text: item.text, active: item.active });
    }
  }
  flushActions();
  return blocks;
}

export function buildCursorAgentTimeline(
  items: CursorFeedItem[],
  answerText: string,
  options?: {
    keepVisible?: number;
    collapseAfter?: number;
    compactWhileRunning?: boolean;
    streaming?: boolean;
  },
): CursorAgentTimeline {
  const processBlocks = layoutCursorFeedBlocks(items, options);
  const trimmed = answerText.trim();
  const streaming = options?.streaming ?? false;
  const answer = trimmed
    ? { text: trimmed, streaming }
    : streaming
      ? { text: "", streaming: true }
      : null;
  const answerBlock: CursorFeedBlock[] = answer
    ? [{ kind: "answer", key: "timeline-answer", text: answer.text, streaming: answer.streaming }]
    : [];
  return {
    blocks: [...processBlocks, ...answerBlock],
    processBlocks,
    answer,
  };
}

export function computeLineDelta(before: string, after: string, created?: boolean): number {
  const beforeLines = before ? before.split(/\r?\n/).length : 0;
  const afterLines = after ? after.split(/\r?\n/).length : 0;
  if (created || !before) return Math.max(afterLines, 1);
  return Math.max(Math.abs(afterLines - beforeLines), 1);
}

/** read_file blocked by overlap / duplicate-slice policy — not a disk or IO failure. */
export function isReadFilePolicyBlock(summary: string | undefined): boolean {
  const text = summary?.trim() ?? "";
  if (!text) return false;
  return /高度重叠|相同片段|勿重复读|重复读相同|省略重复读取|已连续\s*\d+\s*次读取相同片段/.test(text);
}

export function formatCursorActionLabel(step: AgentRoundTool): string {
  const path = String(step.args?.path ?? step.detail.split(" · ")[0] ?? "").trim();
  const pattern = String(step.args?.pattern ?? "").trim();
  const query = String(step.args?.query ?? "").trim();
  const content = typeof step.args?.content === "string" ? step.args.content : "";
  const running = Boolean(step.running);
  const failed = !step.ok && !step.running;

  if (step.name === "read_file") {
    const target = path || step.detail || "file";
    if (running) return `Reading ${target}`;
    if (failed) {
      return isReadFilePolicyBlock(step.summary)
        ? `Skipped duplicate read ${target}`
        : `Read failed ${target}`;
    }
    const lines = step.summary?.match(/(\d+)/)?.[1];
    return lines ? `Read ${target} · ${lines} lines` : `Read ${target}`;
  }

  if (step.name === "write_file" || step.name === "patch_file") {
    const target = path || step.detail || "file";
    if (running) return `Editing ${target}`;
    if (failed) return `Edit failed ${target}`;
    const delta = step.lineDelta ?? (content ? Math.min(content.split(/\r?\n/).length, 999) : 0);
    return delta ? `Edited ${target} +${delta}` : `Edited ${target}`;
  }

  if (step.name === "delete_file") {
    const target = path || step.detail || "file";
    if (running) return `Deleting ${target}`;
    if (failed) return `Delete failed ${target}`;
    return `Deleted ${target}`;
  }

  if (step.name === "grep") {
    const target = pattern || step.detail || "pattern";
    if (running) return `Searching ${target}`;
    if (failed) return `Search failed ${target}`;
    return `Searched ${target}`;
  }

  if (step.name === "search_files") {
    const target = query || step.detail || "files";
    if (running) return `Searching files ${target}`;
    if (failed) return `File search failed ${target}`;
    return `Searched files ${target}`;
  }

  if (step.name === "search_symbols") {
    const target = query || step.detail || "symbols";
    if (running) return `Searching symbols ${target}`;
    if (failed) return `Symbol search failed ${target}`;
    return `Searched symbols ${target}`;
  }

  if (step.name === "list_dir") {
    const target = path || step.detail || ".";
    if (running) return `Exploring ${target}`;
    if (failed) return `Explore failed ${target}`;
    return `Explored ${target}`;
  }

  if (step.name === "web_search") {
    const target = query || step.detail || "query";
    if (running) return `Searching web ${target}`;
    if (failed) return `Web search failed ${target}`;
    return `Searched web ${target}`;
  }

  if (step.name === "web_extract") {
    const url = String(step.args?.url ?? step.detail ?? "").trim();
    const target = url.length > 48 ? `${url.slice(0, 48)}…` : url || "url";
    if (running) return `Fetching ${target}`;
    if (failed) return `Fetch failed ${target}`;
    return `Fetched ${target}`;
  }

  if (step.name === "run_command") {
    const { preview } = formatRunCommandLabel(step.args, step.detail);
    const display = `$ ${preview}`;
    if (running) return display;
    if (failed) return `${display} · 失败`;
    return display;
  }

  const fallback = step.title || step.label || step.name;
  if (running) return fallback;
  if (failed) return `${fallback} failed`;
  return fallback;
}

export function cursorPlanningLabel(phase?: string, detail?: string): string | null {
  if (!phase) return null;

  if (phase === "waiting_model" || phase === "sending_request" || phase === "retrying_model") {
    if (detail?.trim()) return `整合信息中 · ${detail.trim()}`;
    return "整合信息中…";
  }
  if (phase === "streaming_model" || phase === "planning_tools") return "思考中…";
  if (phase === "summarizing_tools") return "整理工具结果…";
  if (phase === "executing_tool" || phase === "executing_tools") return "执行中…";
  if (phase === "compacting_context") return "压缩上下文…";
  if (phase === "connecting_local") {
    return detail?.trim() ? `连接本地服务 · ${detail.trim()}` : "连接本地服务…";
  }
  if (phase === "stream_connected" || phase === "connected") {
    return detail?.trim() ? `启动 Agent · ${detail.trim()}` : "启动 Agent…";
  }
  if (phase === "reconnecting") return "正在重连…";
  if (phase === "preparing" || phase === "starting" || phase === "building_context") {
    return detail?.trim() ? `准备上下文 · ${detail.trim()}` : "准备上下文…";
  }
  return null;
}

/** Never hide idle planning rows — keep all statuses visible for real-time feedback. */
export function shouldSuppressFeedPlanningStatus(_input: {
  agentPhase?: string;
  answerPreview?: string;
  streaming?: boolean;
}): boolean {
  return false;
}

export function buildCursorAgentFeed(input: {
  groups: AgentRoundGroupView[];
  isRunning: boolean;
  agentPhase?: string;
  agentDetail?: string;
  answerPreview?: string;
  streaming?: boolean;
}): CursorFeedItem[] {
  const items: CursorFeedItem[] = [];

  for (const group of input.groups) {
    if (group.turn <= 0) continue;

    const narrativeText = group.narrative || group.response?.assistantText || "";
    const segments = buildNarrativeSegments(narrativeText, group.tools);
    for (const [index, segment] of segments.entries()) {
      const thoughtText = stripToolSummaryFromAssistantContent(
        stripTextToolCallMarkup(segment.text.trim()),
      );
      if (thoughtText) {
        items.push({
          kind: "thought",
          key: `thought-${group.turn}-${index}`,
          text: thoughtText,
        });
      }
      for (const step of segment.tools) {
        items.push({ kind: "action", key: step.id, step });
      }
    }
  }

  if (input.isRunning) {
    const hasRunningTool = input.groups.some((group) => group.tools.some((tool) => tool.running));
    const suppressPlanning = shouldSuppressFeedPlanningStatus({
      agentPhase: input.agentPhase,
      answerPreview: input.answerPreview,
      streaming: input.streaming,
    });
    const planning =
      hasRunningTool || suppressPlanning ? null : cursorPlanningLabel(input.agentPhase, input.agentDetail);
    if (planning) {
      items.push({ kind: "status", key: "planning-current", text: planning, active: true });
    }
  }

  return items;
}

export function cursorActionClass(step: AgentRoundTool): string {
  if (step.running) return "running";
  if (!step.ok) {
    return step.name === "read_file" && isReadFilePolicyBlock(step.summary) ? "skipped" : "fail";
  }
  return "done";
}
