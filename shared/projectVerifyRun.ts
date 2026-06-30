export type ProjectVerifyRunPayload = {
  projectPath: string;
  command: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  failingFiles: string[];
  ranAt: string;
  skipped?: boolean;
  skipReason?: string;
};

export type VerifyRunSnapshot = Pick<
  ProjectVerifyRunPayload,
  "ok" | "exitCode" | "failingFiles" | "stdout" | "stderr"
>;

const FAILING_FILE_RES =
  /(?:FAIL|✓|×|✗)\s+[^\s]*[/\\]?([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)/gi;

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

export type VerifyRegressionKind = "none" | "worse" | "improved" | "unchanged";

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
  if (after.exitCode !== before.exitCode) {
    return { kind: "improved", detail: `exit code ${before.exitCode} → ${after.exitCode}` };
  }
  return { kind: "unchanged", detail: "失败规模与基线相当" };
}
