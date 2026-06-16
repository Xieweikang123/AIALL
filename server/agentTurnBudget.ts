/** Hard ceiling to stop runaway tool loops. Normal tasks should finish well below this. */
export const AGENT_SAFETY_MAX_TURNS = 200;

/** Direct @-file / plan execution — fewer reads, more writes. */
export const EXECUTE_PLAN_MAX_TURNS = 20;
/** Open-ended build tasks (explore + modify). */
export const INTERACTIVE_BUILD_MAX_TURNS = 24;
export const ASK_MAX_TURNS = 12;
/** Plan mode — thorough exploration, output structured plan, no writes. */
export const PLAN_MAX_TURNS = 16;

/** Resume runs get extra headroom so multi-segment tasks can finish without repeated clicks. */
export const RESUME_MAX_TURNS_CAP = 48;

export function resolveAgentMaxTurns(
  mode: "ask" | "build" | "plan",
  profile?: { kind?: "interactive" | "execute_plan" } | null,
): number {
  if (mode === "ask") return ASK_MAX_TURNS;
  if (mode === "plan") return PLAN_MAX_TURNS;
  if (profile?.kind === "execute_plan") return EXECUTE_PLAN_MAX_TURNS;
  return INTERACTIVE_BUILD_MAX_TURNS;
}

/** Extra turns when resuming after interruption or turn-cap exhaustion. */
export function resolveResumeMaxTurns(
  mode: "ask" | "build" | "plan",
  profile?: { kind?: "interactive" | "execute_plan" } | null,
  completedTurns = 0,
): number {
  const base = resolveAgentMaxTurns(mode, profile);
  if (completedTurns <= 0) return base;
  const bonus = Math.max(base, Math.ceil(completedTurns * 0.5));
  return Math.min(AGENT_SAFETY_MAX_TURNS, RESUME_MAX_TURNS_CAP, base + bonus);
}

export function buildAgentTurnsLowNudge(turn: number, maxTurns: number): string {
  const remaining = Math.max(0, maxTurns - turn + 1);
  return [
    `【系统提示】剩余约 ${remaining} 轮（当前第 ${turn}/${maxTurns} 轮）。`,
    "请优先完成必要的 patch_file / write_file，然后给出简要总结；避免再开新的广泛探索。",
  ].join("");
}

/** Injected when a segment budget is exhausted but the safety ceiling allows another segment. */
export function buildSegmentContinueNudge(completedTurn: number, segmentIndex: number): string {
  return [
    `【系统自动续跑·第 ${segmentIndex} 段】仍在同一次任务中（累计 ${completedTurn} 轮）。`,
    "不要重复已完成的 read/grep；直接 patch_file / write_file 完成剩余修改，然后给出最终总结。",
  ].join("");
}

/** Extend the per-segment turn ceiling without ending the SSE session. */
export function extendSegmentMaxTurns(
  completedTurn: number,
  segmentBudget: number,
  safetyMax = AGENT_SAFETY_MAX_TURNS,
): number {
  return Math.min(completedTurn + segmentBudget, safetyMax);
}
