import type { AgentRoundTool } from "./agentRoundGroups";

export type NarrativeSegment = {
  text: string;
  tools: AgentRoundTool[];
};

/** A standalone horizontal-rule line (`---` / `***` / `___`). */
function isHorizontalRuleSegment(text: string): boolean {
  return /^[-*_]{3,}\s*$/.test(text.trim());
}

/** A line that opens or closes a fenced code block (``` optionally with a language). */
function isFenceBoundaryLine(line: string): boolean {
  return /^\s*```/.test(line);
}

/** Split at blank-line / heading boundaries but never inside fenced code blocks. */
function splitFenceAware(
  source: string,
  isBoundary: (line: string) => boolean,
): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const flush = () => {
    const part = current.join("\n").trim();
    if (part) parts.push(part);
    current = [];
  };

  for (const line of source.split("\n")) {
    if (isFenceBoundaryLine(line)) inFence = !inFence;
    if (!inFence && isBoundary(line)) {
      flush();
      // Heading boundary lines begin the next part; blank separators are dropped.
      if (isHeadingLine(line)) current.push(line);
    } else {
      current.push(line);
    }
  }
  flush();
  return parts;
}

/** True when the segment carries any fenced code block — never space-merge such segments. */
function hasFenceMarkers(text: string): boolean {
  return /^\s*```/m.test(text);
}

/** Does the line begin a markdown heading (1-3 `#`)? */
function isHeadingLine(line: string): boolean {
  return /^#{1,3}\s+/.test(line.trim());
}

/** Is the line blank (paragraph separator)? */
function isBlankLine(line: string): boolean {
  return !line.trim();
}

const MERGE_SHORT_SEGMENT_MAX_CHARS = 80;

function extractLeadingHeader(text: string): string | null {
  const match = text.trim().match(/^(#{1,3}\s+.+?)(?:\n|$)/);
  return match?.[1]?.trim() ?? null;
}

/** Merge consecutive segments that repeat the same markdown heading (common while streaming). */
function mergeDuplicateHeaderSegments(segments: string[]): string[] {
  if (segments.length <= 1) return segments;

  const merged: string[] = [segments[0]!];
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const header = extractLeadingHeader(segment);
    const last = merged[merged.length - 1]!;
    if (header && extractLeadingHeader(last) === header) {
      const body = segment.replace(/^#{1,3}\s+.+?(?:\n|$)/, "").trim();
      merged[merged.length - 1] = body ? `${last}\n\n${body}` : last;
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function mergeShortNarrativeSegments(segments: string[]): string[] {
  if (segments.length <= 1) return segments;

  const merged: string[] = [segments[0]!];
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const last = merged[merged.length - 1]!;
    const segmentIsHeader = isHeadingLine(segment);
    const segmentIsHr = isHorizontalRuleSegment(segment);
    const canMerge =
      !segmentIsHeader &&
      !segmentIsHr &&
      !hasFenceMarkers(segment) &&
      !hasFenceMarkers(last) &&
      segment.length < MERGE_SHORT_SEGMENT_MAX_CHARS &&
      last.length < MERGE_SHORT_SEGMENT_MAX_CHARS;
    if (canMerge) {
      merged[merged.length - 1] = `${last} ${segment}`.trim();
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

export function splitAssistantNarrative(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Split at paragraph / heading boundaries, but never inside fenced code blocks —
  // code blocks contain blank lines (e.g. separate SCSS rules) and headings that
  // must stay inside the fence, otherwise fragments render as plain text.
  let parts = splitFenceAware(trimmed, isBlankLine);
  parts = parts.flatMap((part) => splitFenceAware(part, isHeadingLine));
  // Standalone horizontal-rule lines are structural separators, not narrative —
  // dropping them keeps the process feed clean and avoids merging them into prose.
  parts = parts.filter((part) => !isHorizontalRuleSegment(part));

  const merged = mergeShortNarrativeSegments(mergeDuplicateHeaderSegments(parts));
  return merged.length ? merged : [trimmed];
}

export function assignToolsToNarrativeSegments(
  segments: string[],
  tools: AgentRoundTool[],
): NarrativeSegment[] {
  if (!segments.length) {
    return tools.length ? [{ text: "", tools: [...tools] }] : [];
  }

  if (!tools.length) {
    return segments.map((text) => ({ text, tools: [] }));
  }

  if (segments.length === tools.length) {
    return segments.map((text, index) => ({ text, tools: [tools[index]] }));
  }

  const result: NarrativeSegment[] = segments.map((text) => ({ text, tools: [] }));
  let toolIdx = 0;
  for (let si = 0; si < result.length && toolIdx < tools.length; si += 1) {
    const remainingSegments = result.length - si;
    const remainingTools = tools.length - toolIdx;
    const count = Math.max(1, Math.ceil(remainingTools / remainingSegments));
    result[si].tools = tools.slice(toolIdx, toolIdx + count);
    toolIdx += count;
  }

  if (toolIdx < tools.length) {
    result[result.length - 1].tools.push(...tools.slice(toolIdx));
  }

  return result;
}

export function buildNarrativeSegments(narrative: string | undefined, tools: AgentRoundTool[]): NarrativeSegment[] {
  const segments = splitAssistantNarrative(narrative || "");
  if (segments.length) return assignToolsToNarrativeSegments(segments, tools);
  if (tools.length) return [{ text: "", tools: [...tools] }];
  return [];
}

export function messagePreviewLength(content: string): string {
  const len = content.length;
  if (len >= 10_000) return `${(len / 10_000).toFixed(1)} 万字符`;
  if (len >= 1000) return `${(len / 1000).toFixed(1)}k 字符`;
  return `${len} 字符`;
}
