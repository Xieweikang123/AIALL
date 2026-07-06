import { describe, expect, it } from "vitest";
import {
  ASK_EXPLORE_TURN_BUDGET,
  buildAskExploreBudgetNudge,
  buildAskForceAnswerNudge,
  buildBuildExploreForcePatchNudge,
  buildConsultativeExploreBudgetNudge,
  buildConsultativeDuplicateExploreNudge,
  buildConsultativeSegmentCapNudge,
  buildExploreBudgetNudge,
  buildExploreInterimDiagnosisNudge,
  buildGrepEmptyRecoveryNudge,
  buildGrepHitVueReadNudge,
  buildReadFileFailedRecoveryNudge,
  buildRuntimeToolFailureRecoveryNudge,
  MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS,
  buildPatchAnchorForcePatchNudge,
  buildPatchFailureCompletionRetryNudge,
  buildExplorationArchiveWriteBlockedMessage,
  buildSameIssueFollowUpForceSummaryNudge,
  buildSameIssueFollowUpHint,
  buildUiDefectForcePatchNudge,
  buildUiSymptomDiagnosisHint,
  buildUltraShortOpenTaskHint,
  buildPostPatchVerifyNudge,
  buildPostPatchReadVerifyNudge,
  buildPlanListDirOnlySoftNudge,
  buildPlanNoTargetPathHint,
  buildPlanQuoteInformationalHint,
  buildPlanRevisionFollowUpHint,
  buildPendingPlanAmendHint,
  buildPendingPlanClarificationHint,
  buildAmbiguousTermClarificationHint,
  buildAmbiguousTermClarificationRetryNudge,
  buildPlanSegmentCapNudge,
  CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  EXPLORE_INTERIM_DIAGNOSIS_TURN,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
  PLAN_EXPLORE_TURN_BUDGET,
  isExplorationArchivePath,
  isProductiveWritePath,
  MAX_TOTAL_EXPLORE_TURNS,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE,
} from "../shared/agentExplorationBudget";

describe("agentExplorationBudget", () => {
  it("builds nudge with turn count", () => {
    expect(INTERACTIVE_EXPLORE_TURN_BUDGET).toBe(2);
    expect(PLAN_EXPLORE_TURN_BUDGET).toBe(3);
    expect(buildExploreBudgetNudge(2)).toContain("已连续 2 轮");
    expect(buildExploreBudgetNudge(2)).toContain("patch_file");
    expect(buildExploreBudgetNudge(3, "plan")).toContain("结构化修改方案");
    expect(buildExploreBudgetNudge(3, "plan")).not.toContain("项目理解报告");
  });

  it("builds plan explore soft and segment cap nudges", () => {
    expect(buildPlanListDirOnlySoftNudge(3)).toContain("[PLAN]");
    expect(buildPlanListDirOnlySoftNudge(3)).not.toContain("移除所有工具");
    expect(buildPlanSegmentCapNudge(16, 10)).toContain("段内上限");
    expect(buildPlanNoTargetPathHint()).toContain("未指明具体文件");
    expect(buildPlanNoTargetPathHint()).toContain("澄清");
    expect(buildPlanRevisionFollowUpHint()).toContain("完整结构化修改方案");
    expect(buildPlanRevisionFollowUpHint()).toContain(".aiall/plans/");
    expect(buildPlanQuoteInformationalHint()).toContain("方案答疑");
    expect(buildPlanQuoteInformationalHint()).toContain("禁止输出");
    expect(buildPendingPlanAmendHint()).toContain("Pending Plan");
    expect(buildPendingPlanAmendHint()).toContain("禁止输出独立");
    expect(buildPendingPlanAmendHint(".aiall/plans/x.md")).toContain(".aiall/plans/x.md");
    expect(buildPendingPlanClarificationHint()).toContain("合并");
    expect(buildAmbiguousTermClarificationHint(["foo"])).toContain("「foo」");
    expect(buildAmbiguousTermClarificationHint(["foo"])).toContain("禁止猜测");
    expect(buildAmbiguousTermClarificationHint(["foo"])).toContain("编号");
    expect(buildAmbiguousTermClarificationRetryNudge(["foo"])).toContain("脚手架");
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
    const nudge = buildGrepEmptyRecoveryNudge(["switchFooContext", "fooBar"]);
    expect(nudge).toContain("switchFooContext");
    expect(nudge).toContain("禁止重复相同 pattern");
    expect(nudge).toContain("handler/composable");
  });

  it("builds read_file failure recovery nudge", () => {
    const nudge = buildReadFileFailedRecoveryNudge(["src/missing.vue"]);
    expect(nudge).toContain("read_file 失败");
    expect(nudge).toContain("禁止重复 read");
  });

  it("builds runtime tool failure recovery nudge", () => {
    expect(MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS).toBe(3);
    expect(buildRuntimeToolFailureRecoveryNudge(1, false)).toContain("不计入探索轮次");
    expect(buildRuntimeToolFailureRecoveryNudge(3, true)).toContain("计入探索预算");
  });

  it("builds grep hit vue read nudge and consultative segment cap", () => {
    expect(buildGrepHitVueReadNudge(["src/Foo.vue"])).toContain("grep 已定位组件文件");
    expect(buildGrepHitVueReadNudge(["src/Foo.vue"])).toContain("<style>");
    expect(buildConsultativeSegmentCapNudge(5, 8)).toContain("咨询只读");
    expect(buildConsultativeSegmentCapNudge(5, 8)).toContain("下一轮再确认");
    expect(buildConsultativeDuplicateExploreNudge()).toContain("重复执行");
    expect(buildConsultativeDuplicateExploreNudge()).toContain("禁止再调用工具");
  });

  it("treats exploration archive paths as non-productive writes", () => {
    expect(isExplorationArchivePath(".aiall/exploration/2026-test.md")).toBe(true);
    expect(isProductiveWritePath(".aiall/exploration/2026-test.md")).toBe(false);
    expect(isProductiveWritePath("src/foo.ts")).toBe(true);
  });

  it("builds same-issue follow-up hints", () => {
    expect(SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE).toBeLessThan(MAX_TOTAL_EXPLORE_TURNS);
    expect(buildSameIssueFollowUpHint()).toContain("同问题追问");
    expect(buildSameIssueFollowUpHint()).toContain("运行时入口");
    expect(buildSameIssueFollowUpHint()).toContain("分症状排查");
    expect(buildSameIssueFollowUpForceSummaryNudge(8)).toContain("结构化结论");
  });

  it("builds patch failure completion and exploration write block messages", () => {
    expect(buildPatchFailureCompletionRetryNudge(["src/foo.ts"], ["src/bar.ts"])).toContain("patch_file 失败");
    expect(buildPatchFailureCompletionRetryNudge(["src/foo.ts"], [])).toContain("src/foo.ts");
    expect(buildExplorationArchiveWriteBlockedMessage()).toContain("探索笔记");
    expect(buildUiSymptomDiagnosisHint()).toContain("overflow-y:auto");
    expect(buildUiSymptomDiagnosisHint()).toContain("padding:0");
  });

  it("builds ultra-short open task and post-patch verify nudges", () => {
    expect(buildUltraShortOpenTaskHint()).toContain("超短任务");
    expect(buildUltraShortOpenTaskHint()).toContain("verify");
    expect(buildPostPatchVerifyNudge("npm run test")).toContain("npm run test");
    expect(buildPostPatchVerifyNudge("npm run test")).toContain("禁止在未验证前");
    expect(buildPostPatchReadVerifyNudge()).toContain("read_file");
  });
});
