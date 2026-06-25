import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findStaticFixRecipeViolations,
  scanOrchestrationGuardedFiles,
} from "./agentOrchestrationGuard";

describe("agentOrchestrationGuard", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../..");

  it("orchestration sources contain no forbidden business terms or static fix recipes", () => {
    const violations = scanOrchestrationGuardedFiles(repoRoot);
    if (violations.size > 0) {
      const detail = [...violations.entries()]
        .map(([file, terms]) => `${file}: ${terms.join(", ")}`)
        .join("\n");
      expect.fail(`Orchestration guard violations:\n${detail}`);
    }
    expect(violations.size).toBe(0);
  });

  it("detects static fix recipes in prompt strings", () => {
    expect(findStaticFixRecipeViolations('用户要求「点击输入」时：常见修复为 padding')).toEqual([
      "static fix recipe (use dynamic build*Hint instead)",
    ]);
    expect(findStaticFixRecipeViolations("grep 精确符号后再 read")).toEqual([]);
  });
});
