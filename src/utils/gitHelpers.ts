/**
 * Shared Git helper functions used across Git-related components.
 */

/** Map a git status code/label to a short display icon. */
export function gitStatusIcon(status: string): string {
  switch (status) {
    case "A":
    case "added": return "A";
    case "M":
    case "modified": return "M";
    case "D":
    case "deleted": return "D";
    case "R":
    case "renamed": return "R";
    case "C":
    case "copied": return "C";
    case "untracked": return "U";
    case "conflicted": return "!";
    default: return "?";
  }
}

/** Map a git status code/label to a CSS class for coloring. */
export function gitStatusClass(status: string): string {
  switch (status) {
    case "A":
    case "added": return "git-status-added";
    case "M":
    case "modified": return "git-status-modified";
    case "D":
    case "deleted": return "git-status-deleted";
    case "R":
    case "renamed":
    case "C":
    case "copied": return "git-status-renamed";
    case "untracked": return "git-status-untracked";
    case "conflicted": return "git-status-conflicted";
    default: return "git-status-unknown";
  }
}

/** Map a git status code/label to a hex color. */
export function gitStatusColor(status: string): string {
  switch (status) {
    case "M":
    case "modified":
      return "#e2c08c";
    case "A":
    case "added":
      return "#73daca";
    case "D":
    case "deleted":
      return "#f7768e";
    case "R":
    case "renamed":
      return "#bb9af7";
    case "C":
      return "#bb9af7";
    case "untracked":
      return "#7aa2f7";
    default:
      return "#9aa5ce";
  }
}

/** Format a date string to a relative human-readable label (e.g. "3分钟前"). */
export function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;

    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

/** Format a date string to a full localized datetime string. */
export function formatFullDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

/** Split a file path into directory and basename parts. */
export function splitGitFilePath(filePath: string): { dir: string; name: string } {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return { dir: "", name: normalized };
  return { dir: normalized.slice(0, slash), name: normalized.slice(slash + 1) };
}

export type GitSelectionScope = "staged" | "unstaged";

/** Visible Git file list section (Shift 多选范围按分区，不跨区串选). */
export type GitFileListScope = "staged" | "modified" | "untracked";

export function gitFileListScopeIsStaged(scope: GitFileListScope): boolean {
  return scope === "staged";
}

/** Selection key that distinguishes the same path in staged vs changes lists. */
export function gitFileSelectionKey(path: string, staged: boolean): string {
  return `${staged ? "staged" : "unstaged"}:${path}`;
}

export function parseGitFileSelectionKey(
  key: string,
): { path: string; staged: boolean } | null {
  if (key.startsWith("staged:")) return { path: key.slice("staged:".length), staged: true };
  if (key.startsWith("unstaged:")) return { path: key.slice("unstaged:".length), staged: false };
  // Legacy plain path → treat as unstaged for highlight compatibility
  if (key.trim()) return { path: key, staged: false };
  return null;
}

/** Parse new-side start line from a unified diff hunk header (`@@ -a,b +c,d @@`).
 * Falls back to old-side start when the hunk is a pure deletion (`+0,0`). */
export function parseHunkNewStartLine(header: string): number {
  const m = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)/.exec(header.trim());
  if (!m) return 0;
  const neu = Number(m[2]);
  if (Number.isFinite(neu) && neu > 0) return neu;
  const old = Number(m[1]);
  return Number.isFinite(old) && old > 0 ? old : 0;
}
