import { invoke, Channel } from "@tauri-apps/api/core";
import { backendUrl } from "./backendBase";
import { invokeBackend, isTauriEnv } from "./tauriInvoke";
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
  headCommit?: string;
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

export interface GitActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

export interface GitGenerateMessageResult {
  ok: boolean;
  message: string;
  error?: string;
}

export interface AiBatchGroupItem {
  name: string;
  files: string[];
  message: string;
}

export interface AiBatchGroupsResult {
  ok: boolean;
  groups: AiBatchGroupItem[];
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
  return invokeBackend<GitStatusResult>("git_status", { path: projectPath }, async () => {
    try {
      const url = backendUrl(`/backend/vibe/git/status?path=${encodeURIComponent(projectPath)}`);
      const response = await fetch(url, { signal: gitStatusFetchSignal(30_000) });
      return await readJsonResponse<GitStatusResult>(response);
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return { ok: false, branch: "", files: [], stagedCount: 0, unstagedCount: 0, isRepo: false, error: "获取 Git 状态超时，请点刷新重试" };
      }
      return { ok: false, branch: "", files: [], stagedCount: 0, unstagedCount: 0, isRepo: false, error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export type GitChangedSinceResult = {
  ok: boolean;
  files: string[];
  error?: string;
};

export async function fetchGitChangedSince(
  projectPath: string,
  sinceCommit: string,
): Promise<GitChangedSinceResult> {
  const trimmedPath = projectPath.trim();
  const since = sinceCommit.trim();
  if (!trimmedPath || !since) {
    return { ok: false, files: [], error: "缺少 path 或 since" };
  }
  return invokeBackend<GitChangedSinceResult>("git_changed_since", { path: trimmedPath, since }, async () => {
    try {
      const url = backendUrl(`/backend/vibe/git/changed-since?path=${encodeURIComponent(trimmedPath)}&since=${encodeURIComponent(since)}`);
      const response = await fetch(url, { signal: gitStatusFetchSignal(30_000) });
      return await readJsonResponse<GitChangedSinceResult>(response);
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return { ok: false, files: [], error: "获取变更文件超时" };
      }
      return { ok: false, files: [], error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function fetchGitDiff(projectPath: string, filePath?: string, staged = false): Promise<GitDiffResult> {
  return invokeBackend<GitDiffResult>("git_diff", { path: projectPath, staged, file: filePath || null }, async () => {
    try {
      let url = backendUrl(`/backend/vibe/git/diff?path=${encodeURIComponent(projectPath)}`);
      if (filePath) url += `&file=${encodeURIComponent(filePath)}`;
      if (staged) url += "&staged=1";
      const response = await fetch(url);
      return await readJsonResponse<GitDiffResult>(response);
    } catch (error) {
      return { ok: false, files: [], patch: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function fetchGitDiffContent(
  projectPath: string,
  filePath: string,
  staged = false,
  signal?: AbortSignal,
): Promise<GitDiffContentResult> {
  if (filePath.endsWith('/')) {
    return { ok: true, before: '', after: '' };
  }
  return invokeBackend<GitDiffContentResult>("git_diff_content", { path: projectPath, file: filePath, staged }, async () => {
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
  });
}

export async function commitGitChanges(projectPath: string, message: string): Promise<GitCommitResult> {
  return invokeBackend<GitCommitResult>("git_commit", { path: projectPath, message }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/commit"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, message }),
      });
      return await readJsonResponse<GitCommitResult>(response);
    } catch (error) {
      return { ok: false, hash: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function fetchGitLog(projectPath: string, count = 20, search?: string): Promise<GitLogResult> {
  return invokeBackend<GitLogResult>("git_log", { path: projectPath, count, search: search?.trim() || null }, async () => {
    try {
      let url = backendUrl(`/backend/vibe/git/log?path=${encodeURIComponent(projectPath)}&count=${count}`);
      if (search?.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
      const response = await fetch(url);
      const data = await readJsonResponse<GitLogResult>(response);
      return { ...data, entries: data.entries?.map((entry) => ({ ...entry, files: entry.files || [] })) || [] };
    } catch (error) {
      return { ok: false, entries: [], error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export interface GitAheadCommitsResult {
  ok: boolean;
  entries: GitLogEntry[];
  trackingBranch: string;
  error?: string;
}

export async function fetchAheadCommits(projectPath: string, count = 20): Promise<GitAheadCommitsResult> {
  return invokeBackend<GitAheadCommitsResult>("git_ahead_commits", { path: projectPath, count }, async () => {
    try {
      const url = backendUrl(`/backend/vibe/git/ahead-commits?path=${encodeURIComponent(projectPath)}&count=${count}`);
      const response = await fetch(url);
      const data = await readJsonResponse<GitAheadCommitsResult>(response);
      return { ...data, entries: data.entries?.map((entry) => ({ ...entry, files: entry.files || [] })) || [] };
    } catch (error) {
      return { ok: false, entries: [], trackingBranch: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function fetchGitCommitFileDiff(projectPath: string, hash: string, filePath: string, oldPath?: string): Promise<GitCommitFileDiffResult> {
  return invokeBackend<GitCommitFileDiffResult>("git_commit_file_diff", { path: projectPath, hash, file: filePath, oldFile: oldPath || null }, async () => {
    try {
      let url = backendUrl(`/backend/vibe/git/commit-file-diff?path=${encodeURIComponent(projectPath)}&hash=${encodeURIComponent(hash)}&file=${encodeURIComponent(filePath)}`);
      if (oldPath) url += `&oldFile=${encodeURIComponent(oldPath)}`;
      const response = await fetch(url);
      return await readJsonResponse<GitCommitFileDiffResult>(response);
    } catch (error) {
      return { ok: false, before: "", after: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function stageGitFiles(projectPath: string, files: string[]): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_add", { path: projectPath, files }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/add"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, files }),
      });
      return await readJsonResponse<GitActionResult>(response);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export interface GitHunkInfo {
  index: number;
  header: string;
  preview: string;
}

export interface GitHunksResult {
  ok: boolean;
  hunks: GitHunkInfo[];
  error?: string;
}

export async function fetchGitHunks(
  projectPath: string,
  filePath: string,
  staged = false,
): Promise<GitHunksResult> {
  return invokeBackend<GitHunksResult>(
    "git_list_hunks",
    { path: projectPath, file: filePath, staged },
    async () => {
      return { ok: false, hunks: [], error: "桌面版可用" };
    },
  );
}

export async function stageGitHunk(
  projectPath: string,
  filePath: string,
  hunkIndex: number,
): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>(
    "git_stage_hunk",
    { path: projectPath, file: filePath, hunkIndex },
    async () => ({ ok: false, error: "桌面版可用" }),
  );
}

export async function unstageGitHunk(
  projectPath: string,
  filePath: string,
  hunkIndex: number,
): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>(
    "git_unstage_hunk",
    { path: projectPath, file: filePath, hunkIndex },
    async () => ({ ok: false, error: "桌面版可用" }),
  );
}

export async function unstageGitFiles(projectPath: string, files: string[]): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_reset", { path: projectPath, files }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/reset"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, files }),
      });
      return await readJsonResponse<GitActionResult>(response);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export type GitResetMode = "soft" | "mixed" | "hard";

export async function gitResetToCommit(
  projectPath: string,
  commit: string,
  mode: GitResetMode = "mixed",
): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>(
    "git_reset_to_commit",
    { path: projectPath, commit, mode },
    async () => {
      try {
        const response = await fetch(backendUrl("/backend/vibe/git/reset-to-commit"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: projectPath, commit, mode }),
        });
        return await readJsonResponse<GitActionResult>(response);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
      }
    },
  );
}

export type GitConflictSide = "ours" | "theirs";

export async function gitResolveConflict(
  projectPath: string,
  file: string,
  side: GitConflictSide,
): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>(
    "git_resolve_conflict",
    { path: projectPath, file, side },
    async () => {
      try {
        const response = await fetch(backendUrl("/backend/vibe/git/resolve-conflict"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: projectPath, file, side }),
        });
        return await readJsonResponse<GitActionResult>(response);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
      }
    },
  );
}

export async function discardGitFiles(projectPath: string, files: string[]): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_discard", { path: projectPath, files }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/discard"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, files }),
      });
      return await readJsonResponse<GitActionResult>(response);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function generateCommitMessage(
  projectPath: string,
  endpoint: string,
  apiKey: string,
  model: string,
  onDelta: (text: string) => void,
): Promise<GitGenerateMessageResult> {
  const httpFallback = async (): Promise<GitGenerateMessageResult> => {
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
      return readJsonResponse<GitGenerateMessageResult>(response);
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
  };

  if (!isTauriEnv()) {
    return httpFallback();
  }

  return new Promise<GitGenerateMessageResult>((resolve) => {
    const channel = new Channel<{ type: string; data: { text?: string; message?: string; error?: string } }>();
    channel.onmessage = (event) => {
      switch (event.type) {
        case "delta":
          if (event.data?.text) onDelta(event.data.text);
          break;
        case "done":
          resolve({ ok: true, message: event.data?.message || "" });
          break;
        case "error":
          resolve({ ok: false, message: "", error: event.data?.error || "AI 请求失败" });
          break;
      }
    };
    invoke("git_generate_message", {
      path: projectPath,
      endpoint,
      apiKey,
      model,
      onEvent: channel,
    }).catch((err: unknown) => {
      resolve({ ok: false, message: "", error: err instanceof Error ? err.message : "Tauri invoke 失败" });
    });
  });
}

export async function aiBatchGroups(
  projectPath: string,
  endpoint: string,
  apiKey: string,
  model: string,
  onDelta?: (text: string) => void,
  onProgress?: (step: string) => void,
): Promise<AiBatchGroupsResult> {
  /** Client watchdog — covers total stall including model stream. */
  const CLIENT_TIMEOUT_MS = 180_000;
  /** If Rust never leaves the git-summary phase (e.g. hung teardown), fail fast on UI. */
  const SUMMARY_STALL_MS = 45_000;

  // Tauri: use Channel for streaming
  if (isTauriEnv()) {
    return new Promise<AiBatchGroupsResult>((resolve) => {
      let settled = false;
      let sawModelPhase = false;
      const settle = (result: AiBatchGroupsResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        clearTimeout(summaryStall);
        resolve(result);
      };
      const watchdog = setTimeout(() => {
        settle({
          ok: false,
          groups: [],
          error: "AI 划分超时（超过 3 分钟）。可减少变更文件后重试，或检查模型服务是否可用。",
        });
      }, CLIENT_TIMEOUT_MS);
      const summaryStall = setTimeout(() => {
        if (settled || sawModelPhase) return;
        settle({
          ok: false,
          groups: [],
          error: "读取变更摘要超时。请重试；若仍失败可先手动分组提交。",
        });
      }, SUMMARY_STALL_MS);

      const channel = new Channel<{ type: string; data: { text?: string; step?: string; groups?: AiBatchGroupItem[]; error?: string; message?: string } }>();
      channel.onmessage = (event) => {
        switch (event.type) {
          case "progress":
            if (event.data?.step && onProgress) {
              const step = event.data.step;
              if (
                step.includes("请求模型") ||
                step.includes("等待模型") ||
                step.includes("模型输出") ||
                step.includes("改用文件列表") ||
                step.includes("整理上下文") ||
                step.includes("读取变更摘要")
              ) {
                sawModelPhase = true;
                clearTimeout(summaryStall);
              }
              onProgress(step);
            }
            break;
          case "delta":
            sawModelPhase = true;
            clearTimeout(summaryStall);
            if (event.data?.text && onDelta) onDelta(event.data.text);
            break;
          case "done":
            settle({ ok: true, groups: event.data?.groups || [] });
            break;
          case "error":
            settle({ ok: false, groups: [], error: event.data?.error || "AI 请求失败" });
            break;
        }
      };
      invoke("git_ai_batch_groups", { path: projectPath, endpoint, apiKey, model, onEvent: channel }).catch((err: unknown) => {
        settle({ ok: false, groups: [], error: err instanceof Error ? err.message : "Tauri invoke 失败" });
      });
    });
  }

  try {
    const response = await fetch(backendUrl("/backend/vibe/git/ai-batch-groups"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath, endpoint, apiKey, model }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        return { ok: false, groups: [], error: parsed.error || parsed.message || `请求失败，HTTP ${response.status}` };
      } catch {
        return { ok: false, groups: [], error: text || `请求失败，HTTP ${response.status}` };
      }
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const data = await readJsonResponse<AiBatchGroupsResult>(response);
      return data;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finalGroups: AiBatchGroupItem[] = [];
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("event: ")) { currentEvent = trimmed.slice(7).trim(); continue; }
        if (trimmed.startsWith("data: ")) {
          const raw = trimmed.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const parsed = JSON.parse(raw) as { text?: string; step?: string; groups?: AiBatchGroupItem[]; error?: string; message?: string };
            if (currentEvent === "progress" && parsed.step && onProgress) onProgress(parsed.step);
            else if (currentEvent === "delta" && parsed.text && onDelta) onDelta(parsed.text);
            else if (currentEvent === "done" && parsed.groups) finalGroups = parsed.groups;
            else if (currentEvent === "error") return { ok: false, groups: [], error: parsed.error || parsed.message || "AI 请求失败" };
          } catch {
            // skip malformed JSON lines from SSE stream
          }
          currentEvent = "";
        }
      }
    }
    return { ok: true, groups: finalGroups };
  } catch (error) {
    return { ok: false, groups: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function fetchGitRemotes(projectPath: string): Promise<GitRemotesResult> {
  return invokeBackend<GitRemotesResult>("git_remotes", { path: projectPath }, async () => {
    try {
      const url = backendUrl(`/backend/vibe/git/remotes?path=${encodeURIComponent(projectPath)}`);
      const response = await fetch(url);
      return await readJsonResponse<GitRemotesResult>(response);
    } catch (error) {
      return { ok: false, remotes: [], trackingBranch: "", ahead: 0, behind: 0, error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitFetchRemote(projectPath: string, remote?: string): Promise<GitRemoteActionResult> {
  return invokeBackend<GitRemoteActionResult>("git_fetch", { path: projectPath, remote: remote || null }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/fetch"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, remote }),
      });
      return await readJsonResponse<GitRemoteActionResult>(response);
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitPullRemote(projectPath: string, remote?: string, branch?: string): Promise<GitRemoteActionResult> {
  return invokeBackend<GitRemoteActionResult>("git_pull", { path: projectPath, remote: remote || null, branch: branch || null }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/pull"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, remote, branch }),
      });
      return await readJsonResponse<GitRemoteActionResult>(response);
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitPushRemote(projectPath: string, remote?: string, branch?: string, setUpstream?: boolean): Promise<GitRemoteActionResult> {
  return invokeBackend<GitRemoteActionResult>("git_push", { path: projectPath, remote: remote || null, branch: branch || null, setUpstream }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/push"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, remote, branch, setUpstream }),
      });
      return await readJsonResponse<GitRemoteActionResult>(response);
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
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
  return invokeBackend<GitStashListResult>("git_stash_list", { path: projectPath }, async () => {
    try {
      const url = backendUrl(`/backend/vibe/git/stash-list?path=${encodeURIComponent(projectPath)}`);
      const response = await fetch(url);
      return await readJsonResponse<GitStashListResult>(response);
    } catch (error) {
      return { ok: false, stashes: [], error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitStashSaveRemote(projectPath: string, message?: string): Promise<GitStashResult> {
  return invokeBackend<GitStashResult>("git_stash_save", { path: projectPath, message: message || null }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/stash-save"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, message }),
      });
      return await readJsonResponse<GitStashResult>(response);
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitStashPopRemote(projectPath: string, stashIndex?: number): Promise<GitStashResult> {
  return invokeBackend<GitStashResult>("git_stash_pop", { path: projectPath, stash_index: stashIndex }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/stash-pop"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, stashIndex }),
      });
      return await readJsonResponse<GitStashResult>(response);
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitStashApplyRemote(projectPath: string, stashIndex: number): Promise<GitStashResult> {
  return invokeBackend<GitStashResult>("git_stash_apply", { path: projectPath, stash_index: stashIndex }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/stash-apply"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, stashIndex }),
      });
      return await readJsonResponse<GitStashResult>(response);
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitStashDropRemote(projectPath: string, stashIndex: number): Promise<GitStashResult> {
  return invokeBackend<GitStashResult>("git_stash_drop", { path: projectPath, stash_index: stashIndex }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/stash-drop"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, stashIndex }),
      });
      return await readJsonResponse<GitStashResult>(response);
    } catch (error) {
      return { ok: false, output: "", error: error instanceof Error ? error.message : "网络错误" };
    }
  });
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

export async function fetchGitBranches(projectPath: string): Promise<GitBranchesResult> {
  return invokeBackend<GitBranchesResult>("git_branches", { path: projectPath }, async () => {
    try {
      const url = backendUrl(`/backend/vibe/git/branches?path=${encodeURIComponent(projectPath)}`);
      const response = await fetch(url);
      return await readJsonResponse<GitBranchesResult>(response);
    } catch (error) {
      return { ok: false, branches: [], error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitCheckoutBranch(projectPath: string, branchName: string, createNew = false, startPoint?: string): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_checkout", { path: projectPath, branch: branchName, createNew, startPoint: startPoint || null }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/checkout"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, branch: branchName, createNew, startPoint }),
      });
      return await readJsonResponse<GitActionResult>(response);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export async function gitDeleteBranch(projectPath: string, branchName: string, force = false): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_branch_delete", { path: projectPath, branch: branchName, force }, async () => {
    try {
      const response = await fetch(backendUrl("/backend/vibe/git/branch/delete"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, branch: branchName, force }),
      });
      return await readJsonResponse<GitActionResult>(response);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
    }
  });
}

export interface GitOpStateResult {
  ok: boolean;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  error?: string;
}

export async function fetchGitOpState(projectPath: string): Promise<GitOpStateResult> {
  return invokeBackend<GitOpStateResult>("git_op_state", { path: projectPath }, async () => ({
    ok: true,
    mergeInProgress: false,
    rebaseInProgress: false,
  }));
}

export async function gitMerge(projectPath: string, branch: string): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_merge", { path: projectPath, branch }, async () => ({
    ok: false,
    error: "仅桌面版支持 merge",
  }));
}

export async function gitMergeAbort(projectPath: string): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_merge_abort", { path: projectPath }, async () => ({
    ok: false,
    error: "仅桌面版支持",
  }));
}

export async function gitRebase(projectPath: string, onto: string): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_rebase", { path: projectPath, onto }, async () => ({
    ok: false,
    error: "仅桌面版支持 rebase",
  }));
}

