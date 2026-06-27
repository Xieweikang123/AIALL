import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DIFF_PREVIEW_CHARS = 2 * 1024 * 1024;

function isLikelyBinaryText(text: string): boolean {
  return text.includes("\0");
}

function ensurePreviewableText(text: string, label: string): string {
  if (text.length > MAX_DIFF_PREVIEW_CHARS) {
    throw new Error(`${label} 过大，无法预览`);
  }
  if (isLikelyBinaryText(text)) {
    throw new Error(`${label} 是二进制文件，无法预览`);
  }
  return text;
}

async function readGitObjectForPreview(projectRoot: string, ref: string, label: string): Promise<string | null> {
  try {
    const { stdout } = await gitExec(projectRoot, ["show", ref]);
    return ensurePreviewableText(stdout, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("过大") || message.includes("二进制")) throw error;
    return null;
  }
}

export interface GitStatusFile {
  path: string;
  oldPath?: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
}

export interface GitStatusResult {
  ok: boolean;
  branch: string;
  /** Full commit SHA at HEAD (for knowledge-base staleness tracking). */
  headCommit: string;
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

export interface GitRef {
  name: string;
  type: "head" | "local" | "remote" | "tag" | "other";
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  files: GitLogFile[];
  refs?: GitRef[];
}

export interface GitLogFile {
  path: string;
  status: string;
  oldPath?: string;
}

export interface GitLogResult {
  ok: boolean;
  entries: GitLogEntry[];
  error?: string;
}

export interface GitCommitFileDiffResult {
  ok: boolean;
  before: string;
  after: string;
  error?: string;
}

async function gitExec(projectRoot: string, args: string[], timeoutMs = 10_000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, {
      cwd: projectRoot,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      timeout: timeoutMs,
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
    const [{ stdout: branchOut }, { stdout: headOut }] = await Promise.all([
      gitExec(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
      gitExec(projectRoot, ["rev-parse", "HEAD"]),
    ]);
    const branch = branchOut.trim();
    const headCommit = headOut.trim();

    const { stdout } = await gitExec(projectRoot, ["status", "--porcelain=v1", "-z"]);
    const files: GitStatusFile[] = [];
    const entries = stdout.split("\0").filter(Boolean);

    for (let i = 0; i < entries.length; i += 1) {
      const line = entries[i];
      if (!line) continue;
      const indexStatus = line[0] || " ";
      const worktreeStatus = line[1] || " ";
      const filePath = line.slice(3);
      const oldPath = indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C"
        ? entries[++i]
        : undefined;
      if (!filePath) continue;

      const hasIndexChange = indexStatus !== " " && indexStatus !== "?";
      const hasWorktreeChange = worktreeStatus !== " " && worktreeStatus !== "?" && worktreeStatus !== "!";

      function getStatus(s: string): string {
        if (s === "A") return "added";
        if (s === "D") return "deleted";
        if (s === "R" || s === "C") return "renamed";
        if (s === "M") return "modified";
        return "modified";
      }

      if (hasIndexChange) {
        files.push({
          path: filePath,
          status: getStatus(indexStatus),
          indexStatus,
          worktreeStatus: " ",
          staged: true,
          ...(oldPath ? { oldPath } : {}),
        });
      }

      if (hasWorktreeChange) {
        files.push({
          path: filePath,
          status: getStatus(worktreeStatus),
          indexStatus: " ",
          worktreeStatus,
          staged: false,
          ...(oldPath ? { oldPath } : {}),
        });
      }

      if (!hasIndexChange && !hasWorktreeChange) {
        if (indexStatus === "?" && worktreeStatus === "?") {
          files.push({ path: filePath, status: "untracked", indexStatus, worktreeStatus, staged: false });
        } else if (indexStatus === "!" && worktreeStatus === "!") {
          files.push({ path: filePath, status: "ignored", indexStatus, worktreeStatus, staged: false });
        }
      }
    }

    const stagedCount = files.filter((f) => f.staged).length;
    const unstagedCount = files.filter((f) => !f.staged).length;

    return { ok: true, branch, headCommit, files, stagedCount, unstagedCount };
  } catch (error) {
    return {
      ok: false,
      branch: "",
      headCommit: "",
      files: [],
      stagedCount: 0,
      unstagedCount: 0,
      error: error instanceof Error ? error.message : "获取 Git 状态失败",
    };
  }
}

export type GitChangedFilesSinceOptions = {
  /** Include unstaged + staged changes against HEAD. */
  includeWorkingTree?: boolean;
};

export async function gitChangedFilesSince(
  projectRoot: string,
  sinceCommit: string,
  options: GitChangedFilesSinceOptions = {},
): Promise<{ ok: boolean; files: string[]; error?: string }> {
  const base = sinceCommit.trim();
  if (!base) return { ok: true, files: [] };
  const files = new Set<string>();
  const addLines = (stdout: string) => {
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim().replace(/\\/g, "/");
      if (trimmed) files.add(trimmed);
    }
  };
  try {
    const { stdout: rangeOut } = await gitExec(projectRoot, ["diff", "--name-only", base, "HEAD"]);
    addLines(rangeOut);
    if (options.includeWorkingTree) {
      const { stdout: wtOut } = await gitExec(projectRoot, ["diff", "--name-only", "HEAD"]);
      addLines(wtOut);
      const { stdout: stagedOut } = await gitExec(projectRoot, ["diff", "--name-only", "--cached", "HEAD"]);
      addLines(stagedOut);
    }
    return { ok: true, files: [...files].sort() };
  } catch (error) {
    return {
      ok: false,
      files: [],
      error: error instanceof Error ? error.message : "获取变更文件失败",
    };
  }
}

export async function gitHead(projectRoot: string): Promise<{ ok: boolean; hash?: string; error?: string }> {
  try {
    const { stdout } = await gitExec(projectRoot, ["rev-parse", "HEAD"]);
    const hash = stdout.trim();
    return { ok: true, hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "获取 HEAD 失败" };
  }
}

export async function gitDiff(projectRoot: string, filePath?: string, staged = false): Promise<GitDiffResult> {
  try {
    const args = ["diff", "--stat=200", "--stat-graph-width=0"];
    if (staged) args.push("--cached");
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
    if (staged) patchArgs.push("--cached");
    if (filePath) patchArgs.push("--", filePath);
    const { stdout: patchOut } = await gitExec(projectRoot, patchArgs);

    return { ok: true, files, patch: patchOut };
  } catch (error) {
    return { ok: false, files: [], patch: "", error: error instanceof Error ? error.message : "获取 diff 失败" };
  }
}

export async function gitDiffFile(projectRoot: string, filePath: string, staged = false): Promise<GitDiffResult> {
  try {
    if (filePath.endsWith('/')) return { ok: true, files: [], patch: '' };
    const diffArgs = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
    const { stdout: patchOut } = await gitExec(projectRoot, diffArgs);

    const statArgs = staged ? ["diff", "--cached", "--numstat", "--", filePath] : ["diff", "--numstat", "--", filePath];
    const { stdout: statOut } = await gitExec(projectRoot, statArgs);
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

export interface GitDiffContentResult {
  ok: boolean;
  before: string;
  after: string;
  error?: string;
}

export async function gitDiffContent(projectRoot: string, filePath: string, staged = false): Promise<GitDiffContentResult> {
  try {
    // 防御：文件夹路径不应请求 diff
    if (filePath.endsWith('/')) {
      return { ok: true, before: '', after: '' };
    }
    const diffArgs = staged
      ? ["diff", "--cached", "--no-color", "-U100000", "--", filePath]
      : ["diff", "HEAD", "--no-color", "-U100000", "--", filePath];

    let before = "";
    let after = "";

    try {
      const { stdout: diffOutput } = await gitExec(projectRoot, diffArgs);
      const parsed = parseUnifiedDiff(diffOutput);
      before = parsed.before;
      after = parsed.after;

      if (!diffOutput.trim() && !staged) {
        const worktreeContent = await readWorktreeFile(projectRoot, filePath);
        if (worktreeContent) {
          after = worktreeContent;
        }
      }
    } catch {
      const beforePromise = readGitObjectForPreview(projectRoot, staged ? `HEAD:${filePath}` : `:${filePath}`, filePath)
        .then((v) => v ?? (staged ? null : readGitObjectForPreview(projectRoot, `HEAD:${filePath}`, filePath)));

      let afterPromise: Promise<string>;
      if (staged) {
        afterPromise = readGitObjectForPreview(projectRoot, `:${filePath}`, filePath).then((v) => v ?? "");
      } else {
        afterPromise = readWorktreeFile(projectRoot, filePath);
      }

      const [b, a] = await Promise.all([beforePromise, afterPromise]);
      before = b ?? "";
      after = a ?? "";
    }

    if (before.length > MAX_DIFF_PREVIEW_CHARS) throw new Error(`${filePath} 旧版本过大，无法预览`);
    if (after.length > MAX_DIFF_PREVIEW_CHARS) throw new Error(`${filePath} 新版本过大，无法预览`);

    return { ok: true, before, after };
  } catch (error) {
    return { ok: false, before: "", after: "", error: error instanceof Error ? error.message : "获取文件内容失败" };
  }
}

function parseUnifiedDiff(diffOutput: string): { before: string; after: string } {
  const lines = diffOutput.split("\n");
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++") || line.startsWith("@@ ")) continue;
    if (line.startsWith("-") && !line.startsWith("---")) {
      beforeLines.push(line.slice(1));
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      afterLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      const content = line.slice(1);
      beforeLines.push(content);
      afterLines.push(content);
    }
  }
  return { before: beforeLines.join("\n"), after: afterLines.join("\n") };
}

async function readWorktreeFile(projectRoot: string, filePath: string): Promise<string> {
  const fs = await import("node:fs");
  const fullPath = await import("node:path").then((p) => p.resolve(projectRoot, filePath));
  if (!fs.existsSync(fullPath)) return "";
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) return "";
  if (stat.size > MAX_DIFF_PREVIEW_CHARS) throw new Error(`${filePath} 过大，无法预览`);
  const buffer = fs.readFileSync(fullPath);
  if (buffer.includes(0)) throw new Error(`${filePath} 是二进制文件，无法预览`);
  return buffer.toString("utf-8");
}

export async function gitCommitFileDiff(
  projectRoot: string,
  hash: string,
  filePath: string,
  oldPath?: string,
): Promise<GitCommitFileDiffResult> {
  try {
    const { stdout: parentOut } = await gitExec(projectRoot, ["rev-list", "--parents", "-n", "1", hash]);
    const [, parentHash] = parentOut.trim().split(/\s+/);
    const beforeRef = parentHash ? `${parentHash}:${oldPath || filePath}` : "";
    const afterRef = `${hash}:${filePath}`;

    let before = "";
    if (beforeRef) {
      before = (await readGitObjectForPreview(projectRoot, beforeRef, oldPath || filePath)) ?? "";
    }

    const after = (await readGitObjectForPreview(projectRoot, afterRef, filePath)) ?? "";

    return { ok: true, before, after };
  } catch (error) {
    return { ok: false, before: "", after: "", error: error instanceof Error ? error.message : "获取提交文件 diff 失败" };
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

function parseGitRefs(decorations: string): GitRef[] {
  if (!decorations) return [];
  const trimmed = decorations.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return [];
  const content = trimmed.slice(1, -1);
  return content
    .split(",")
    .map((part) => {
      const name = part.trim();
      if (name.startsWith("HEAD -> ")) {
        return { name: name.replace("HEAD -> ", ""), type: "head" as const };
      }
      if (name === "HEAD") {
        return { name, type: "head" as const };
      }
      if (name.startsWith("tag: ")) {
        return { name: name.replace("tag: ", ""), type: "tag" as const };
      }
      const hasSlash = name.includes("/");
      if (hasSlash) {
        const firstPart = name.split("/")[0];
        const commonLocalPrefixes = ["feature", "bugfix", "hotfix", "release", "dev", "personal"];
        if (commonLocalPrefixes.includes(firstPart)) {
          return { name, type: "local" as const };
        }
        return { name, type: "remote" as const };
      }
      return { name, type: "local" as const };
    })
    .filter((ref) => ref.name.length > 0);
}

const GIT_LOG_FORMAT = "%x1e%H%x1f%h%x1f%an%x1f%ai%x1f%d%x1f%B%x00";

function parseGitLogStdout(stdout: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  const blocks = stdout.split("\x1e").filter((block) => block.trim());

  for (const block of blocks) {
    const nullIdx = block.indexOf("\x00");
    if (nullIdx === -1) continue;

    const headerStr = block.substring(0, nullIdx);
    const fileStr = block.substring(nullIdx + 1);
    const headerParts = headerStr.split("\x1f");

    if (headerParts.length >= 6) {
      const files: GitLogFile[] = [];
      const fileLines = fileStr.split("\n");
      for (const line of fileLines) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        const status = parts[0]?.trim() || "";
        if (!status) continue;
        if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
          files.push({ status: status[0], oldPath: parts[1].trim(), path: parts[2].trim() });
        } else if (parts[1]?.trim()) {
          files.push({ status: status[0], path: parts[1].trim() });
        }
      }

      entries.push({
        hash: headerParts[0].trim(),
        shortHash: headerParts[1].trim(),
        author: headerParts[2].trim(),
        date: headerParts[3].trim(),
        refs: parseGitRefs(headerParts[4]),
        message: headerParts.slice(5).join("\x1f").replace(/\n+$/, "").trim(),
        files,
      });
    }
  }

  return entries;
}

async function runGitLogQuery(projectRoot: string, count: number, extraArgs: string[] = []): Promise<GitLogEntry[]> {
  const { stdout } = await gitExec(projectRoot, [
    "log",
    `--max-count=${count}`,
    "--name-status",
    `--format=${GIT_LOG_FORMAT}`,
    ...extraArgs,
  ]);
  return parseGitLogStdout(stdout);
}

async function runGitLogQuerySafe(projectRoot: string, count: number, extraArgs: string[] = []): Promise<GitLogEntry[]> {
  try {
    return await runGitLogQuery(projectRoot, count, extraArgs);
  } catch {
    return [];
  }
}

async function tryResolveCommitHash(projectRoot: string, query: string): Promise<string | null> {
  if (!/^[0-9a-fA-F]{4,40}$/.test(query)) return null;
  try {
    const { stdout } = await gitExec(projectRoot, ["rev-parse", "--verify", `${query}^{commit}`]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function mergeGitLogEntries(lists: GitLogEntry[][], count: number): GitLogEntry[] {
  const seen = new Set<string>();
  const merged: GitLogEntry[] = [];
  for (const list of lists) {
    for (const entry of list) {
      if (seen.has(entry.hash)) continue;
      seen.add(entry.hash);
      merged.push(entry);
    }
  }
  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return merged.slice(0, count);
}

export async function gitLog(projectRoot: string, count = 20, search?: string): Promise<GitLogResult> {
  try {
    const trimmed = search?.trim();
    if (!trimmed) {
      const entries = await runGitLogQuery(projectRoot, count);
      return { ok: true, entries };
    }

    const queries: Promise<GitLogEntry[]>[] = [
      runGitLogQuerySafe(projectRoot, count, ["-i", "--grep", trimmed]),
      runGitLogQuerySafe(projectRoot, count, ["-i", "--author", trimmed]),
    ];

    const resolvedHash = await tryResolveCommitHash(projectRoot, trimmed);
    if (resolvedHash) {
      queries.push(runGitLogQuerySafe(projectRoot, count, [resolvedHash]));
    }

    const entries = mergeGitLogEntries(await Promise.all(queries), count);
    return { ok: true, entries };
  } catch (error) {
    return { ok: false, entries: [], error: error instanceof Error ? error.message : "获取提交历史失败" };
  }
}

export interface GitAheadCommitsResult {
  ok: boolean;
  entries: GitLogEntry[];
  trackingBranch: string;
  error?: string;
}

export async function gitAheadCommits(projectRoot: string, count = 20): Promise<GitAheadCommitsResult> {
  try {
    // 先获取 tracking branch
    let trackingBranch = "";
    try {
      const { stdout: tbOut } = await gitExec(projectRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
      trackingBranch = tbOut.trim();
    } catch {
      return { ok: true, entries: [], trackingBranch: "" };
    }

    if (!trackingBranch) {
      return { ok: true, entries: [], trackingBranch: "" };
    }

    // 获取 ahead 的提交记录（本地有但远程没有的）
    const { stdout } = await gitExec(projectRoot, [
      "log",
      `${trackingBranch}..HEAD`,
      `--max-count=${count}`,
      "--name-status",
      "--format=%x1e%H%x1f%h%x1f%an%x1f%ai%x1f%d%x1f%B%x00",
    ]);

    const entries: GitLogEntry[] = [];
    const blocks = stdout.split("\x1e").filter((block) => block.trim());

    for (const block of blocks) {
      const nullIdx = block.indexOf("\x00");
      if (nullIdx === -1) continue;

      const headerStr = block.substring(0, nullIdx);
      const fileStr = block.substring(nullIdx + 1);
      const headerParts = headerStr.split("\x1f");

      if (headerParts.length >= 6) {
        const files: GitLogFile[] = [];
        const fileLines = fileStr.split("\n");
        for (const line of fileLines) {
          if (!line.trim()) continue;
          const parts = line.split("\t");
          const status = parts[0]?.trim() || "";
          if (!status) continue;
          if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
            files.push({ status: status[0], oldPath: parts[1].trim(), path: parts[2].trim() });
          } else if (parts[1]?.trim()) {
            files.push({ status: status[0], path: parts[1].trim() });
          }
        }

        entries.push({
          hash: headerParts[0].trim(),
          shortHash: headerParts[1].trim(),
          author: headerParts[2].trim(),
          date: headerParts[3].trim(),
          refs: parseGitRefs(headerParts[4]),
          message: headerParts.slice(5).join("\x1f").replace(/\n+$/, "").trim(),
          files,
        });
      }
    }

    return { ok: true, entries, trackingBranch };
  } catch (error) {
    return { ok: false, entries: [], trackingBranch: "", error: error instanceof Error ? error.message : "获取待推送提交失败" };
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
      const tracked = await gitExec(projectRoot, ["ls-files", "--error-unmatch", "--", file]).then(() => true).catch(() => false);
      if (tracked) {
        await gitExec(projectRoot, ["checkout", "--", file]);
      } else {
        await gitExec(projectRoot, ["clean", "-fd", "--", file]);
      }
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

export interface GitRemoteInfo {
  name: string;
  url: string;
}

export interface GitRemotesResult {
  ok: boolean;
  remotes: GitRemoteInfo[];
  trackingBranch: string;
  ahead: number;
  behind: number;
  error?: string;
}

export interface GitRemoteActionResult {
  ok: boolean;
  output: string;
  error?: string;
}

export async function gitRemotes(projectRoot: string): Promise<GitRemotesResult> {
  try {
    const { stdout: remoteOut } = await gitExec(projectRoot, ["remote", "-v"]);
    const remotes: GitRemoteInfo[] = [];
    const seen = new Set<string>();
    for (const line of remoteOut.split("\n")) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((push|fetch)\)/);
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        remotes.push({ name: match[1], url: match[2] });
      }
    }

    let trackingBranch = "";
    let ahead = 0;
    let behind = 0;
    try {
      const [tbOut, abOut] = await Promise.all([
        gitExec(projectRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"]).catch(() => ({ stdout: "" })),
        gitExec(projectRoot, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).catch(() => ({ stdout: "0\t0" })),
      ]);
      trackingBranch = tbOut.stdout.trim();
      const parts = abOut.stdout.trim().split(/\s+/);
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    } catch {
      // no upstream set
    }

    return { ok: true, remotes, trackingBranch, ahead, behind };
  } catch (error) {
    return { ok: false, remotes: [], trackingBranch: "", ahead: 0, behind: 0, error: error instanceof Error ? error.message : "获取远程信息失败" };
  }
}

export async function gitFetch(projectRoot: string, remote?: string): Promise<GitRemoteActionResult> {
  try {
    const args = ["fetch"];
    if (remote) args.push(remote);
    const { stdout, stderr } = await gitExec(projectRoot, args);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "Fetch 失败" };
  }
}

export async function gitPull(projectRoot: string, remote?: string, branch?: string): Promise<GitRemoteActionResult> {
  try {
    const args = ["pull"];
    if (remote && branch) {
      args.push(remote, branch);
    } else if (remote) {
      args.push(remote);
    }
    const { stdout, stderr } = await gitExec(projectRoot, args);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "Pull 失败" };
  }
}

export interface GitStashEntry {
  index: string;
  message: string;
}

export interface GitStashListResult {
  ok: boolean;
  stashes: GitStashEntry[];
  error?: string;
}

export async function gitStashList(projectRoot: string): Promise<GitStashListResult> {
  try {
    const { stdout } = await gitExec(projectRoot, ["stash", "list"]);
    const stashes: GitStashEntry[] = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(stash@\{(\d+)\}):\s*(.*)$/);
        if (!match) return null;
        return { index: match[2], message: match[3].trim() };
      })
      .filter((e): e is GitStashEntry => e !== null);
    return { ok: true, stashes };
  } catch (error) {
    return { ok: false, stashes: [], error: error instanceof Error ? error.message : "获取贮藏列表失败" };
  }
}

