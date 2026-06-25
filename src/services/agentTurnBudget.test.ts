import { describe, expect, it } from "vitest";
import {
  AGENT_SAFETY_MAX_TURNS,
  ASK_MAX_TURNS,
  EXPLORE_MAX_TURNS,
  EXECUTE_PLAN_MAX_TURNS,
  INTERACTIVE_BUILD_MAX_TURNS,
  RESUME_MAX_TURNS_CAP,
  extendSegmentMaxTurns,
  buildTurnCapFinalSummaryNudge,
  buildTurnCapExhaustedMessage,
  resolveAgentMaxTurns,
  resolveResumeMaxTurns,
} from "../../server/agentTurnBudget";

describe("AGENT_SAFETY_MAX_TURNS", () => {
  it("is a high ceiling for runaway tool loops only", () => {
    expect(AGENT_SAFETY_MAX_TURNS).toBeGreaterThanOrEqual(100);
  });
});

describe("resolveAgentMaxTurns", () => {
  it("limits execute_plan build runs", () => {
    expect(resolveAgentMaxTurns("build", { kind: "execute_plan" })).toBe(EXECUTE_PLAN_MAX_TURNS);
    expect(EXECUTE_PLAN_MAX_TURNS).toBe(20);
  });

  it("limits interactive build runs", () => {
    expect(resolveAgentMaxTurns("build", { kind: "interactive" })).toBe(INTERACTIVE_BUILD_MAX_TURNS);
    expect(resolveAgentMaxTurns("build", undefined)).toBe(INTERACTIVE_BUILD_MAX_TURNS);
    expect(INTERACTIVE_BUILD_MAX_TURNS).toBe(24);
  });

  it("limits ask mode runs", () => {
    expect(resolveAgentMaxTurns("ask", { kind: "execute_plan" })).toBe(ASK_MAX_TURNS);
    expect(resolveAgentMaxTurns("ask", undefined)).toBe(ASK_MAX_TURNS);
    expect(ASK_MAX_TURNS).toBe(12);
  });

  it("limits plan explore vs plan execution", () => {
    expect(resolveAgentMaxTurns("plan", { kind: "interactive" })).toBe(16);
    expect(resolveAgentMaxTurns("plan", { kind: "execute_plan" })).toBe(EXECUTE_PLAN_MAX_TURNS);
  });

  it("limits explore mode runs", () => {
    expect(resolveAgentMaxTurns("explore", undefined)).toBe(EXPLORE_MAX_TURNS);
    expect(resolveAgentMaxTurns("explore", undefined, 24)).toBe(24);
  });
});

describe("resolveResumeMaxTurns", () => {
  it("returns base budget when nothing completed yet", () => {
    expect(resolveResumeMaxTurns("build", undefined, 0)).toBe(INTERACTIVE_BUILD_MAX_TURNS);
  });

  it("grants bonus turns after partial or full exhaustion", () => {
    expect(resolveResumeMaxTurns("build", undefined, 12)).toBe(48);
    expect(resolveResumeMaxTurns("build", undefined, 24)).toBe(RESUME_MAX_TURNS_CAP);
  });

  it("grants explore resume bonus", () => {
    expect(resolveResumeMaxTurns("explore", undefined, 16)).toBe(24);
  });

  it("never exceeds resume cap or safety ceiling", () => {
    expect(resolveResumeMaxTurns("build", undefined, 100)).toBe(RESUME_MAX_TURNS_CAP);
    expect(RESUME_MAX_TURNS_CAP).toBeLessThanOrEqual(AGENT_SAFETY_MAX_TURNS);
  });
});

describe("extendSegmentMaxTurns", () => {
  it("extends within the safety ceiling", () => {
    expect(extendSegmentMaxTurns(20, EXECUTE_PLAN_MAX_TURNS)).toBe(40);
    expect(extendSegmentMaxTurns(190, INTERACTIVE_BUILD_MAX_TURNS)).toBe(AGENT_SAFETY_MAX_TURNS);
  });
});

describe("buildTurnCapFinalSummaryNudge", () => {
  it("requires structured Chinese summary with written files", () => {
    const nudge = buildTurnCapFinalSummaryNudge(24, ["src/foo.ts"]);
    expect(nudge).toContain("禁止调用工具");
    expect(nudge).toContain("src/foo.ts");
    expect(nudge).toContain("禁止空回复");
  });

  it("escalates urgency on second attempt", () => {
    const nudge = buildTurnCapFinalSummaryNudge(25, undefined, 2);
    expect(nudge).toContain("最后机会");
  });

  it("builds exhausted message when forced summaries fail", () => {
    expect(buildTurnCapExhaustedMessage(26)).toContain("未完成");
  });
});
