export type ProjectVerifyStepResult = {
  command: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  failingFiles: string[];
  timedOut?: boolean;
  skipped?: boolean;
};

export type ProjectVerifyRunPayload = {
  projectPath: string;
  command: string;
  /** Whether all executed verify steps passed (exit code 0, not timed out). Skipped runs are ok. */
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  failingFiles: string[];
  ranAt: string;
  skipped?: boolean;
  skipReason?: string;
  timedOut?: boolean;
  /** Per-step results when multiple verify commands run in sequence. */
  steps?: ProjectVerifyStepResult[];
  /** Full pipeline for agent re-verify (may include steps not yet executed). */
  verifyCommands?: string[];
};

export type VerifyRunSnapshot = Pick<
  ProjectVerifyRunPayload,
  "ok" | "exitCode" | "failingFiles" | "stdout" | "stderr" | "steps"
>;

const FAILING_FILE_RES =
  /(?:FAIL|✓|×|✗)\s+([\w./\\-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?=\s*(?:>|\n|$))/gi;

/** Extract relative test file paths from vitest/jest-style output. */
export function extractFailingFilesFromVerifyOutput(stdout: string, stderr: string): string[] {
  const combined = `${stdout}\n${stderr}`;
  const files = new Set<string>();
  for (const match of combined.matchAll(FAILING_FILE_RES)) {
    const file = match[1]?.replace(/\\/g, "/").trim();
    if (file) files.add(file);
  }
  for (const match of combined.matchAll(
    /(?:at\s+)?(?:\.\/)?([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?):\d+/g,
  )) {
    const file = match[1]?.replace(/\\/g, "/").trim();
    if (file) files.add(file);
  }
  return [...files].slice(0, 16);
}

export function truncateVerifyOutput(text: string, maxChars = 32_000): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const half = Math.floor(maxChars / 2);
  return `${trimmed.slice(0, half)}\n\n…[输出已截断]…\n\n${trimmed.slice(-half)}`;
}

/** HTTP / client fetch failed — not a verify outcome. */
export function isVerifyRunRequestFailed(
  result: Partial<ProjectVerifyRunPayload> & { error?: string },
): boolean {
  return Boolean(result.error) && !result.ranAt;
}

export function computeVerifyPassed(input: {
  skipped?: boolean;
  exitCode: number;
  timedOut?: boolean;
  steps?: ProjectVerifyStepResult[];
}): boolean {
  if (input.skipped) return true;
  if (input.timedOut) return false;
  if (input.steps?.length) {
    return input.steps.every((step) => step.ok && !step.timedOut);
  }
  return input.exitCode === 0;
}

export type VerifyStderrKind = "none" | "environment" | "unknown";

/** Classify stderr that does not necessarily imply verify failure (exit code may still be 0). */
export function classifyVerifyStderr(stderr: string): VerifyStderrKind {
  const trimmed = stderr.trim();
  if (!trimmed) return "none";
  if (
    /\[vitest-pool\].*Failed to terminate forks worker/i.test(trimmed)
    || /Error:\s*kill EPERM/i.test(trimmed)
  ) {
    return "environment";
  }
  return "unknown";
}

export function getVerifyEnvironmentNote(payload: Pick<ProjectVerifyRunPayload, "stderr" | "steps">): string | null {
  const stderrParts = payload.steps?.map((step) => step.stderr).filter(Boolean) ?? [];
  if (payload.stderr) stderrParts.push(payload.stderr);
  for (const part of stderrParts) {
    if (classifyVerifyStderr(part) === "environment") {
      return "stderr 含 Vitest worker 清理警告（通常非断言失败）";
    }
  }
  return null;
}

export function formatVerifyCommandLabel(commands: string[]): string {
  return commands.join(" → ");
}

export type VerifyRegressionKind = "none" | "worse" | "improved" | "unchanged";

/** Normalize shell command for comparison (whitespace, case). */
export function normalizeShellCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Strip leading `cd …;` prefix from chained shell commands. */
export function stripLeadingCdPrefix(command: string): string {
  return command.replace(/^cd\s+[^;]+;\s*/i, "").trim();
}

/** Last segment of a chained shell command (`a; b; c` → `c`). */
export function lastShellCommandSegment(command: string): string {
  const parts = command.split(";").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? command.trim();
}

/** Whether an agent run_command invocation matches a project verify script. */
export function isVerifyRunCommand(command: string, verifyScripts: string[]): boolean {
  const trimmed = command.trim();
  if (!trimmed || !verifyScripts.length) return false;
  const normalizedRun = normalizeShellCommand(stripLeadingCdPrefix(lastShellCommandSegment(trimmed)));
  return verifyScripts.some((script) => {
    const normalizedScript = normalizeShellCommand(script);
    if (!normalizedScript) return false;
    return normalizedRun === normalizedScript
      || normalizedRun.endsWith(` ${normalizedScript}`)
      || normalizedRun.endsWith(`; ${normalizedScript}`);
  });
}

export function compareVerifyRuns(
  before: VerifyRunSnapshot | null | undefined,
  after: VerifyRunSnapshot | null | undefined,
): { kind: VerifyRegressionKind; detail: string } {
  if (!before || !after) {
    return { kind: "none", detail: "缺少基线或复验结果，无法对比" };
  }
  const beforeFails = before.failingFiles?.length ?? 0;
  const afterFails = after.failingFiles?.length ?? 0;
  if (after.ok && !before.ok) {
    return { kind: "improved", detail: "复验通过，基线曾失败" };
  }
  if (after.ok && before.ok) {
    return { kind: "unchanged", detail: "复验与基线均通过" };
  }
  if (!after.ok && before.ok) {
    return { kind: "worse", detail: "复验失败，基线曾通过（可能引入回归）" };
  }
  if (afterFails > beforeFails) {
    return { kind: "worse", detail: `失败文件数 ${beforeFails} → ${afterFails}` };
  }
  if (afterFails < beforeFails) {
    return { kind: "improved", detail: `失败文件数 ${beforeFails} → ${afterFails}` };
  }
  if (!after.ok && !before.ok && after.exitCode !== before.exitCode) {
    const improved = after.exitCode < before.exitCode;
    return {
      kind: improved ? "improved" : "worse",
      detail: `exit code ${before.exitCode} → ${after.exitCode}`,
    };
  }
  return { kind: "unchanged", detail: "失败规模与基线相当" };
}

export function formatVerifyComparisonSummary(
  comparison: { kind: VerifyRegressionKind; detail: string },
  before: VerifyRunSnapshot,
  after: VerifyRunSnapshot,
): string {
  const beforeLabel = before.ok ? "通过" : `失败 (exit ${before.exitCode})`;
  const afterLabel = after.ok ? "通过" : `失败 (exit ${after.exitCode})`;
  const kindLabel =
    comparison.kind === "improved"
      ? "已改善"
      : comparison.kind === "worse"
        ? "可能回归"
        : comparison.kind === "unchanged"
          ? "无变化"
          : "";
  const prefix = kindLabel ? `复验${kindLabel}：` : "复验：";
  return `${prefix}${comparison.detail}（${beforeLabel} → ${afterLabel}）`;
}
