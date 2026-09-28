import { lsGet, lsRemove, lsSet } from "./localStorageSafe";
import { normalizeProjectPath } from "./normalizePath";

/**
 * Git 提交信息框的草稿。
 *
 * 背景：`gitCommitMessage` 过去只活在内存 ref 里，手打内容或「✦ AI 生成」的结果
 * 一旦刷新就丢。这里按「提交作用域」（活跃仓库路径，无仓库时回退项目根）隔离，
 * 与 `gitBatchDraftStorage` 同一套归一化规则，避免切项目/切仓库串味。
 */

export function gitCommitDraftStorageKey(scopePath: string): string {
  return `vibe-git-commit-draft-${normalizeProjectPath(scopePath) || "__global"}`;
}

/** 读取草稿；无草稿或空串返回 ""。 */
export function readGitCommitDraft(scopePath: string): string {
  if (!scopePath.trim()) return "";
  return lsGet(gitCommitDraftStorageKey(scopePath)) ?? "";
}

/** 写入草稿；空内容直接删 key，避免存一堆空串垃圾。 */
export function writeGitCommitDraft(scopePath: string, message: string): void {
  if (!scopePath.trim()) return;
  const key = gitCommitDraftStorageKey(scopePath);
  const trimmed = message.trim();
  if (trimmed) {
    lsSet(key, trimmed);
  } else {
    lsRemove(key);
  }
}
