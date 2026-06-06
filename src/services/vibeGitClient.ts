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

export interface GitDiffContentResult {
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

export async function fetchGitDiffContent(projectPath: string, filePath: string): Promise<GitDiffContentResult> {
  try {
    const url = backendUrl(`/backend/vibe/git/diff-content?path=${encodeURIComponent(projectPath)}&file=${encodeURIComponent(filePath)}`);
    const response = await fetch(url);
    const data = (await response.json()) as GitDiffContentResult;
    return data;
  } catch (error) {
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
      return { ok: false, message: "", error: text || `请求失败，HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const data = (await response.json()) as GitGenerateMessageResult;
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
    const data = (await response.json()) as GitRemotesResult;
    return data;
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
    const data = (await response.json()) as GitRemoteActionResult;
    return data;
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
    const data = (await response.json()) as GitRemoteActionResult;
    return data;
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
    const data = (await response.json()) as GitRemoteActionResult;
    return data;
  } catch (error) {
    return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}
