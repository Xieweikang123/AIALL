import { describe, expect, it } from "vitest";
import {
  buildBehaviorContradictionHint,
  buildConfigBindingTopicHint,
  buildConsultativeBuildHint,
  buildUserOptionMismatchHint,
  isBehaviorContradictionPrompt,
  isConsultativeUserPrompt,
  isUserOptionMismatchPrompt,
} from "./agentUserIntent";
import { isScheduledTaskConsultativePrompt, shouldNudgeScheduledJobRegistration, buildConsultativeTopicHints } from "./agentConsultativeTopics";
import {
  CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET,
  buildConsultativeExploreBudgetNudge,
  buildGrepEmptyRecoveryNudge,
  buildReadFileFailedRecoveryNudge,
} from "../../shared/agentExplorationBudget";
import {
  FIXTURE_CONTRADICTION_USER,
  FIXTURE_FOO_BACKFILL_JOB,
  FIXTURE_BACKFILL_SERVICE,
  FIXTURE_PRIOR_DENIAL,
  FIXTURE_SCHEDULED_TASK_QUESTION,
} from "./agentTestFixtures";

/** Structural regression — generic fixtures only, no audited session binding. */
describe("agent audit regression fixtures", () => {
  it("treats list-sorting question as consultative read-only", () => {
    expect(isConsultativeUserPrompt("列表按啥字段排序的？")).toBe(true);
    const hint = buildConsultativeBuildHint();
    expect(hint).toContain("直接调用方");
    expect(hint).toContain("禁止 patch_file");
  });

  it("treats context-touchMark question as consultative", () => {
    expect(isConsultativeUserPrompt("切换上下文，会更新 touchMark 吗？")).toBe(true);
  });

  it("detects contradiction after prior denial about side effects", () => {
    const history = [{ role: "assistant", content: FIXTURE_PRIOR_DENIAL }];
    expect(isBehaviorContradictionPrompt(FIXTURE_CONTRADICTION_USER, history)).toBe(true);
    expect(buildBehaviorContradictionHint()).toContain("调用方");
  });

  it("documents consultative explore budget tighter than unbounded read loops", () => {
    expect(CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET).toBeLessThanOrEqual(5);
    expect(buildConsultativeExploreBudgetNudge(4)).toContain("咨询只读");
  });

  it("covers grep empty recovery with arbitrary symbol", () => {
    const nudge = buildGrepEmptyRecoveryNudge(["switchFooContext"]);
    expect(nudge).toContain("switchFooContext");
    expect(nudge).not.toMatch(/touchMark|BarPanel/i);
  });

  it("covers read_file failure recovery nudge", () => {
    const nudge = buildReadFileFailedRecoveryNudge(["src/missing.vue"]);
    expect(nudge).toContain("read_file 失败");
    expect(nudge).toContain("禁止重复 read");
  });

  it("covers config binding hint without business terms", () => {
    expect(isUserOptionMismatchPrompt("不是这几个选项")).toBe(true);
    expect(buildUserOptionMismatchHint()).not.toMatch(/minimap|Monaco|Vertical size/i);
    expect(buildConfigBindingTopicHint("doc_lookup")).toContain("web_extract");
    expect(buildConfigBindingTopicHint("doc_lookup")).not.toMatch(/minimap|slider|scale/i);
  });

  it("scheduled-task: nudge when Job read without registration trace", () => {
    expect(isScheduledTaskConsultativePrompt(FIXTURE_SCHEDULED_TASK_QUESTION)).toBe(true);
    expect(
      buildConsultativeTopicHints(FIXTURE_SCHEDULED_TASK_QUESTION),
    ).toContain("项目栈 Profile");
    expect(shouldNudgeScheduledJobRegistration([FIXTURE_FOO_BACKFILL_JOB], [FIXTURE_BACKFILL_SERVICE])).toBe(
      true,
    );
  });
});
