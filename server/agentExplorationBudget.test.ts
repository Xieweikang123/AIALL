import { describe, expect, it } from "vitest";
import {
  ASK_EXPLORE_TURN_BUDGET,
  buildAskExploreBudgetNudge,
  buildAskForceAnswerNudge,
  buildExploreBudgetNudge,
  buildExploreInterimDiagnosisNudge,
  buildPatchAnchorForcePatchNudge,
  buildUiDefectForcePatchNudge,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  EXPLORE_INTERIM_DIAGNOSIS_TURN,
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

  it("builds interim diagnosis nudge requiring Chinese progress", () => {
    expect(EXPLORE_INTERIM_DIAGNOSIS_TURN).toBe(4);
    const nudge = buildExploreInterimDiagnosisNudge(4);
    expect(nudge).toContain("进度摘要");
    expect(nudge).toContain("patch_file");
  });

  it("builds UI defect force-patch nudge at hard cap", () => {
    const nudge = buildUiDefectForcePatchNudge(10);
    expect(nudge).toContain("patch_file");
    expect(nudge).toContain("禁止只输出分析");
  });

  it("builds patch-anchor force-patch nudge", () => {
    const nudge = buildPatchAnchorForcePatchNudge();
    expect(nudge).toContain("只能调用 patch_file");
    expect(nudge).toContain("禁止重复输出截图分析");
  });
});
