import type { VibeAgentSseEvent } from "./vibeAgentClient";

/** SSE event types that indicate agent run progress (for stall detection). */
export const AGENT_SSE_PROGRESS_EVENT_TYPES = [
  "status",
  "turn_request",
  "turn_response",
  "turn_trace",
  "tool_start",
  "tool_end",
  "file_diff",
  "message_delta",
  "message",
  "agent_context",
  "error",
] as const satisfies readonly VibeAgentSseEvent["type"][];

const progressEventSet = new Set<string>(AGENT_SSE_PROGRESS_EVENT_TYPES);

export function isAgentSseProgressEvent(type: VibeAgentSseEvent["type"]): boolean {
  return progressEventSet.has(type);
}
