import { describe, expect, it } from "vitest";
import {
  classifyVerifyStderr,
  compareVerifyRuns,
  computeVerifyPassed,
  extractFailingFilesFromVerifyOutput,
  formatVerifyComparisonSummary,
  getVerifyEnvironmentNote,
  isVerifyRunCommand,
  isVerifyRunRequestFailed,
} from "./projectVerifyRun";

describe("projectVerifyRun helpers", () => {
  it("isVerifyRunRequestFailed distinguishes fetch errors from verify outcomes", () => {
    expect(isVerifyRunRequestFailed({ error: "网络错误" })).toBe(true);
    expect(isVerifyRunRequestFailed({ error: "网络错误", ranAt: "2026-01-01T00:00:00.000Z", ok: false })).toBe(false);
  });

  it("computeVerifyPassed uses exit code and step results", () => {
    expect(computeVerifyPassed({ skipped: true, exitCode: 0 })).toBe(true);
    expect(computeVerifyPassed({ exitCode: 0 })).toBe(true);
    expect(computeVerifyPassed({ exitCode: 1 })).toBe(false);
    expect(computeVerifyPassed({ exitCode: 0, timedOut: true })).toBe(false);
    expect(
      computeVerifyPassed({
        exitCode: 1,
        steps: [
          { command: "npm run typecheck", ok: true, exitCode: 0, durationMs: 1, stdout: "", stderr: "", failingFiles: [] },
          { command: "npm run test", ok: false, exitCode: 1, durationMs: 1, stdout: "", stderr: "", failingFiles: [] },
        ],
      }),
    ).toBe(false);
  });

  it("classifies vitest pool EPERM stderr as environment noise", () => {
    const stderr = "[vitest-pool]: Failed to terminate forks worker. Error: kill EPERM";
    expect(classifyVerifyStderr(stderr)).toBe("environment");
    expect(
      getVerifyEnvironmentNote({
        stderr,
        steps: [],
      }),
    ).toContain("Vitest");
  });

  it("compareVerifyRuns detects improvement when baseline failed and after passed", () => {
    const before = { ok: false, exitCode: 1, failingFiles: ["a.test.ts"], stdout: "", stderr: "" };
    const after = { ok: true, exitCode: 0, failingFiles: [], stdout: "", stderr: "" };
    const comparison = compareVerifyRuns(before, after);
    expect(comparison.kind).toBe("improved");
    expect(formatVerifyComparisonSummary(comparison, before, after)).toContain("已改善");
  });

  it("compareVerifyRuns treats higher exit code as worse when both still fail", () => {
    const before = { ok: false, exitCode: 1, failingFiles: ["a.test.ts"], stdout: "", stderr: "" };
    const after = { ok: false, exitCode: 2, failingFiles: ["a.test.ts"], stdout: "", stderr: "" };
    expect(compareVerifyRuns(before, after).kind).toBe("worse");
  });

  it("isVerifyRunCommand matches verify scripts and ignores unrelated run_command", () => {
    const scripts = ["npm run typecheck", "npm run test"];
    expect(isVerifyRunCommand("npm run test", scripts)).toBe(true);
    expect(isVerifyRunCommand("cd D:\\proj; npm run test", scripts)).toBe(true);
    expect(isVerifyRunCommand("echo hello", scripts)).toBe(false);
    expect(isVerifyRunCommand("npm install", scripts)).toBe(false);
  });

  it("extractFailingFilesFromVerifyOutput parses vitest FAIL lines and stack traces", () => {
    const stdout = "FAIL src/foo.test.ts > case\n";
    expect(extractFailingFilesFromVerifyOutput(stdout, "")).toContain("src/foo.test.ts");
    const withStderr = extractFailingFilesFromVerifyOutput(stdout, "at src/foo.test.ts:12:3");
    expect(withStderr).toContain("src/foo.test.ts");
    expect(extractFailingFilesFromVerifyOutput("FAIL src\\bar\\foo.test.ts > case\n", "")).toContain(
      "src/bar/foo.test.ts",
    );
  });
});
