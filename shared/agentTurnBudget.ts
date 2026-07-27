/** Hard ceiling to stop runaway tool loops. Normal tasks should finish well below this. */
export const AGENT_SAFETY_MAX_TURNS = 200;

/** One-click auto bug fix — tighter than execute_plan. */
export const AUTO_BUG_FIX_MAX_TURNS = 12;

/** Wall-clock limit for auto bug fix runs (ms). */
export const AUTO_BUG_FIX_WALL_CLOCK_MS = 10 * 60 * 1000;

/** Direct @-file / plan execution — fewer reads, more writes. */
export const EXECUTE_PLAN_MAX_TURNS = 20;
/** Open-ended build tasks (explore + modify). */
export const INTERACTIVE_BUILD_MAX_TURNS = 24;
export const ASK_MAX_TURNS = 12;
/** Explore mode — project understanding report (read-only). */
export const EXPLORE_MAX_TURNS = 16;
export const EXPLORE_QUICK_MAX_TURNS = 8;
export const EXPLORE_DEEP_MAX_TURNS = 24;
export const EXPLORE_FOLLOWUP_MAX_TURNS = 12;
export const EXPLORE_RESUME_BONUS_TURNS = 8;
/** Plan mode — thorough exploration, output structured plan, no writes. */
export const PLAN_MAX_TURNS = 16;

/** Resume runs get extra headroom so multi-segment tasks can finish without repeated clicks. */
export const RESUME_MAX_TURNS_CAP = 48;

export function resolveAgentMaxTurns(
  mode: "ask" | "build" | "plan" | "explore" | "auto",
  profile?: { kind?: "interactive" | "execute_plan"; triggerSource?: string } | null,
  exploreMaxTurns?: number,
): number {
  if (profile?.triggerSource === "auto_bug_fix") return AUTO_BUG_FIX_MAX_TURNS;
  if (mode === "ask") return ASK_MAX_TURNS;
  if (mode === "explore") return exploreMaxTurns ?? EXPLORE_MAX_TURNS;
  if (profile?.kind === "execute_plan") return EXECUTE_PLAN_MAX_TURNS;
  if (mode === "plan") return PLAN_MAX_TURNS;
  return INTERACTIVE_BUILD_MAX_TURNS;
}

/** Extra turns when resuming after interruption or turn-cap exhaustion. */
export function resolveResumeMaxTurns(
  mode: "ask" | "build" | "plan" | "explore" | "auto",
  profile?: { kind?: "interactive" | "execute_plan" } | null,
  completedTurns = 0,
  exploreMaxTurns?: number,
): number {
  const base = resolveAgentMaxTurns(mode, profile, exploreMaxTurns);
  if (completedTurns <= 0) return base;
  if (mode === "explore") {
    return Math.min(
      AGENT_SAFETY_MAX_TURNS,
      RESUME_MAX_TURNS_CAP,
      completedTurns + EXPLORE_RESUME_BONUS_TURNS,
    );
  }
  const bonus = Math.max(base, Math.ceil(completedTurns * 0.5));
  return Math.min(AGENT_SAFETY_MAX_TURNS, RESUME_MAX_TURNS_CAP, base + bonus);
}

export function buildAgentTurnsLowNudge(
  turn: number,
  maxTurns: number,
  mode?: string,
  executingPlan = false,
): string {
  const remaining = Math.max(0, maxTurns - turn + 1);
  const actionHint =
    mode === "explore"
      ? "请基于已读内容立即输出或更新项目理解报告（含 project-knowledge 标记）；避免再开新的广泛探索。禁止空回复。"
      : mode === "plan" && !executingPlan
        ? "请立即输出结构化修改方案，然后给出简要总结；避免再开新的广泛探索。"
        : "请优先完成必要的 patch_file / write_file，然后给出简要总结（已改文件、验证方式、剩余问题）；避免再开新的广泛探索。禁止空回复结束。";
  return [
    `【系统提示】剩余约 ${remaining} 轮（当前第 ${turn}/${maxTurns} 轮）。`,
    actionHint,
  ].join("");
}

/** Injected when a segment budget is exhausted but the safety ceiling allows another segment. */
export function buildSegmentContinueNudge(
  completedTurn: number,
  segmentIndex: number,
  mode?: string,
  executingPlan = false,
): string {
  const actionHint =
    mode === "explore"
      ? "请补充报告遗漏模块并更新项目理解报告，不要再无差别广搜。禁止空回复。"
      : mode === "plan" && !executingPlan
        ? "请立即输出结构化修改方案，不要再继续读文件。"
        : "不要重复已完成的 read/grep；直接 patch_file / write_file 完成剩余修改，然后给出最终总结（已改文件、如何验证、未修项）。禁止空回复。";
  return [
    `【系统自动续跑·第 ${segmentIndex} 段】仍在同一次任务中（累计 ${completedTurn} 轮）。`,
    actionHint,
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

/** Forced user-visible wrap-up when segment/turn budget is nearly exhausted. */
export function buildTurnCapFinalSummaryNudge(
  completedTurn: number,
  writtenFiles?: string[],
  attempt = 1,
): string {
  const files =
    writtenFiles?.length ? `已改文件：${writtenFiles.join("、")}。` : "若尚未改代码，说明阻塞点。";
  const urgency =
    attempt >= 2
      ? "【最后机会·禁止再调工具】这是收尾轮：必须输出 isFinal 级完整中文总结，否则任务将标记为未完成。"
      : "【系统强制·收尾】段内轮次已用尽，下一轮禁止调用工具。";
  return [
    `${urgency}（累计 ${completedTurn} 轮）`,
    "必须用中文输出结构化总结：① 做了什么/改了哪些文件；② 如何验证（命令或手动步骤）；③ 仍存问题或未修项。",
    files,
    "禁止空回复；禁止仅重复 progress 块而不给用户可见结论。",
    "若本轮未改任何代码：禁止以「请手动执行/另开对话粘贴」收尾；须说明真实阻塞点。",
  ].join("");
}

export function buildTurnCapExhaustedMessage(completedTurn: number): string {
  return `段内轮次已用尽（累计 ${completedTurn} 轮）且未收到有效总结，任务可能未完成。`;
}
