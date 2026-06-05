import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitStatusFile {
  path: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
}

export interface GitStatusResult {
  ok: boolean;
  branch: string;
  files: GitStatusFile[];
  stagedCount: number;
  unstagedCount: number;
  error?: string;
}

export interface GitDiffFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface GitDiffResult {
  ok: boolean;
  files: GitDiffFile[];
  patch: string;
  error?: string;
}

export interface GitCommitResult {
  ok: boolean;
  hash: string;
  error?: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitLogResult {
  ok: boolean;
  entries: GitLogEntry[];
  error?: string;
}

async function gitExec(projectRoot: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, {
      cwd: projectRoot,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: Buffer | string; stdout?: Buffer | string };
    if (err.code === "ENOENT") {
      throw new Error("Git 未安装或不在 PATH 中");
    }
    const stderr = err.stderr ? String(err.stderr).trim() : "";
    const stdout = err.stdout ? String(err.stdout).trim() : "";
    throw new Error(stderr || stdout || err.message || "Git 命令执行失败");
  }
}

export async function gitStatus(projectRoot: string): Promise<GitStatusResult> {
  try {
    const { stdout: branchOut } = await gitExec(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchOut.trim();

    const { stdout } = await gitExec(projectRoot, ["status", "--porcelain=v1"]);
    const files: GitStatusFile[] = [];

    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const indexStatus = line[0] || " ";
      const worktreeStatus = line[1] || " ";
      const filePath = line.slice(3).trim();
      if (!filePath) continue;

      const staged = indexStatus !== " " && indexStatus !== "?";
      let status = "untracked";
      if (indexStatus === "?" && worktreeStatus === "?") {
        status = "untracked";
      } else if (indexStatus === "!" && worktreeStatus === "!") {
        status = "ignored";
      } else {
        if (indexStatus === "A") status = "added";
        else if (indexStatus === "D" || worktreeStatus === "D") status = "deleted";
        else if (indexStatus === "R" || indexStatus === "C") status = "renamed";
        else if (indexStatus === "M" || worktreeStatus === "M") status = "modified";
        else if (worktreeStatus === "?" ) status = "untracked";
      }

      files.push({ path: filePath, status, indexStatus, worktreeStatus, staged });
    }

    const stagedCount = files.filter((f) => f.staged).length;
    const unstagedCount = files.filter((f) => !f.staged).length;

    return { ok: true, branch, files, stagedCount, unstagedCount };
  } catch (error) {
    return { ok: false, branch: "", files: [], stagedCount: 0, unstagedCount: 0, error: error instanceof Error ? error.message : "获取 Git 状态失败" };
  }
}

export async function gitDiff(projectRoot: string, filePath?: string): Promise<GitDiffResult> {
  try {
    const args = ["diff", "--stat=200", "--stat-graph-width=0"];
    if (filePath) args.push("--", filePath);
    const { stdout: statOut } = await gitExec(projectRoot, args);

    const files: GitDiffFile[] = [];
    for (const line of statOut.split("\n")) {
      const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)\s*(\+*)(-*)/);
      if (match) {
        files.push({
          path: match[1].trim(),
          additions: Number(match[2]) || 0,
          deletions: (match[3]?.length || 0) + (match[4]?.length || 0),
        });
      }
    }

    const patchArgs = ["diff"];
    if (filePath) patchArgs.push("--", filePath);
    const { stdout: patchOut } = await gitExec(projectRoot, patchArgs);

    return { ok: true, files, patch: patchOut };
  } catch (error) {
    return { ok: false, files: [], patch: "", error: error instanceof Error ? error.message : "获取 diff 失败" };
  }
}

export async function gitDiffFile(projectRoot: string, filePath: string): Promise<GitDiffResult> {
  try {
    const { stdout: patchOut } = await gitExec(projectRoot, ["diff", "--", filePath]);

    const { stdout: statOut } = await gitExec(projectRoot, ["diff", "--numstat", "--", filePath]);
    const files: GitDiffFile[] = [];
    for (const line of statOut.split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        files.push({
          path: filePath,
          additions: Number(parts[0]) || 0,
          deletions: Number(parts[1]) || 0,
        });
      }
    }

    return { ok: true, files, patch: patchOut };
  } catch (error) {
    return { ok: false, files: [], patch: "", error: error instanceof Error ? error.message : "获取文件 diff 失败" };
  }
}

export async function gitCommit(projectRoot: string, message: string): Promise<GitCommitResult> {
  try {
    const { stdout } = await gitExec(projectRoot, ["commit", "-m", message]);
    const hashMatch = stdout.match(/\[[\w\s]+\s+([0-9a-f]+)\]/);
    const hash = hashMatch ? hashMatch[1] : "";

    return { ok: true, hash };
  } catch (error) {
    return { ok: false, hash: "", error: error instanceof Error ? error.message : "提交失败" };
  }
}

export async function gitLog(projectRoot: string, count = 20): Promise<GitLogResult> {
  try {
    const { stdout } = await gitExec(projectRoot, [
      "log",
      `--max-count=${count}`,
      "--format=%H%n%h%n%an%n%ai%n%s%n---",
    ]);

    const entries: GitLogEntry[] = [];
    const blocks = stdout.split("---\n");

    for (const block of blocks) {
      const lines = block.split("\n").filter((l) => l.trim());
      if (lines.length >= 5) {
        entries.push({
          hash: lines[0].trim(),
          shortHash: lines[1].trim(),
          author: lines[2].trim(),
          date: lines[3].trim(),
          message: lines.slice(4).join("\n").trim(),
        });
      }
    }

    return { ok: true, entries };
  } catch (error) {
    return { ok: false, entries: [], error: error instanceof Error ? error.message : "获取提交历史失败" };
  }
}

export async function gitAdd(projectRoot: string, files: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    if (files.length === 0) {
      await gitExec(projectRoot, ["add", "-A"]);
    } else {
      await gitExec(projectRoot, ["add", "--", ...files]);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "暂存失败" };
  }
}

export async function gitReset(projectRoot: string, files: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    if (files.length === 0) {
      await gitExec(projectRoot, ["reset", "HEAD"]);
    } else {
      await gitExec(projectRoot, ["reset", "HEAD", "--", ...files]);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "取消暂存失败" };
  }
}

export async function gitDiscard(projectRoot: string, files: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const file of files) {
      await gitExec(projectRoot, ["checkout", "--", file]);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "丢弃更改失败" };
  }
}

export async function gitDiscardAll(projectRoot: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await gitExec(projectRoot, ["checkout", "--", "."]);
    await gitExec(projectRoot, ["clean", "-fd"]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "丢弃所有更改失败" };
  }
}

export async function gitIsRepo(projectRoot: string): Promise<boolean> {
  try {
    await gitExec(projectRoot, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}
