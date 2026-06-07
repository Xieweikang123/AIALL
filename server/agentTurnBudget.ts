/** Hard ceiling to stop runaway tool loops. Normal tasks should finish well below this. */
export const AGENT_SAFETY_MAX_TURNS = 200;

export const EXECUTE_PLAN_MAX_TURNS = 8;
export const INTERACTIVE_BUILD_MAX_TURNS = 12;
export const ASK_MAX_TURNS = 10;

export function resolveAgentMaxTurns(
  mode: "ask" | "build",
  profile?: { kind?: "interactive" | "execute_plan" } | null,
): number {
  if (mode === "ask") return ASK_MAX_TURNS;
  if (profile?.kind === "execute_plan") return EXECUTE_PLAN_MAX_TURNS;
  return INTERACTIVE_BUILD_MAX_TURNS;
}
