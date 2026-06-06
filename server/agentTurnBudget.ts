export type AgentTurnBudgetInput = {
  mode: "ask" | "build";
  prompt: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

const ASK_MIN = 3;
const ASK_MAX = 10;
const BUILD_MIN = 6;
const BUILD_MAX = 16;

const COMPLEX_INTENT =
  /重构|迁移|排查|调试|修复|实现|添加|删除|多个|全部|所有|整个|批量|rename|重命名|refactor|implement|debug|fix|migrate/i;

/** Estimate how many agent tool rounds are likely needed (upper bound, not a target). */
export function resolveAgentMaxTurns(input: AgentTurnBudgetInput): number {
  const isAsk = input.mode === "ask";
  let turns = isAsk ? 4 : 8;

  const prompt = input.prompt.trim();
  const historyCount = input.history?.length ?? 0;

  if (prompt.length > 120) turns += 1;
  if (prompt.length > 400) turns += 1;

  const fileMentions = (prompt.match(/@[\w./\\-]+/g) || []).length;
  const refBlocks = prompt.includes("## 📎") ? 1 : 0;
  const refSignals = Math.max(fileMentions, refBlocks);
  if (refSignals >= 1) turns += 1;
  if (refSignals >= 3) turns += 1;

  if (historyCount >= 4) turns += 1;
  if (historyCount >= 10) turns += 2;

  if (COMPLEX_INTENT.test(prompt)) turns += isAsk ? 1 : 2;

  const min = isAsk ? ASK_MIN : BUILD_MIN;
  const max = isAsk ? ASK_MAX : BUILD_MAX;
  return Math.min(max, Math.max(min, turns));
}
