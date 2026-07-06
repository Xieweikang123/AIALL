import { describe, expect, it } from "vitest";
import { isWriteAllowedForAutoBugFix } from "../shared/agentExplorationBudget";

describe("isWriteAllowedForAutoBugFix", () => {
  it("allows paths in target list", () => {
    expect(isWriteAllowedForAutoBugFix("src/foo.ts", ["src/foo.ts"])).toBe(true);
    expect(isWriteAllowedForAutoBugFix("src/foo.ts", ["foo.ts"])).toBe(true);
  });

  it("blocks paths outside target list", () => {
    expect(isWriteAllowedForAutoBugFix("src/other.ts", ["src/foo.ts"])).toBe(false);
  });

  it("allows all when target list empty", () => {
    expect(isWriteAllowedForAutoBugFix("src/any.ts", [])).toBe(true);
  });
});
