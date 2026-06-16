/** Consecutive read-only tool turns in interactive build mode before nudging the model to edit. */
export const INTERACTIVE_EXPLORE_TURN_BUDGET = 2;

/** Consecutive read-only tool turns in execute_plan mode before nudging the model to edit. */
export const EXECUTE_PLAN_EXPLORE_TURN_BUDGET = 1;

/** Consecutive read-only turns in plan mode before nudging the model to wrap up. */
export const PLAN_EXPLORE_TURN_BUDGET = 3;

/**
 * Hard cap on total exploration-only turns (read-only turns, not reset by nudges).
 * When exceeded, tools are stripped from the next request, forcing text output.
 */
export const MAX_TOTAL_EXPLORE_TURNS = 6;

export function buildExploreBudgetNudge(consecutiveExploreTurns: number, mode?: string): string {
  const actionHint = mode === "plan"
    ? "请立即输出结构化修改方案（文件清单 + 代码块 + 改动说明），不要再继续读文件。"
    : "下一轮必须调用 patch_file 或 write_file；若目标文件已 read 过，直接改，不要再 grep/read。\n若仍缺路径：最多 1 次 grep/search，然后立即修改。\n禁止重复 read 同一文件相同片段；禁止用英文写长分析。";
  return [
    `【系统提示】已连续 ${consecutiveExploreTurns} 轮仅探索、尚未修改。`,
    actionHint,
  ].join("");
}

/** Injected when total exploration turns exceed the hard cap — forces text-only output. */
export function buildForceOutputNudge(totalExploreTurns: number, mode?: string): string {
  const actionHint = mode === "plan"
    ? "请基于已有信息，立即输出结构化修改方案（文件清单 + 代码块 + 改动说明）。不要再调用任何工具。"
    : "请基于已有信息，立即输出当前发现的结论、问题根因、以及建议的修复方案。不要再调用任何工具。";
  return [
    `【系统强制】已累计 ${totalExploreTurns} 轮仅探索（超过上限 ${MAX_TOTAL_EXPLORE_TURNS}）。`,
    "下一轮已移除所有工具，你只能输出文字。",
    actionHint,
  ].join("");
}
