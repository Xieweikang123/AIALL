import path from "node:path";
import { detectProjectRuntimeProfile } from "./projectRuntimeProfile";
import { runProjectShellCommand } from "./projectShell";
import {
  computeVerifyPassed,
  extractFailingFilesFromVerifyOutput,
  formatVerifyCommandLabel,
  truncateVerifyOutput,
  type ProjectVerifyRunPayload,
  type ProjectVerifyStepResult,
} from "../shared/projectVerifyRun";

export type { ProjectVerifyRunPayload } from "../shared/projectVerifyRun";
export {
  compareVerifyRuns,
  extractFailingFilesFromVerifyOutput,
  formatVerifyComparisonSummary,
} from "../shared/projectVerifyRun";

const DEFAULT_TIMEOUT_MS = 120_000;

function buildVerifyStep(
  command: string,
  shell: Awaited<ReturnType<typeof runProjectShellCommand>>,
): ProjectVerifyStepResult {
  const stdout = truncateVerifyOutput(shell.stdout);
  const stderr = truncateVerifyOutput(shell.stderr);
  const exitCode = shell.timedOut ? -1 : shell.exitCode;
  const failingFiles = shell.ok && !shell.timedOut
    ? []
    : extractFailingFilesFromVerifyOutput(shell.stdout, shell.stderr);
  const ok = !shell.timedOut && shell.exitCode === 0;
  return {
    command,
    ok,
    exitCode,
    durationMs: 0,
    stdout,
    stderr,
    failingFiles,
    timedOut: shell.timedOut,
  };
}

function appendSection(existing: string, heading: string, body: string): string {
  if (!body.trim()) return existing;
  const section = `=== ${heading} ===\n${body.trim()}`;
  return existing ? `${existing}\n\n${section}` : section;
}

export async function runProjectVerify(
  projectPath: string,
  options?: { timeoutMs?: number; commandOverride?: string },
): Promise<ProjectVerifyRunPayload> {
  const root = path.resolve(projectPath.trim());
  const profile = detectProjectRuntimeProfile(root);
  const verifyCommands = options?.commandOverride?.trim()
    ? [options.commandOverride.trim()]
    : profile.verifyScripts ?? (profile.verifyScript ? [profile.verifyScript] : []);
  const ranAt = new Date().toISOString();

  if (!verifyCommands.length) {
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
      verifyCommands: [],
    };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const steps: ProjectVerifyStepResult[] = [];
  let stdout = "";
  let stderr = "";
  const failingFiles = new Set<string>();
  let exitCode = 0;
  let timedOut = false;
  const started = Date.now();

  for (const command of verifyCommands) {
    const stepStarted = Date.now();
    const result = await runProjectShellCommand(root, command, timeoutMs);
    const step = buildVerifyStep(command, result);
    step.durationMs = Date.now() - stepStarted;
    steps.push(step);
    stdout = appendSection(stdout, command, step.stdout);
    stderr = appendSection(stderr, command, step.stderr);
    for (const file of step.failingFiles) failingFiles.add(file);

    if (!step.ok) {
      exitCode = step.exitCode;
      timedOut = Boolean(step.timedOut);
      break;
    }
  }

  const durationMs = Date.now() - started;
  const ok = computeVerifyPassed({ exitCode, timedOut, steps });
  const command = formatVerifyCommandLabel(
    steps.length < verifyCommands.length
      ? verifyCommands.slice(0, steps.length)
      : verifyCommands,
  );

  return {
    ok,
    projectPath: root,
    command,
    exitCode,
    durationMs,
    stdout,
    stderr,
    failingFiles: [...failingFiles],
    ranAt,
    skipped: false,
    timedOut,
    steps,
    verifyCommands,
  };
}
