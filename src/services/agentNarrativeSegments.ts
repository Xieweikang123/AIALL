import type { AgentRoundTool } from "./agentRoundGroups";

export type NarrativeSegment = {
  text: string;
  tools: AgentRoundTool[];
};

/** Major boundaries only — paragraph breaks and markdown headers. */
const SPLIT_PATTERNS = [/\n\n+/, /\n(?=#{1,3}\s+)/];

const MERGE_SHORT_SEGMENT_MAX_CHARS = 80;

function mergeShortNarrativeSegments(segments: string[]): string[] {
  if (segments.length <= 1) return segments;

  const merged: string[] = [segments[0]!];
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const last = merged[merged.length - 1]!;
    const segmentIsHeader = /^#{1,3}\s/.test(segment);
    const canMerge =
      !segmentIsHeader &&
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

  let parts = [trimmed];
  for (const pattern of SPLIT_PATTERNS) {
    parts = parts.flatMap((part) =>
      part.split(pattern).map((segment) => segment.trim()).filter(Boolean),
    );
  }

  const merged = mergeShortNarrativeSegments(parts);
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

export function shouldCollapseRequestMessage(role: string, content: string): boolean {
  if (role === "system") return true;
  return content.length > 600;
}
