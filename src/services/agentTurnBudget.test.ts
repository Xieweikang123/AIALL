import { describe, expect, it } from "vitest";
import {
  AGENT_SAFETY_MAX_TURNS,
  ASK_MAX_TURNS,
  EXECUTE_PLAN_MAX_TURNS,
  INTERACTIVE_BUILD_MAX_TURNS,
  resolveAgentMaxTurns,
} from "../../server/agentTurnBudget";

describe("AGENT_SAFETY_MAX_TURNS", () => {
  it("is a high ceiling for runaway tool loops only", () => {
    expect(AGENT_SAFETY_MAX_TURNS).toBeGreaterThanOrEqual(100);
  });
});

describe("resolveAgentMaxTurns", () => {
  it("limits execute_plan build runs", () => {
    expect(resolveAgentMaxTurns("build", { kind: "execute_plan" })).toBe(EXECUTE_PLAN_MAX_TURNS);
    expect(EXECUTE_PLAN_MAX_TURNS).toBe(8);
  });

  it("limits interactive build runs", () => {
    expect(resolveAgentMaxTurns("build", { kind: "interactive" })).toBe(INTERACTIVE_BUILD_MAX_TURNS);
    expect(resolveAgentMaxTurns("build", undefined)).toBe(INTERACTIVE_BUILD_MAX_TURNS);
    expect(INTERACTIVE_BUILD_MAX_TURNS).toBe(12);
  });

  it("limits ask mode runs", () => {
    expect(resolveAgentMaxTurns("ask", { kind: "execute_plan" })).toBe(ASK_MAX_TURNS);
    expect(resolveAgentMaxTurns("ask", undefined)).toBe(ASK_MAX_TURNS);
    expect(ASK_MAX_TURNS).toBe(10);
  });
});
