import { describe, expect, it } from "vitest";
import {
  buildAutoBugFixPrompt,
  collectAutoBugFixTargetFiles,
  needsAutoBugFix,
} from "./autoBugFixPrompt";
import type { ProjectHealthScanPayload } from "./projectHealthScan";
import type { ProjectVerifyRunPayload } from "./projectVerifyRun";
import { compareVerifyRuns } from "./projectVerifyRun";

const baseScan: ProjectHealthScanPayload = {
  projectPath: "/proj",
  scannedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 10,
  issues: [
    {
      id: "1",
      severity: "error",
      title: "动态代码执行",
      detail: "eval",
      category: "security",
      file: "src/bad.ts",
      line: 1,
      pattern: "security-eval",
    },
    {
      id: "2",
      severity: "warning",
      title: "调试输出",
      detail: "",
      category: "debug",
      file: "src/log.ts",
      line: 2,
      pattern: "debug-console",
    },
    {
      id: "3",
      severity: "info",
      title: "TODO",
      detail: "",
      category: "debt",
      file: "src/todo.ts",
      line: 1,
      pattern: "debt-marker",
    },
  ],
  summary: { errorCount: 1, warningCount: 1, infoCount: 1 },
  checksRun: ["security-eval"],
};

const failingVerify: ProjectVerifyRunPayload = {
  projectPath: "/proj",
  command: "npm run test",
  ok: true,
  exitCode: 1,
  durationMs: 100,
  stdout: "FAIL src/app.test.ts",
  stderr: "",
  failingFiles: ["src/app.test.ts"],
  ranAt: "2026-01-01T00:00:00.000Z",
};

describe("autoBugFixPrompt", () => {
  it("builds patch-oriented prompt with test failures", () => {
    const prompt = buildAutoBugFixPrompt({ scan: baseScan, verifyRun: failingVerify });
    expect(prompt).toContain("[AUTO_BUG_FIX]");
    expect(prompt).toContain("允许 patch_file");
    expect(prompt).toContain("src/app.test.ts");
    expect(prompt).not.toContain("禁止修改");
  });

  it("default scope excludes warnings and debt", () => {
    const files = collectAutoBugFixTargetFiles(baseScan, failingVerify);
    expect(files).toContain("src/app.test.ts");
    expect(files).toContain("src/bad.ts");
    expect(files).not.toContain("src/log.ts");
    expect(files).not.toContain("src/todo.ts");
  });

  it("include_warnings adds warning but not debt", () => {
    const files = collectAutoBugFixTargetFiles(baseScan, failingVerify, "include_warnings");
    expect(files).toContain("src/log.ts");
    expect(files).not.toContain("src/todo.ts");
  });

  it("needsAutoBugFix false when all clear", () => {
    const okVerify: ProjectVerifyRunPayload = {
      ...failingVerify,
      exitCode: 0,
      failingFiles: [],
      stdout: "ok",
    };
    const cleanScan = { ...baseScan, issues: [], summary: { errorCount: 0, warningCount: 0, infoCount: 0 } };
    expect(needsAutoBugFix(cleanScan, okVerify)).toBe(false);
  });
});

describe("compareVerifyRuns", () => {
  it("detects regression when failures increase", () => {
    const before = { ok: false, exitCode: 1, failingFiles: ["a.test.ts"], stdout: "", stderr: "" };
    const after = { ok: false, exitCode: 1, failingFiles: ["a.test.ts", "b.test.ts"], stdout: "", stderr: "" };
    expect(compareVerifyRuns(before, after).kind).toBe("worse");
  });
});