export async function gitRebaseAbort(projectPath: string): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_rebase_abort", { path: projectPath }, async () => ({
    ok: false,
    error: "仅桌面版支持",
  }));
}

export async function gitCherryPick(projectPath: string, commit: string): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_cherry_pick", { path: projectPath, commit }, async () => ({
    ok: false,
    error: "仅桌面版支持 cherry-pick",
  }));
}

export async function gitRevertCommit(projectPath: string, commit: string): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_revert_commit", { path: projectPath, commit }, async () => ({
    ok: false,
    error: "仅桌面版支持 revert",
  }));
}

export interface GitTagInfo {
  name: string;
  commit: string;
}

export interface GitTagsResult {
  ok: boolean;
  tags: GitTagInfo[];
  error?: string;
}

export async function fetchGitTags(projectPath: string): Promise<GitTagsResult> {
  return invokeBackend<GitTagsResult>("git_tag_list", { path: projectPath }, async () => ({
    ok: true,
    tags: [],
  }));
}

export async function gitTagCreate(
  projectPath: string,
  name: string,
  commit?: string,
  message?: string,
): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>(
    "git_tag_create",
    { path: projectPath, name, commit: commit || null, message: message || null },
    async () => ({ ok: false, error: "仅桌面版支持 tag" }),
  );
}

export async function gitTagDelete(projectPath: string, name: string): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>("git_tag_delete", { path: projectPath, name }, async () => ({
    ok: false,
    error: "仅桌面版支持",
  }));
}

export interface GitSubmoduleInfo {
  path: string;
  status: string;
  sha: string;
}

export interface GitSubmodulesResult {
  ok: boolean;
  submodules: GitSubmoduleInfo[];
  error?: string;
}

export async function fetchGitSubmodules(projectPath: string): Promise<GitSubmodulesResult> {
  return invokeBackend<GitSubmodulesResult>("git_submodule_status", { path: projectPath }, async () => ({
    ok: true,
    submodules: [],
  }));
}

export async function gitSubmoduleUpdate(projectPath: string, init = true): Promise<GitActionResult> {
  return invokeBackend<GitActionResult>(
    "git_submodule_update",
    { path: projectPath, init },
    async () => ({ ok: false, error: "仅桌面版支持 submodule" }),
  );
}

