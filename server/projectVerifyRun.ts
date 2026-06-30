import path from "node:path";
import { detectProjectRuntimeProfile } from "./agentRuntimeHint";
import { runProjectShellCommand } from "./projectShell";
import {
  extractFailingFilesFromVerifyOutput,
  truncateVerifyOutput,
  type ProjectVerifyRunPayload,
} from "../shared/projectVerifyRun";

export type { ProjectVerifyRunPayload } from "../shared/projectVerifyRun";
export { compareVerifyRuns, extractFailingFilesFromVerifyOutput } from "../shared/projectVerifyRun";

const DEFAULT_TIMEOUT_MS = 120_000;

export async function runProjectVerify(
  projectPath: string,
  options?: { timeoutMs?: number; commandOverride?: string },
): Promise<ProjectVerifyRunPayload & { ok: true }> {
  const root = path.resolve(projectPath.trim());
  const profile = detectProjectRuntimeProfile(root);
  const command = options?.commandOverride?.trim() || profile.verifyScript;
  const ranAt = new Date().toISOString();

  if (!command) {
    return {
      ok: true,
      projectPath: root,
      command: "",
      exitCode: 0,
      durationMs: 0,
      stdout: "",
      stderr: "",
      failingFiles: [],
      ranAt,
      skipped: true,
      skipReason: "未检测到 package.json 中的 verify 脚本（typecheck/check/lint/test）",
    };
  }

  const started = Date.now();
  const result = await runProjectShellCommand(
    root,
    command,
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const durationMs = Date.now() - started;
  const stdout = truncateVerifyOutput(result.stdout);
  const stderr = truncateVerifyOutput(result.stderr);
  const failingFiles = result.ok
    ? []
    : extractFailingFilesFromVerifyOutput(result.stdout, result.stderr);

  return {
    ok: true,
    projectPath: root,
    command,
    exitCode: result.timedOut ? -1 : result.exitCode,
    durationMs,
    stdout,
    stderr,
    failingFiles,
    ranAt,
    skipped: false,
  };
}
