import { describe, expect, it } from "vitest";
import {
  ASK_EXPLORE_TURN_BUDGET,
  buildAskExploreBudgetNudge,
  buildAskForceAnswerNudge,
  buildBuildExploreForcePatchNudge,
  buildConsultativeExploreBudgetNudge,
  buildExploreBudgetNudge,
  buildExploreInterimDiagnosisNudge,
  buildGrepEmptyRecoveryNudge,
  buildPatchAnchorForcePatchNudge,
  buildSameIssueFollowUpForceSummaryNudge,
  buildSameIssueFollowUpHint,
  buildUiDefectForcePatchNudge,
  CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  EXPLORE_INTERIM_DIAGNOSIS_TURN,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
  isExplorationArchivePath,
  isProductiveWritePath,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE,
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

  it("builds generic build hard-cap force-patch nudge", () => {
    const nudge = buildBuildExploreForcePatchNudge(10);
    expect(nudge).toContain("patch_file");
    expect(nudge).toContain("禁止只输出 patch 思路");
  });

  it("builds consultative read-only explore budget nudge", () => {
    expect(CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET).toBe(4);
    expect(CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET).toBeLessThan(ASK_EXPLORE_TURN_BUDGET);
    const nudge = buildConsultativeExploreBudgetNudge(4);
    expect(nudge).toContain("咨询只读");
    expect(nudge).toContain("直接调用方");
  });

  it("builds grep empty recovery nudge with patterns", () => {
    const nudge = buildGrepEmptyRecoveryNudge(["switchVibeSession", "fooBar"]);
    expect(nudge).toContain("switchVibeSession");
    expect(nudge).toContain("禁止重复相同 pattern");
    expect(nudge).toContain("handler/composable");
  });

  it("treats exploration archive paths as non-productive writes", () => {
    expect(isExplorationArchivePath(".aiall/exploration/2026-test.md")).toBe(true);
    expect(isProductiveWritePath(".aiall/exploration/2026-test.md")).toBe(false);
    expect(isProductiveWritePath("src/foo.ts")).toBe(true);
  });

  it("builds same-issue follow-up hints", () => {
    expect(SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE).toBeLessThan(10);
    expect(buildSameIssueFollowUpHint()).toContain("同问题追问");
    expect(buildSameIssueFollowUpHint()).toContain("运行时入口");
    expect(buildSameIssueFollowUpHint()).not.toContain(".aiall/exploration");
    expect(buildSameIssueFollowUpForceSummaryNudge(8)).toContain("结构化结论");
  });
});
