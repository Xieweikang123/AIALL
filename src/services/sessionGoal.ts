import { isExecutionContinuation, stripQuotedReplyPrefix } from "./agentContinuation";
import { EXPLORE_CONTINUE_PRESET_PROMPT, isExploreContinuePrompt } from "./agentExplore";

/**
 * Soft cap for the sticky session-goal strip (display + prompt injection).
 * Holds the intent-classifier understanding line (or a rare prompt-compress fallback).
 */
export const SESSION_GOAL_MAX_CHARS = 240;

export type ResolveSessionGoalInput = {
  prompt: string;
  existingGoal?: string;
  needsClarification?: boolean;
  /** Skip refresh for scoped execute-plan continuations that already have a goal. */
  runKind?: "interactive" | "execute_plan";
  /**
   * Model paraphrase from the intent classifier. Preferred source for the sticky
   * strip — not a verbatim copy of the user prompt.
   */
  understanding?: string;
};

const RESUME_PROMPT_HEAD_RE = /^【自动续跑】|^【方案执行】/;
const RESUME_INTERRUPT_HINT_RE = /上次运行因连接中断而暂停/;

/** System resume / automation prompts must never become the sticky goal. */
export function isSystemResumeOrAutomationPrompt(prompt: string): boolean {
  const body = stripQuotedReplyPrefix(prompt).trim();
  if (!body) return false;
  if (RESUME_PROMPT_HEAD_RE.test(body)) return true;
  // Consultative resume headers omit 【自动续跑】 but still carry this interrupt line.
  return RESUME_INTERRUPT_HINT_RE.test(body.slice(0, 240));
}

/**
 * Fallback compress when the classifier did not return understanding.
 * Prefer resolveSessionGoalUpdate with `understanding` in the normal path.
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

export function isTruncatedSessionGoal(goal: string): boolean {
  return /…$/.test(goal.trim());
}

function clampSessionGoal(text: string, maxChars = SESSION_GOAL_MAX_CHARS): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Rebuild a goal that was clipped under an older, shorter cap from the latest
 * clear user demand in the transcript. Returns undefined when nothing to repair.
 */
export function repairTruncatedSessionGoal(input: {
  existingGoal: string;
  userPrompts: string[];
}): string | undefined {
  const existing = input.existingGoal.trim();
  if (!isTruncatedSessionGoal(existing)) return undefined;
  const stem = existing.replace(/…$/, "").trim();

  for (let i = input.userPrompts.length - 1; i >= 0; i -= 1) {
    const prompt = input.userPrompts[i] ?? "";
    if (!shouldRefreshSessionGoal({ prompt, existingGoal: existing })) continue;
    const next = compressSessionGoal(prompt);
    if (!next || next === existing) continue;
    // Same demand only — stem must be a prefix of the rebuilt goal.
    if (stem.length >= 4 && !next.startsWith(stem)) continue;
    return next;
  }
  return undefined;
}

/** Whether this turn should rewrite the sticky session goal. */
export function shouldRefreshSessionGoal(input: ResolveSessionGoalInput): boolean {
  const body = stripQuotedReplyPrefix(input.prompt).trim();
  if (!body) return false;
  if (isSystemResumeOrAutomationPrompt(body)) return false;
  // Ambiguous demand: only refresh when the classifier produced an understanding
  // line (e.g. 「意图不清：…」) so the user can verify the misread.
  if (input.needsClarification && !input.understanding?.trim()) return false;
  if (isExecutionContinuation(body)) return false;
  if (isExploreContinuePrompt(body) || body === EXPLORE_CONTINUE_PRESET_PROMPT.trim()) return false;
  if (input.runKind === "execute_plan" && input.existingGoal?.trim()) return false;
  return true;
}

/**
 * Resolve the goal to persist for this turn.
 * - Prefer classifier `understanding` (model paraphrase for the sticky strip).
 * - Fall back to prompt compress only when understanding is missing.
 * - Continuations / resume / unclear-without-understanding → keep existing.
 * Returns undefined when nothing should change.
 */
export function resolveSessionGoalUpdate(input: ResolveSessionGoalInput): string | undefined {
  const existing = input.existingGoal?.trim() || "";
  if (!shouldRefreshSessionGoal(input)) {
    return undefined;
  }
  const fromUnderstanding = clampSessionGoal(input.understanding?.trim() || "");
  const next = fromUnderstanding || compressSessionGoal(input.prompt);
  if (!next || next === existing) return undefined;
  return next;
}
