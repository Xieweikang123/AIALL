import { gitDiff, gitDiffFile, gitStatus, type GitStatusFile, type GitStatusResult } from "./vibeGit";

const MAX_PATCH_CHARS = 8000;

export type GitVirtualPath = {
  kind: "index" | "history";
  relative: string;
};

/** Parse editor virtual paths such as git-index://path or git-index:/path. */
export function parseGitVirtualPath(inputPath: string): GitVirtualPath | null {
  const trimmed = String(inputPath || "").trim();
  if (!trimmed) return null;
  const indexMatch = trimmed.match(/^git-index:\/*(.+)$/i);
  if (indexMatch?.[1]) {
    return { kind: "index", relative: indexMatch[1].replace(/\\/g, "/").trim() };
  }
  const historyMatch = trimmed.match(/^git-history:\/*(.+)$/i);
  if (historyMatch?.[1]) {
    return { kind: "history", relative: historyMatch[1].replace(/\\/g, "/").trim() };
  }
  return null;
}

function statusLabel(file: GitStatusFile): string {
  const code = file.staged ? file.indexStatus : file.worktreeStatus;
  if (file.status === "untracked") return "??";
  if (file.status === "ignored") return "!!";
  return code.trim() || file.status.slice(0, 1).toUpperCase();
}

export function formatGitStatusForAgent(status: GitStatusResult): string {
  if (!status.ok) {
    return `错误：${status.error || "获取 Git 状态失败"}`;
  }
  const lines: string[] = [];
  lines.push(`分支：${status.branch || "（无分支）"}`);
  if (status.headCommit) lines.push(`HEAD：${status.headCommit.slice(0, 12)}`);
  if (!status.files.length) {
    lines.push("工作区干净，无待提交变更。");
    return lines.join("\n");
  }

  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => !f.staged && f.status !== "untracked" && f.status !== "ignored");
  const untracked = status.files.filter((f) => f.status === "untracked");

  if (staged.length) {
    lines.push(`已暂存（${staged.length}）：`);
    for (const f of staged) lines.push(`  ${statusLabel(f)} ${f.path}`);
  }
  if (unstaged.length) {
    lines.push(`未暂存（${unstaged.length}）：`);
    for (const f of unstaged) lines.push(`  ${statusLabel(f)} ${f.path}`);
  }
  if (untracked.length) {
    lines.push(`未跟踪（${untracked.length}）：`);
    for (const f of untracked) lines.push(`  ?? ${f.path}`);
  }
  return lines.join("\n");
}

function truncatePatch(patch: string): string {
  const trimmed = patch.trim();
  if (!trimmed) return "（无 diff 输出）";
  if (trimmed.length <= MAX_PATCH_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_PATCH_CHARS)}\n…（diff 已截断，共 ${trimmed.length} 字符）`;
}

export async function runGitStatusTool(projectRoot: string): Promise<string> {
  const status = await gitStatus(projectRoot);
  return formatGitStatusForAgent(status);
}

export async function runGitDiffTool(
  projectRoot: string,
  filePath?: string,
  staged = false,
): Promise<string> {
  const scope = staged ? "已暂存" : "未暂存/工作区";
  if (filePath) {
    const result = await gitDiffFile(projectRoot, filePath, staged);
    if (!result.ok) return `错误：${result.error || "获取 diff 失败"}`;
    const stat =
      result.files[0] != null
        ? `+${result.files[0].additions}/-${result.files[0].deletions}`
        : "";
    const header = [`文件：${filePath}`, `范围：${scope}`, stat ? `统计：${stat}` : ""].filter(Boolean).join("\n");
    return `${header}\n\n${truncatePatch(result.patch)}`;
  }

  const result = await gitDiff(projectRoot, undefined, staged);
  if (!result.ok) return `错误：${result.error || "获取 diff 失败"}`;
  if (!result.files.length && !result.patch.trim()) {
    return `（${scope} 无变更）`;
  }
  const statLines = result.files.map((f) => `  ${f.path} | +${f.additions} -${f.deletions}`);
  const header = [`范围：${scope}`, "变更文件：", ...statLines].join("\n");
  return `${header}\n\n${truncatePatch(result.patch)}`;
}
