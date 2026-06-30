import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ProjectShellResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorMessage?: string;
};

export async function runProjectShellCommand(
  projectRoot: string,
  command: string,
  timeoutMs = 120_000,
): Promise<ProjectShellResult> {
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const shellFlag = process.platform === "win32" ? "-Command" : "-c";
  try {
    const { stdout, stderr } = await execFileAsync(shell, [shellFlag, command], {
      cwd: projectRoot,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
      timedOut: false,
    };
  } catch (error: unknown) {
    const err = error as {
      killed?: boolean;
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (err.killed) {
      return {
        ok: false,
        exitCode: -1,
        stdout: String(err.stdout || ""),
        stderr: String(err.stderr || ""),
        timedOut: true,
        errorMessage: `命令超时（${timeoutMs}ms）`,
      };
    }
    const exitCode = typeof err.status === "number" ? err.status : 1;
    return {
      ok: false,
      exitCode,
      stdout: String(err.stdout || ""),
      stderr: String(err.stderr || ""),
      timedOut: false,
      errorMessage: err.message,
    };
  }
}
