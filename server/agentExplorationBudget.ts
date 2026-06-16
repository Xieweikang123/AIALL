/** Consecutive read-only tool turns in interactive build mode before nudging the model to edit. */
export const INTERACTIVE_EXPLORE_TURN_BUDGET = 2;

/** Consecutive read-only tool turns in execute_plan mode before nudging the model to edit. */
export const EXECUTE_PLAN_EXPLORE_TURN_BUDGET = 1;

/** Consecutive read-only turns in plan mode before nudging the model to wrap up. */
export const PLAN_EXPLORE_TURN_BUDGET = 3;

export function buildExploreBudgetNudge(consecutiveExploreTurns: number): string {
  return [
    `【系统提示】已连续 ${consecutiveExploreTurns} 轮仅探索、尚未修改。`,
    "下一轮必须调用 patch_file 或 write_file；若目标文件已 read 过，直接改，不要再 grep/read。",
    "若仍缺路径：最多 1 次 grep/search，然后立即修改。",
    "禁止重复 read 同一文件相同片段；禁止用英文写长分析。",
  ].join("");
}
