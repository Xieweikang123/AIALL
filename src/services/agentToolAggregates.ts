import type { AgentRoundTool } from "./agentRoundGroups";
import { formatRunCommandPreview, getRunCommandText, parseRunCommandOutputLines, getToolPath } from "../utils/toolHelpers";

export type ToolAggregateKind = "file" | "search" | "edit" | "misc";

export type ToolAggregateCard = {
  key: string;
  kind: ToolAggregateKind;
  icon: string;
  title: string;
  subtitle: string;
  running: boolean;
  failed: boolean;
  previewLines: string[];
  stepCount: number;
  path?: string;
};

const WRITE_TOOLS = new Set(["write_file", "patch_file", "delete_file"]);
const SEARCH_TOOLS = new Set(["grep", "search_files", "git_status", "git_diff"]);
const COMMAND_TOOLS = new Set(["run_command"]);

function fileNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || filePath;
}

function readRangeFromStep(step: AgentRoundTool): { start: number; end: number } | null {
  const offset = Math.max(1, Number(step.args?.offset) || 1);
  const limit = Math.max(0, Number(step.args?.limit) || 0);
  if (!limit) return null;
  return { start: offset, end: offset + limit - 1 };
}

function formatLineRanges(ranges: Array<{ start: number; end: number }>): string {
  if (!ranges.length) return "";
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  if (merged.length === 1) return `行 ${merged[0]!.start}–${merged[0]!.end}`;
  if (merged.length <= 3) {
    return merged.map((r) => `${r.start}–${r.end}`).join("、");
  }
  return `行 ${merged[0]!.start}–${merged[merged.length - 1]!.end}（${merged.length} 段）`;
}

function grepHitPreviews(step: AgentRoundTool, maxLines = 3): string[] {
  const pattern = String(step.args?.pattern ?? step.args?.query ?? "").trim();
  const raw = step.fullResult?.trim() || "";
  if (!raw || raw === "（无匹配）" || raw === "（无匹配文件）") {
    return pattern ? [`${pattern} → 无匹配`] : [];
  }
  const lines = raw.split("\n").filter(Boolean).slice(0, maxLines);
  return lines.map((line) => {
    const trimmed = line.replace(/\s+/g, " ").trim();
    const short = trimmed.length > 96 ? `${trimmed.slice(0, 96)}…` : trimmed;
    return pattern ? `${pattern} → ${short}` : short;
  });
}

function readPreviewLines(steps: AgentRoundTool[], maxLines = 4): string[] {
  const out: string[] = [];
  for (const step of steps) {
    if (out.length >= maxLines) break;
    const range = readRangeFromStep(step);
    const raw = step.fullResult?.trim();
    if (raw) {
      const firstLine = raw.split("\n").find((l) => l.trim())?.trim() || "";
      const snippet = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
      if (snippet) {
        out.push(range ? `L${range.start}  ${snippet}` : snippet);
        continue;
      }
    }
    if (range) out.push(`L${range.start}–${range.end}`);
  }
  return out;
}

function buildFileCard(path: string, steps: AgentRoundTool[]): ToolAggregateCard {
  const ranges = steps.map(readRangeFromStep).filter((r): r is { start: number; end: number } => r !== null);
  const readLabel = steps.length > 1 ? `读取 ${steps.length} 次` : "读取";
  const rangeLabel = ranges.length ? formatLineRanges(ranges) : "";
  const subtitle = [readLabel, rangeLabel].filter(Boolean).join(" · ");
  return {
    key: `file:${path}`,
    kind: "file",
    icon: "📄",
    title: fileNameFromPath(path),
    subtitle: subtitle || path,
    running: steps.some((s) => s.running),
    failed: steps.some((s) => !s.ok && !s.running),
    previewLines: readPreviewLines(steps),
    stepCount: steps.length,
    path,
  };
}

function buildSearchCard(steps: AgentRoundTool[]): ToolAggregateCard {
  const patterns = steps
    .map((s) => String(s.args?.pattern ?? s.args?.query ?? "").trim())
    .filter(Boolean);
  const uniquePatterns = [...new Set(patterns)];
  const subtitle =
    uniquePatterns.length > 0
      ? `${steps.length} 次搜索 · ${uniquePatterns.slice(0, 4).join("、")}${uniquePatterns.length > 4 ? "…" : ""}`
      : `${steps.length} 次搜索`;
  const previewLines: string[] = [];
  for (const step of steps) {
    if (previewLines.length >= 8) break;
    previewLines.push(...grepHitPreviews(step, 2));
  }
  return {
    key: "search:batch",
    kind: "search",
    icon: "🔍",
    title: "代码搜索",
    subtitle,
    running: steps.some((s) => s.running),
    failed: steps.some((s) => !s.ok && !s.running),
    previewLines: previewLines.slice(0, 8),
    stepCount: steps.length,
  };
}

function buildEditCard(path: string, steps: AgentRoundTool[]): ToolAggregateCard {
  const labels = steps.map((s) => {
    if (s.name === "delete_file") return "删除";
    if (s.name === "write_file") return "写入";
    return "修改";
  });
  const unique = [...new Set(labels)];
  return {
    key: `edit:${path}`,
    kind: "edit",
    icon: "🔧",
    title: fileNameFromPath(path),
    subtitle: unique.join(" · "),
    running: steps.some((s) => s.running),
    failed: steps.some((s) => !s.ok && !s.running),
    previewLines: steps
      .map((s) => s.summary?.trim())
      .filter(Boolean)
      .slice(0, 4) as string[],
    stepCount: steps.length,
  };
}

function commandPreviewFromStep(step: AgentRoundTool): string {
  const cmd = getRunCommandText(step.args);
  if (cmd) return formatRunCommandPreview(cmd);
  const summary = step.summary?.trim();
  if (summary) return summary;
  if (!step.ok && !step.running) return "执行失败";
  return step.label || step.name;
}

