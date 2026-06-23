import { describe, expect, it } from "vitest";
import {
  buildBehaviorContradictionHint,
  buildConsultativeBuildHint,
  isBehaviorContradictionPrompt,
  isConsultativeUserPrompt,
} from "./agentUserIntent";
import {
  CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET,
  buildConsultativeExploreBudgetNudge,
  buildGrepEmptyRecoveryNudge,
} from "../../server/agentExplorationBudget";

/** Regression fixtures from audited Vibe session (structure only, no business binding). */
describe("agent audit regression fixtures", () => {
  it("treats behavior sorting question as consultative read-only", () => {
    expect(isConsultativeUserPrompt("会话列表按啥排序的？")).toBe(true);
    const hint = buildConsultativeBuildHint();
    expect(hint).toContain("直接调用方");
    expect(hint).toContain("禁止 patch_file");
  });

  it("treats switch-updatedAt question as consultative", () => {
    expect(isConsultativeUserPrompt("切换会话，会更新 updatedAt 吗？")).toBe(true);
  });

  it("detects contradiction after prior denial about switch side effects", () => {
    const history = [
      {
        role: "assistant",
        content: "**不会。** 切换会话不更新 `updatedAt`。",
      },
    ];
    expect(
      isBehaviorContradictionPrompt("但是不知道为啥，切换会话，选中的会话自动跑上面了", history),
    ).toBe(true);
    expect(buildBehaviorContradictionHint()).toContain("调用方");
  });

  it("documents consultative explore budget tighter than unbounded read loops", () => {
    expect(CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET).toBeLessThanOrEqual(5);
    expect(buildConsultativeExploreBudgetNudge(4)).toContain("咨询只读");
  });

  it("covers wrong grep symbol recovery from audit turn 2", () => {
    const nudge = buildGrepEmptyRecoveryNudge(["switchVibeSession"]);
    expect(nudge).toContain("switchVibeSession");
    expect(nudge).not.toMatch(/updatedAt|FilePanel/i);
  });
});
