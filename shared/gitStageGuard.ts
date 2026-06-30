/** Root-level path segments that should not be staged (IDE/build/agent local state). */
const BLOCKED_ROOT_SEGMENTS = new Set([
  ".aiall",
  ".vs",
  "obj",
  "bin",
  "node_modules",
  ".idea",
]);

export function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isGitPathStageBlocked(filePath: string): boolean {
  const normalized = normalizeGitPath(filePath);
  if (!normalized) return false;
  const first = normalized.split("/")[0]?.toLowerCase() ?? "";
  return BLOCKED_ROOT_SEGMENTS.has(first);
}

export function filterStageableGitPaths(paths: string[]): {
  stageable: string[];
  blocked: string[];
} {
  const stageable: string[] = [];
  const blocked: string[] = [];
  const seenBlocked = new Set<string>();
  for (const p of paths) {
    if (isGitPathStageBlocked(p)) {
      const root = normalizeGitPath(p).split("/")[0] ?? p;
      const key = root.toLowerCase();
      if (!seenBlocked.has(key)) {
        seenBlocked.add(key);
        blocked.push(`${root}/`);
      }
    } else {
      stageable.push(p);
    }
  }
  return { stageable, blocked };
}

export function formatGitStageSkippedHint(blockedRoots: string[]): string {
  if (!blockedRoots.length) return "";
  const unique = [...new Set(blockedRoots.map((p) => {
    const root = normalizeGitPath(p).split("/")[0];
    return root ? `${root}/` : p;
  }))];
  return `已跳过不应提交的目录：${unique.join("、")}（建议加入 .gitignore）`;
}

export function isGitDirectoryPath(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").endsWith("/");
}

/** Whether a git status path should appear in the panel (files only; staging may still be blocked). */
export function shouldShowGitStatusPath(filePath: string): boolean {
  return !isGitDirectoryPath(filePath);
}