export interface GitStashResult {
  ok: boolean;
  output: string;
  error?: string;
}

export async function gitStashSave(projectRoot: string, message?: string): Promise<GitStashResult> {
  try {
    const args = ["stash", "push"];
    if (message?.trim()) {
      args.push("-m", message.trim());
    }
    const { stdout, stderr } = await gitExec(projectRoot, args);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "贮藏失败" };
  }
}

export async function gitStashPop(projectRoot: string, stashIndex?: number): Promise<GitStashResult> {
  try {
    const args = ["stash", "pop"];
    if (stashIndex !== undefined) {
      args.push(`stash@{${stashIndex}}`);
    }
    const { stdout, stderr } = await gitExec(projectRoot, args);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "弹出贮藏失败" };
  }
}

export async function gitStashApply(projectRoot: string, stashIndex: number): Promise<GitStashResult> {
  try {
    const { stdout, stderr } = await gitExec(projectRoot, ["stash", "apply", `stash@{${stashIndex}}`]);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "应用贮藏失败" };
  }
}

export async function gitStashDrop(projectRoot: string, stashIndex: number): Promise<GitStashResult> {
  try {
    const { stdout, stderr } = await gitExec(projectRoot, ["stash", "drop", `stash@{${stashIndex}}`]);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "删除贮藏失败" };
  }
}

