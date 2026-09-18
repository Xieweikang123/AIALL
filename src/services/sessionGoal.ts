import { isExecutionContinuation, stripQuotedReplyPrefix } from "./agentContinuation";
import { EXPLORE_CONTINUE_PRESET_PROMPT, isExploreContinuePrompt } from "./agentExplore";

/** Soft cap for the sticky session-goal strip (display + prompt injection). */
export const SESSION_GOAL_MAX_CHARS = 80;

export type ResolveSessionGoalInput = {
  prompt: string;
  existingGoal?: string;
  needsClarification?: boolean;
  /** Skip refresh for scoped execute-plan continuations that already have a goal. */
  runKind?: "interactive" | "execute_plan";
};

/**
 * Compress a user demand into one short goal line (no extra model call).
 * Clarification stays in chat; this only mirrors a clear demand on the session strip.
 */
export function compressSessionGoal(prompt: string, maxChars = SESSION_GOAL_MAX_CHARS): string {
  const body = stripQuotedReplyPrefix(prompt).replace(/\s+/g, " ").trim();
  if (!body) return "";

  const sentenceMatch = body.match(/^(.+?[。！？!?]|.+?[.!?])(?:\s|$)/);
  const candidate = (sentenceMatch?.[1] || body).trim();
  if (candidate.length <= maxChars) return candidate;
  const sliced = candidate.slice(0, maxChars - 1).trimEnd();
  const lastBreak = Math.max(sliced.lastIndexOf("，"), sliced.lastIndexOf(","), sliced.lastIndexOf(" "));
  const clipped = lastBreak >= Math.floor(maxChars * 0.45) ? sliced.slice(0, lastBreak).trimEnd() : sliced;
  return `${clipped}…`;
}

/** Whether this turn should rewrite the sticky session goal. */
export function shouldRefreshSessionGoal(input: ResolveSessionGoalInput): boolean {
  const body = stripQuotedReplyPrefix(input.prompt).trim();
  if (!body) return false;
  if (input.needsClarification) return false;
  if (isExecutionContinuation(body)) return false;
  if (isExploreContinuePrompt(body) || body === EXPLORE_CONTINUE_PRESET_PROMPT.trim()) return false;
  if (input.runKind === "execute_plan" && input.existingGoal?.trim()) return false;
  return true;
}

/**
 * Resolve the goal to persist for this turn.
 * - Unclear demand → keep existing (do not invent); chat asks for clarification.
 * - Clear demand → compress prompt into one line.
 * Returns undefined when nothing should change.
 */
export function resolveSessionGoalUpdate(input: ResolveSessionGoalInput): string | undefined {
  const existing = input.existingGoal?.trim() || "";
  if (!shouldRefreshSessionGoal(input)) {
    return undefined;
  }
  const next = compressSessionGoal(input.prompt);
  if (!next || next === existing) return undefined;
  return next;
}
