import { describe, expect, it } from "vitest";
import { AGENT_SAFETY_MAX_TURNS } from "../../server/agentTurnBudget";

describe("AGENT_SAFETY_MAX_TURNS", () => {
  it("is a high ceiling for runaway tool loops only", () => {
    expect(AGENT_SAFETY_MAX_TURNS).toBeGreaterThanOrEqual(100);
  });
});
