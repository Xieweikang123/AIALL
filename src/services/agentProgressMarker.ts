import { sanitizeMarkdownForDisplay } from "./markdownDisplaySanitize";

export const AGENT_PROGRESS_MARKER = "<!-- agent-progress -->";
export const AGENT_PROGRESS_MARKER_RE = /<!--\s*agent-progress\s*-->/i;

export function stripAgentProgressMarker(text: string): string {
  return text.replace(AGENT_PROGRESS_MARKER_RE, "").trim();
}

export function hasAgentProgressMarker(text: string): boolean {
  return AGENT_PROGRESS_MARKER_RE.test(text);
}

/** Strip progress markers and leading HTML comments (including incomplete stream fragments). */
export function sanitizeFeedThoughtText(text: string): string {
  let result = text;
  result = result.replace(/^<!--[\s\S]*?(?:-->|$)\s*/, "");
  result = result.replace(/^<!+\s*/, "");
  return sanitizeMarkdownForDisplay(result);
}
