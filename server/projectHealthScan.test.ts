import { describe, expect, it } from "vitest";
import { buildCodeReviewPrompt, type ProjectHealthScanPayload } from "../shared/projectHealthScan";

function makePayload(issues: ProjectHealthScanPayload["issues"]): ProjectHealthScanPayload {
  const summary = {
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
  };
  return {
    projectPath: "/tmp/fixture",
    scannedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 1,
    issues,
    summary,
    checksRun: ["fixture"],
  };
}

describe("projectHealthScan shared format", () => {
  it("buildCodeReviewPrompt includes grep hits as priority list", () => {
    const result = makePayload([
      {
        id: "1",
        severity: "error",
        title: "动态代码执行",
        detail: "eval",
        category: "security",
        file: "src/app.ts",
        line: 1,
        pattern: "security-eval",
      },
    ]);
    const prompt = buildCodeReviewPrompt(result);
    expect(prompt).toContain("只读代码审查");
    expect(prompt).toContain("优先核查清单");
    expect(prompt).toContain("动态代码执行");
  });

  it("buildCodeReviewPrompt asks for broad review when no hits", () => {
    const result = makePayload([]);
    const prompt = buildCodeReviewPrompt(result);
    expect(prompt).toContain("未发现常见坏味道");
    expect(prompt).toContain("广覆盖审查");
  });
});
