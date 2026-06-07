import { describe, expect, it } from "vitest";
import {
  buildExploreBudgetNudge,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
} from "./agentExplorationBudget";

describe("agentExplorationBudget", () => {
  it("builds nudge with turn count", () => {
    expect(INTERACTIVE_EXPLORE_TURN_BUDGET).toBe(3);
    expect(buildExploreBudgetNudge(3)).toContain("已连续 3 轮");
    expect(buildExploreBudgetNudge(3)).toContain("patch_file");
  });

  it("uses a tighter explore budget for execute_plan", () => {
    expect(EXECUTE_PLAN_EXPLORE_TURN_BUDGET).toBe(2);
    expect(EXECUTE_PLAN_EXPLORE_TURN_BUDGET).toBeLessThan(INTERACTIVE_EXPLORE_TURN_BUDGET);
  });
});
