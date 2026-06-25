/** Drop paths that should not drive knowledge-base change exploration. */
export function filterKnowledgeChangePaths(files: string[]): string[] {
  return files.filter((raw) => {
    const path = raw.trim().replace(/\\/g, "/");
    if (!path || path === ".git") return false;
    if (path.startsWith(".aiall/")) return false;
    if (path.includes("/node_modules/") || path.startsWith("node_modules/")) return false;
    if (path.startsWith("dist/") || path.includes("/dist/")) return false;
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
