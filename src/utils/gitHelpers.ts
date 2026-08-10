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
    case "ignoredLocal": return "≡";
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
    case "ignoredLocal": return "git-status-ignored-local";
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
export type GitFileListScope = "staged" | "modified" | "untracked" | "ignored-local";

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

/** Drop selection keys that no longer match a file on that staged/unstaged side. */
export function pruneGitFileSelection(
  selected: string[],
  files: Array<{ path: string; staged: boolean }>,
): string[] {
  if (!selected.length) return selected;
  const valid = new Set(files.map((f) => gitFileSelectionKey(f.path, f.staged)));
  return selected.filter((key) => {
    const parsed = parseGitFileSelectionKey(key);
    if (!parsed) return false;
    return valid.has(gitFileSelectionKey(parsed.path, parsed.staged));
  });
}

/** Parse new-side start + line count from a unified diff hunk header.
 * `count` is 0 for a pure-deletion hunk (`+0,0`). */
export function parseHunkNewRange(header: string): { start: number; count: number } {
  const m = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,(\d+))?/.exec(header.trim());
  if (!m) return { start: 0, count: 0 };
  const neu = Number(m[2]);
  const count = m[3] === undefined ? 1 : Number(m[3]);
  if (Number.isFinite(neu) && neu > 0) {
    return { start: neu, count: Number.isFinite(count) && count > 0 ? count : 0 };
  }
  const old = Number(m[1]);
  return { start: Number.isFinite(old) && old > 0 ? old : 0, count: 0 };
}
