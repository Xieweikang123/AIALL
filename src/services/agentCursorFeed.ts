import type { AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";
import { buildNarrativeSegments } from "./agentNarrativeSegments";

export type CursorFeedItem =
  | { kind: "thought"; key: string; text: string }
  | { kind: "action"; key: string; step: AgentRoundTool }
  | { kind: "status"; key: string; text: string; active: boolean };

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
    if (failed) return `Read failed ${target}`;
    const lines = step.summary?.match(/(\d+)/)?.[1];
    return lines ? `Read ${target} · ${lines} lines` : `Read ${target}`;
  }

  if (step.name === "write_file") {
    const target = path || step.detail || "file";
    if (running) return `Editing ${target}`;
    if (failed) return `Edit failed ${target}`;
    const chars = content.length || step.summary?.match(/(\d+)\s*字符/)?.[1];
    return chars ? `Edited ${target} +${chars}` : `Edited ${target}`;
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

  if (step.name === "list_dir") {
    const target = path || step.detail || ".";
    if (running) return `Exploring ${target}`;
    if (failed) return `Explore failed ${target}`;
    return `Explored ${target}`;
  }

  const fallback = step.title || step.label || step.name;
  if (running) return fallback;
  if (failed) return `${fallback} failed`;
  return fallback;
}

export function cursorPlanningLabel(phase?: string, detail?: string): string | null {
  if (!phase) return "Planning next moves";

  if (phase === "waiting_model" || phase === "sending_request" || phase === "retrying_model") {
    return detail?.trim() ? `Planning next moves · ${detail.trim()}` : "Planning next moves";
  }
  if (phase === "streaming_model" || phase === "planning_tools") return "Thinking…";
  if (phase === "summarizing_tools") return "Summarizing tool results…";
  if (phase === "connecting_local" || phase === "stream_connected" || phase === "connected") {
    return "Starting…";
  }
  if (phase === "preparing" || phase === "starting" || phase === "building_context") {
    return "Preparing context…";
  }
  if (phase === "executing_tool" || phase === "executing_tools") return null;
  if (phase === "compacting_context") return null;
  return null;
}

export function buildCursorAgentFeed(input: {
  groups: AgentRoundGroupView[];
  isRunning: boolean;
  agentPhase?: string;
  agentDetail?: string;
}): CursorFeedItem[] {
  const items: CursorFeedItem[] = [];

  for (const group of input.groups) {
    if (group.turn <= 0) continue;

    const segments = buildNarrativeSegments(group.narrative, group.tools);
    for (const [index, segment] of segments.entries()) {
      if (segment.text.trim()) {
        items.push({
          kind: "thought",
          key: `thought-${group.turn}-${index}`,
          text: segment.text.trim(),
        });
      }
      for (const step of segment.tools) {
        items.push({ kind: "action", key: step.id, step });
      }
    }
  }

  if (input.isRunning) {
    const planning = cursorPlanningLabel(input.agentPhase, input.agentDetail);
    if (planning) {
      items.push({ kind: "status", key: "planning-current", text: planning, active: true });
    }
  }

  return items;
}

export function cursorActionClass(step: AgentRoundTool): string {
  if (step.running) return "running";
  if (!step.ok) return "fail";
  return "done";
}