function buildCommandCard(steps: AgentRoundTool[]): ToolAggregateCard {
  const failed = steps.some((s) => !s.ok && !s.running);
  const previewLines = steps
    .map(commandPreviewFromStep)
    .filter(Boolean)
    .slice(-4);
  const singleTitle =
    steps.length === 1 ? commandPreviewFromStep(steps[0]!) : "";
  return {
    key: "command:batch",
    kind: "misc",
    icon: "▶️",
    title: singleTitle ? `$ ${singleTitle}` : "执行命令",
    subtitle:
      steps.length === 1
        ? failed
          ? "失败"
          : steps[0]?.running
            ? "运行中"
            : "完成"
        : failed
          ? `${steps.length} 次 · 有失败`
          : `${steps.length} 次`,
    running: steps.some((s) => s.running),
    failed,
    previewLines: steps.length === 1 ? parseRunCommandOutputLines(steps[0]?.fullResult ?? "", 4) : previewLines,
    stepCount: steps.length,
  };
}

function buildMiscCard(step: AgentRoundTool): ToolAggregateCard {
  const path = getToolPath(step);
  const useResultPreview = step.name !== "run_command" && step.fullResult?.trim();
  const subtitle =
    step.detail?.trim() ||
    (path !== "..." ? path : step.summary || step.label);
  return {
    key: `misc:${step.id}`,
    kind: "misc",
    icon: step.icon || "⚡",
    title: step.title || step.name,
    subtitle,
    running: Boolean(step.running),
    failed: !step.ok && !step.running,
    previewLines: useResultPreview
      ? step.fullResult!.split("\n").filter(Boolean).slice(0, 3)
      : [],
    stepCount: 1,
  };
}

type GroupRef =
  | { kind: "file"; key: string; firstIndex: number }
  | { kind: "search"; key: "search"; firstIndex: number }
  | { kind: "command"; key: "command"; firstIndex: number }
  | { kind: "edit"; key: string; firstIndex: number }
  | { kind: "misc"; key: string; firstIndex: number; stepId: string };

/** Collapse consecutive tool steps into file / search / edit aggregate cards. */
export function aggregateToolSteps(steps: AgentRoundTool[]): ToolAggregateCard[] {
  if (!steps.length) return [];

  const fileGroups = new Map<string, AgentRoundTool[]>();
  const searchSteps: AgentRoundTool[] = [];
  const commandSteps: AgentRoundTool[] = [];
  const editGroups = new Map<string, AgentRoundTool[]>();
  const miscSteps: AgentRoundTool[] = [];
  const order: GroupRef[] = [];

  steps.forEach((step, index) => {
    if (step.name === "read_file") {
      const path = getToolPath(step);
      if (!fileGroups.has(path)) {
        fileGroups.set(path, []);
        order.push({ kind: "file", key: path, firstIndex: index });
      }
      fileGroups.get(path)!.push(step);
      return;
    }
    if (SEARCH_TOOLS.has(step.name)) {
      if (!searchSteps.length) {
        order.push({ kind: "search", key: "search", firstIndex: index });
      }
      searchSteps.push(step);
      return;
    }
    if (COMMAND_TOOLS.has(step.name)) {
      if (!commandSteps.length) {
        order.push({ kind: "command", key: "command", firstIndex: index });
      }
      commandSteps.push(step);
      return;
    }
    if (WRITE_TOOLS.has(step.name)) {
      const path = getToolPath(step);
      if (!editGroups.has(path)) {
        editGroups.set(path, []);
        order.push({ kind: "edit", key: path, firstIndex: index });
      }
      editGroups.get(path)!.push(step);
      return;
    }
    order.push({ kind: "misc", key: step.id, firstIndex: index, stepId: step.id });
    miscSteps.push(step);
  });

  order.sort((a, b) => a.firstIndex - b.firstIndex);

  const miscById = new Map(miscSteps.map((s) => [s.id, s]));
  const cards: ToolAggregateCard[] = [];
  const seen = new Set<string>();

  for (const ref of order) {
    if (ref.kind === "file") {
      const groupKey = `file:${ref.key}`;
      if (seen.has(groupKey)) continue;
      seen.add(groupKey);
      const group = fileGroups.get(ref.key);
      if (group?.length) cards.push(buildFileCard(ref.key, group));
    } else if (ref.kind === "search") {
      if (seen.has("search")) continue;
      seen.add("search");
      if (searchSteps.length) cards.push(buildSearchCard(searchSteps));
    } else if (ref.kind === "command") {
      if (seen.has("command")) continue;
      seen.add("command");
      if (commandSteps.length) cards.push(buildCommandCard(commandSteps));
    } else if (ref.kind === "edit") {
      const groupKey = `edit:${ref.key}`;
      if (seen.has(groupKey)) continue;
      seen.add(groupKey);
      const group = editGroups.get(ref.key);
      if (group?.length) cards.push(buildEditCard(ref.key, group));
    } else {
      const step = miscById.get(ref.stepId);
      if (step) cards.push(buildMiscCard(step));
    }
  }

  return cards;
}

export function summarizeAggregateSteps(steps: AgentRoundTool[]): string {
  const cards = aggregateToolSteps(steps);
  if (!cards.length) return "";
  const parts = cards.map((c) => {
    if (c.kind === "file") return `读 ${c.title}`;
    if (c.kind === "search") return `搜 ${c.stepCount} 次`;
    if (c.kind === "edit") return `改 ${c.title}`;
    return c.title;
  });
  return `${steps.length} 步 · ${parts.slice(0, 4).join(" · ")}${parts.length > 4 ? "…" : ""}`;
}
