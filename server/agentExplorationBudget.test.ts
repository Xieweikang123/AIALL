import { describe, expect, it } from "vitest";
import {
  ASK_EXPLORE_TURN_BUDGET,
  buildAskExploreBudgetNudge,
  buildAskForceAnswerNudge,
  buildExploreBudgetNudge,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
} from "./agentExplorationBudget";

describe("agentExplorationBudget", () => {
  it("builds nudge with turn count", () => {
    expect(INTERACTIVE_EXPLORE_TURN_BUDGET).toBe(2);
    expect(buildExploreBudgetNudge(2)).toContain("已连续 2 轮");
    expect(buildExploreBudgetNudge(2)).toContain("patch_file");
  });

  it("uses a tighter explore budget for execute_plan", () => {
    expect(EXECUTE_PLAN_EXPLORE_TURN_BUDGET).toBe(1);
    expect(EXECUTE_PLAN_EXPLORE_TURN_BUDGET).toBeLessThan(INTERACTIVE_EXPLORE_TURN_BUDGET);
  });

  it("builds ask-mode nudges to answer instead of patch", () => {
    expect(ASK_EXPLORE_TURN_BUDGET).toBeGreaterThan(INTERACTIVE_EXPLORE_TURN_BUDGET);
    expect(buildAskExploreBudgetNudge(5)).toContain("Ask 模式");
    expect(buildAskExploreBudgetNudge(5)).toContain("完整自然语言答案");
    expect(buildAskForceAnswerNudge(12)).toContain("移除所有工具");
  });
});
