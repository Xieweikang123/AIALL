export const AGENT_PROGRESS_MARKER = "<!-- agent-progress -->";
export const AGENT_PROGRESS_MARKER_RE = /<!--\s*agent-progress\s*-->/i;

export function stripAgentProgressMarker(text: string): string {
  return text.replace(AGENT_PROGRESS_MARKER_RE, "").trim();
}

export function hasAgentProgressMarker(text: string): boolean {
  return AGENT_PROGRESS_MARKER_RE.test(text);
}
