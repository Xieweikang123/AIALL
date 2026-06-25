import { describe, expect, it } from "vitest";
import {
  FIXTURE_CONTRADICTION_USER,
  FIXTURE_PRIOR_DENIAL,
  FIXTURE_SCHEDULED_TASK_QUESTION,
} from "../src/services/agentTestFixtures";
import {
  CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS,
  EXECUTE_PLAN_MAX_CONTEXT_CHARS,
  resolveAgentRunPolicy,
  usesReadOnlyTools,
} from "./agentRunPolicy";
import {
  classifyUserIntentFromRules,
  resolveUserIntent,
} from "../src/services/agentIntentClassifier";
import { normalizeRunProfile } from "./agentRunProfile";
import {
  evaluateAgentRegressionCase,
  formatAgentRegressionReport,
  loadAgentRegressionFile,
  resolveDefaultRegressionFilePath,
  runAgentRegression,
} from "./agentRegression";

describe("resolveAgentRunPolicy", () => {
  it("routes consultative build to read-only tools", () => {
    const userIntent = resolveUserIntent({
      prompt: "列表按啥字段排序的？",
      mode: "build",
      hasImage: false,
      isAsk: false,
      ai: null,
    });
    const policy = resolveAgentRunPolicy({
      prompt: "列表按啥字段排序的？",
      mode: "build",
      userIntent,
      runProfile: normalizeRunProfile({ kind: "interactive" }),
      hasImage: false,
      isExecutePlan: false,
      isPlanExplore: false,
    });
    expect(policy.readOnlyBuildRun).toBe(true);
    expect(
      usesReadOnlyTools(policy, { isReadOnlyAgent: false, isPlanExplore: false }),
    ).toBe(true);
  });

  it("uses execute_plan context budget", () => {
    const userIntent = classifyUserIntentFromRules({
      prompt: "改吧",
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    const policy = resolveAgentRunPolicy({
      prompt: "改吧",
      mode: "build",
      userIntent,
      runProfile: normalizeRunProfile({ kind: "execute_plan", targetFiles: ["src/foo.ts"] }),
      hasImage: false,
      isExecutePlan: true,
      isPlanExplore: false,
    });
    expect(policy.maxContextChars).toBe(EXECUTE_PLAN_MAX_CONTEXT_CHARS);
    expect(policy.readOnlyBuildRun).toBe(false);
  });

  it("shrinks context for consultative UI appearance screenshot", () => {
    const userIntent = resolveUserIntent({
      prompt: "弹窗背景透明的？",
      mode: "build",
      hasImage: true,
      isAsk: false,
      ai: null,
    });
    const policy = resolveAgentRunPolicy({
      prompt: "弹窗背景透明的？",
      mode: "build",
      userIntent,
      runProfile: normalizeRunProfile({ kind: "interactive" }),
      hasImage: true,
      isExecutePlan: false,
      isPlanExplore: false,
    });
    expect(policy.consultativeUiAppearanceRun).toBe(true);
    expect(policy.maxContextChars).toBe(CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS);
  });

  it("detects behavior contradiction follow-up", () => {
    const history = [{ role: "assistant" as const, content: FIXTURE_PRIOR_DENIAL }];
    const userIntent = resolveUserIntent({
      prompt: FIXTURE_CONTRADICTION_USER,
      mode: "build",
      history,
      hasImage: false,
      isAsk: false,
      ai: null,
    });
    const policy = resolveAgentRunPolicy({
      prompt: FIXTURE_CONTRADICTION_USER,
      mode: "build",
      history,
      userIntent,
      runProfile: normalizeRunProfile({ kind: "interactive" }),
      hasImage: false,
      isExecutePlan: false,
      isPlanExplore: false,
    });
    expect(policy.behaviorContradictionRun).toBe(true);
    expect(policy.readOnlyBuildRun).toBe(true);
  });
});

describe("agent-regression.json", () => {
  const file = loadAgentRegressionFile(resolveDefaultRegressionFilePath());

  it("has at least 10 cases", () => {
    expect(file.cases.length).toBeGreaterThanOrEqual(10);
  });

  it("all cases pass (routing + policy)", () => {
    const report = runAgentRegression(file.cases);
    if (report.failed > 0) {
      expect.fail(formatAgentRegressionReport(report));
    }
    expect(report.passRate).toBe(1);
  });

  it("evaluates individual scheduled-task fixture", () => {
    const result = evaluateAgentRegressionCase({
      id: "scheduled-task-spot",
      prompt: FIXTURE_SCHEDULED_TASK_QUESTION,
      mode: "build",
      expect: {
        scheduledTaskConsultativeRun: true,
        readOnlyBuildRun: true,
      },
    });
    expect(result.passed).toBe(true);
  });
});
