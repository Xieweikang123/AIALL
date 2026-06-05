import { backendUrl } from "./backendBase";

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
  isRepo: boolean;
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

export interface GitActionResult {
  ok: boolean;
  error?: string;
}

export async function fetchGitStatus(projectPath: string): Promise<GitStatusResult> {
  try {
    const url = backendUrl(`/backend/vibe/git/status?path=${encodeURIComponent(projectPath)}`);
    const response = await fetch(url);
    const data = (await response.json()) as GitStatusResult;
    return data;
  } catch (error) {
    return { ok: false, branch: "", files: [], stagedCount: 0, unstagedCount: 0, isRepo: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function fetchGitDiff(projectPath: string, filePath?: string): Promise<GitDiffResult> {
  try {
    let url = backendUrl(`/backend/vibe/git/diff?path=${encodeURIComponent(projectPath)}`);
    if (filePath) url += `&file=${encodeURIComponent(filePath)}`;
    const response = await fetch(url);
    const data = (await response.json()) as GitDiffResult;
    return data;
  } catch (error) {
    return { ok: false, files: [], patch: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function commitGitChanges(projectPath: string, message: string): Promise<GitCommitResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/commit"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, message }),
    });
    const data = (await response.json()) as GitCommitResult;
    return data;
  } catch (error) {
    return { ok: false, hash: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function fetchGitLog(projectPath: string, count = 20): Promise<GitLogResult> {
  try {
    const url = backendUrl(`/backend/vibe/git/log?path=${encodeURIComponent(projectPath)}&count=${count}`);
    const response = await fetch(url);
    const data = (await response.json()) as GitLogResult;
    return data;
  } catch (error) {
    return { ok: false, entries: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function stageGitFiles(projectPath: string, files: string[]): Promise<GitActionResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/add"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, files }),
    });
    const data = (await response.json()) as GitActionResult;
    return data;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function unstageGitFiles(projectPath: string, files: string[]): Promise<GitActionResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/reset"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, files }),
    });
    const data = (await response.json()) as GitActionResult;
    return data;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function discardGitFiles(projectPath: string, files: string[]): Promise<GitActionResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/discard"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, files }),
    });
    const data = (await response.json()) as GitActionResult;
    return data;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}
