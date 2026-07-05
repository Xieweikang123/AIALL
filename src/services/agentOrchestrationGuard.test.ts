import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findOrchestrationViolations,
  findStaticFixRecipeViolations,
  scanOrchestrationGuardedFiles,
  tierForGuardedPath,
} from "./agentOrchestrationGuard";
import { PRODUCT_ORCHESTRATION_PATHS } from "../orchestration/orchestrationTiers";

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

  it("product tier allows static-fix-shaped text in vision hints but classifiers do not", () => {
    const recipe = '用户要求「点击输入」时：常见修复为 padding';
    expect(findOrchestrationViolations(recipe, "generic_classifier")).toContain(
      "static fix recipe (use dynamic build*Hint instead)",
    );
    expect(findOrchestrationViolations(recipe, "product")).toEqual([]);
  });

  it("maps vision and userIntentHints to product tier", () => {
    expect(tierForGuardedPath("src/orchestration/product/visionMessage.ts")).toBe("product");
    expect(tierForGuardedPath("src/orchestration/product/userIntentHints.ts")).toBe("product");
    expect(tierForGuardedPath("src/orchestration/generic/userIntentClassifiers.ts")).toBe(
      "generic_classifier",
    );
    expect(PRODUCT_ORCHESTRATION_PATHS).toContain("server/agentContextBuilder.ts");
  });

  it("detects static fix recipes in prompt strings", () => {
    expect(findStaticFixRecipeViolations('用户要求「点击输入」时：常见修复为 padding')).toEqual([
      "static fix recipe (use dynamic build*Hint instead)",
    ]);
    expect(findStaticFixRecipeViolations("grep 精确符号后再 read")).toEqual([]);
  });
});
