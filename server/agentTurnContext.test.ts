import { describe, expect, it } from "vitest";
import { MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS } from "../shared/agentExplorationBudget";
import { shouldSkipExploreTurnForRuntimeFailures, type AgentTurnContext } from "./agentTurnContext";

function makeCtx(consecutiveRuntimeToolFailureTurns: number): AgentTurnContext {
  return { consecutiveRuntimeToolFailureTurns } as AgentTurnContext;
}

describe("shouldSkipExploreTurnForRuntimeFailures", () => {
  it("skips explore budget for runtime failure turns under the cap", () => {
    const outcomes = [{ result: "错误：isVisionGrepLowSpread is not defined" }];
    expect(shouldSkipExploreTurnForRuntimeFailures(makeCtx(0), outcomes)).toBe(true);
    expect(shouldSkipExploreTurnForRuntimeFailures(makeCtx(2), outcomes)).toBe(true);
  });

  it("stops skipping after consecutive runtime failure cap", () => {
    const outcomes = [{ result: "错误：isVisionGrepLowSpread is not defined" }];
    expect(
      shouldSkipExploreTurnForRuntimeFailures(
        makeCtx(MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS),
        outcomes,
      ),
    ).toBe(false);
  });

  it("does not skip guard-only failure turns", () => {
    const outcomes = [{ result: "错误：grep「foo」过宽，易扫出大量无关命中。" }];
    expect(shouldSkipExploreTurnForRuntimeFailures(makeCtx(0), outcomes)).toBe(false);
  });
});
