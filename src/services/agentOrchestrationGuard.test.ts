import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanOrchestrationGuardedFiles } from "./agentOrchestrationGuard";

describe("agentOrchestrationGuard", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../..");

  it("orchestration sources contain no forbidden business terms", () => {
    const violations = scanOrchestrationGuardedFiles(repoRoot);
    if (violations.size > 0) {
      const detail = [...violations.entries()]
        .map(([file, terms]) => `${file}: ${terms.join(", ")}`)
        .join("\n");
      expect.fail(`Forbidden business terms in orchestration:\n${detail}`);
    }
    expect(violations.size).toBe(0);
  });
});
