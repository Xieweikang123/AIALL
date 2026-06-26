const NOISE_TOP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
]);
const NOISE_TOP_DOT_DIRS = new Set([
  ".aiall",
  ".github",
  ".vscode",
  ".husky",
  ".git",
]);

const NOISE_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  ".gitignore",
]);

const NOISE_SUFFIXES = [".min.js", ".min.css"];

/** Drop paths that should not drive knowledge-base change exploration. */
export function filterKnowledgeChangePaths(files: string[]): string[] {
  return files.filter((raw) => {
    const path = raw.trim().replace(/\\/g, "/");
    if (!path) return false;
    if (NOISE_FILENAMES.has(path)) return false;
    if (NOISE_SUFFIXES.some((s) => path.endsWith(s))) return false;
    if (/^[^/]+\.md$/i.test(path)) return false;
    const segments = path.split("/");
    if (segments.length < 2) return true;
    for (const seg of segments.slice(0, -1)) {
      if (NOISE_TOP_DIRS.has(seg) || NOISE_TOP_DOT_DIRS.has(seg)) return false;
    }
    return true;
  });
}

export const KNOWLEDGE_CHANGES_LIST_MAX = 8;

export function summarizeKnowledgeChanges(
  files: string[],
  options?: { knowledgeStale?: boolean },
): string {
  if (files.length > 0) {
    return `变更 ${files.length} 个文件`;
  }
  if (options?.knowledgeStale) {
    return "已有新提交";
  }
  return "";
}
