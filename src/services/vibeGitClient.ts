import { backendUrl } from "./backendBase";
import { readJsonResponse } from "./vibeCodingClient";

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

export interface GitDiffContentResult {
  ok: boolean;
  before: string;
  after: string;
  error?: string;
}

export interface GitCommitFileDiffResult {
  ok: boolean;
  before: string;
  after: string;
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
  files: GitLogFile[];
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

export interface GitActionResult {
  ok: boolean;
  error?: string;
}

export interface GitGenerateMessageResult {
  ok: boolean;
  message: string;
  error?: string;
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

function gitStatusFetchSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export async function fetchGitStatus(projectPath: string): Promise<GitStatusResult> {
  try {
    const url = backendUrl(`/backend/vibe/git/status?path=${encodeURIComponent(projectPath)}`);
    const response = await fetch(url, { signal: gitStatusFetchSignal(30_000) });
    return await readJsonResponse<GitStatusResult>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return {
        ok: false,
        branch: "",
        files: [],
        stagedCount: 0,
        unstagedCount: 0,
        isRepo: false,
        error: "获取 Git 状态超时，请点刷新重试",
      };
    }
    return { ok: false, branch: "", files: [], stagedCount: 0, unstagedCount: 0, isRepo: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function fetchGitDiff(projectPath: string, filePath?: string, staged = false): Promise<GitDiffResult> {
  try {
    let url = backendUrl(`/backend/vibe/git/diff?path=${encodeURIComponent(projectPath)}`);
    if (filePath) url += `&file=${encodeURIComponent(filePath)}`;
    if (staged) url += "&staged=1";
    const response = await fetch(url);
    return await readJsonResponse<GitDiffResult>(response);
  } catch (error) {
    return { ok: false, files: [], patch: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function fetchGitDiffContent(
  projectPath: string,
  filePath: string,
  staged = false,
  signal?: AbortSignal,
): Promise<GitDiffContentResult> {
  try {
    const stagedParam = staged ? "&staged=1" : "";
    const url = backendUrl(`/backend/vibe/git/diff-content?path=${encodeURIComponent(projectPath)}&file=${encodeURIComponent(filePath)}${stagedParam}`);
    const response = await fetch(url, { signal });
    return await readJsonResponse<GitDiffContentResult>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, before: "", after: "", error: "已取消" };
    }
    return { ok: false, before: "", after: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function commitGitChanges(projectPath: string, message: string): Promise<GitCommitResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/commit"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, message }),
    });
    return await readJsonResponse<GitCommitResult>(response);
  } catch (error) {
    return { ok: false, hash: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function fetchGitLog(projectPath: string, count = 20): Promise<GitLogResult> {
  try {
    const url = backendUrl(`/backend/vibe/git/log?path=${encodeURIComponent(projectPath)}&count=${count}`);
    const response = await fetch(url);
    const data = await readJsonResponse<GitLogResult>(response);
    return { ...data, entries: data.entries?.map((entry) => ({ ...entry, files: entry.files || [] })) || [] };
  } catch (error) {
    return { ok: false, entries: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function fetchGitCommitFileDiff(
  projectPath: string,
  hash: string,
  filePath: string,
  oldPath?: string,
): Promise<GitCommitFileDiffResult> {
  try {
    let url = backendUrl(`/backend/vibe/git/commit-file-diff?path=${encodeURIComponent(projectPath)}&hash=${encodeURIComponent(hash)}&file=${encodeURIComponent(filePath)}`);
    if (oldPath) url += `&oldFile=${encodeURIComponent(oldPath)}`;
    const response = await fetch(url);
    return await readJsonResponse<GitCommitFileDiffResult>(response);
  } catch (error) {
    return { ok: false, before: "", after: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function stageGitFiles(projectPath: string, files: string[]): Promise<GitActionResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/add"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, files }),
    });
    return await readJsonResponse<GitActionResult>(response);
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
    return await readJsonResponse<GitActionResult>(response);
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
    return await readJsonResponse<GitActionResult>(response);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function generateCommitMessage(
  projectPath: string,
  endpoint: string,
  apiKey: string,
  model: string,
  onDelta: (text: string) => void,
): Promise<GitGenerateMessageResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/generate-message"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, endpoint, apiKey, model }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        return { ok: false, message: "", error: parsed.error || parsed.message || `请求失败，HTTP ${response.status}` };
      } catch {
        return { ok: false, message: "", error: text || `请求失败，HTTP ${response.status}` };
      }
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const data = await readJsonResponse<GitGenerateMessageResult>(response);
      return data;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finalMessage = "";
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7).trim();
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          const raw = trimmed.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;

          try {
            const parsed = JSON.parse(raw) as { text?: string; message?: string; error?: string };
            if (currentEvent === "delta" && parsed.text) {
              onDelta(parsed.text);
            } else if (currentEvent === "done") {
              finalMessage = parsed.message || "";
            } else if (currentEvent === "error") {
              return { ok: false, message: "", error: parsed.error || "AI 请求失败" };
            }
          } catch {
            // skip malformed SSE
          }
          currentEvent = "";
        }
      }
    }

    return { ok: true, message: finalMessage };
  } catch (error) {
    return { ok: false, message: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function fetchGitRemotes(projectPath: string): Promise<GitRemotesResult> {
  try {
    const url = backendUrl(`/backend/vibe/git/remotes?path=${encodeURIComponent(projectPath)}`);
    const response = await fetch(url);
    return await readJsonResponse<GitRemotesResult>(response);
  } catch (error) {
    return { ok: false, remotes: [], trackingBranch: "", ahead: 0, behind: 0, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function gitFetchRemote(projectPath: string, remote?: string): Promise<GitRemoteActionResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/fetch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, remote }),
    });
    return await readJsonResponse<GitRemoteActionResult>(response);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function gitPullRemote(projectPath: string, remote?: string, branch?: string): Promise<GitRemoteActionResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/pull"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, remote, branch }),
    });
    return await readJsonResponse<GitRemoteActionResult>(response);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function gitPushRemote(projectPath: string, remote?: string, branch?: string, setUpstream?: boolean): Promise<GitRemoteActionResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/push"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, remote, branch, setUpstream }),
    });
    return await readJsonResponse<GitRemoteActionResult>(response);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

// ---- Stash ----

export interface GitStashEntry {
  index: string;
  message: string;
}

export interface GitStashListResult {
  ok: boolean;
  stashes: GitStashEntry[];
  error?: string;
}

export interface GitStashResult {
  ok: boolean;
  output: string;
  error?: string;
}

export async function gitStashListRemote(projectPath: string): Promise<GitStashListResult> {
  try {
    const url = backendUrl(`/backend/vibe/git/stash-list?path=${encodeURIComponent(projectPath)}`);
    const response = await fetch(url);
    return await readJsonResponse<GitStashListResult>(response);
  } catch (error) {
    return { ok: false, stashes: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function gitStashSaveRemote(projectPath: string, message?: string): Promise<GitStashResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/stash-save"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, message }),
    });
    return await readJsonResponse<GitStashResult>(response);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function gitStashPopRemote(projectPath: string, stashIndex?: number): Promise<GitStashResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/stash-pop"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, stashIndex }),
    });
    return await readJsonResponse<GitStashResult>(response);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function gitStashApplyRemote(projectPath: string, stashIndex: number): Promise<GitStashResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/stash-apply"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, stashIndex }),
    });
    return await readJsonResponse<GitStashResult>(response);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function gitStashDropRemote(projectPath: string, stashIndex: number): Promise<GitStashResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/git/stash-drop"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, stashIndex }),
    });
    return await readJsonResponse<GitStashResult>(response);
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}
