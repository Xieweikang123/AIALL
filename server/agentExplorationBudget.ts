/** Consecutive read-only tool turns in interactive build mode before nudging the model to edit. */
export const INTERACTIVE_EXPLORE_TURN_BUDGET = 3;

/** Consecutive read-only tool turns in execute_plan mode before nudging the model to edit. */
export const EXECUTE_PLAN_EXPLORE_TURN_BUDGET = 2;

export function buildExploreBudgetNudge(consecutiveExploreTurns: number): string {
  return [
    `【系统提示】已连续 ${consecutiveExploreTurns} 轮仅探索、尚未修改。`,
    "若已知目标文件：立即 read_file 核对真实内容，再 patch_file / write_file。",
    "若仍不确定：最多再做 1 次 grep/search，并说明为何还不能改。",
    "禁止重复 read 同一文件相同片段。",
  ].join("");
}