export async function gitPush(projectRoot: string, remote?: string, branch?: string, setUpstream?: boolean): Promise<GitRemoteActionResult> {
  try {
    const args = ["push"];
    if (setUpstream && remote) args.push("-u");
    if (remote && branch) {
      args.push(remote, branch);
    } else if (remote) {
      args.push(remote);
    }
    const { stdout, stderr } = await gitExec(projectRoot, args);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "Push 失败" };
  }
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface GitBranchesResult {
  ok: boolean;
  branches: GitBranchInfo[];
  error?: string;
}

export async function gitListBranches(projectRoot: string): Promise<GitBranchesResult> {
  try {
    const { stdout } = await gitExec(projectRoot, ["branch", "-a", "--format=%(refname)|%(HEAD)"]);
    const branches: GitBranchInfo[] = [];
    const lines = stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const [refname, head] = line.split("|");
      const isCurrent = head?.trim() === "*";
      if (refname.startsWith("refs/heads/")) {
        const name = refname.slice("refs/heads/".length);
        branches.push({ name, isCurrent, isRemote: false });
      } else if (refname.startsWith("refs/remotes/")) {
        const name = refname.slice("refs/remotes/".length);
        // Skip HEAD pointer tracking
        if (name.includes("/HEAD") || name.includes("->")) continue;
        branches.push({ name, isCurrent, isRemote: true });
      }
    }
    return { ok: true, branches };
  } catch (error) {
    return { ok: false, branches: [], error: error instanceof Error ? error.message : "获取分支列表失败" };
  }
}

export async function gitCheckoutBranch(
  projectRoot: string,
  branchName: string,
  createNew = false,
  startPoint?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const args = ["checkout"];
    if (createNew) {
      args.push("-b", branchName);
      if (startPoint) {
        args.push(startPoint);
      }
    } else {
      args.push(branchName);
    }
    await gitExec(projectRoot, args);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "切换分支失败" };
  }
}

export async function gitDeleteBranch(
  projectRoot: string,
  branchName: string,
  force = false,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const args = [force ? "-D" : "-d", branchName];
    await gitExec(projectRoot, ["branch", ...args]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "删除分支失败" };
  }
}
