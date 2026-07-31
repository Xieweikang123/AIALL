import type { AiBatchGroupItem } from "../services/vibeGitClient";
import { lsGetJson, lsRemove, lsSetJson } from "./localStorageSafe";

export type GitBatchDraft = {
  unstagedPaths: string[];
  groups: AiBatchGroupItem[] | null;
  /** False when groups are only a recoverable preview from an interrupted AI run. */
  analysisComplete?: boolean;
  messages: string[];
  sectionOpen: boolean;
};

export function normalizeGitPath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

import { normalizeProjectPath } from "./normalizePath";

export function normalizeGitBranch(branch: string): string {
  return branch.trim().replace(/\\/g, "/").toLowerCase() || "__detached__";
}

export function gitBatchDraftStorageKey(projectPath: string, branch: string): string {
  const normalized = normalizeProjectPath(projectPath);
  const branchKey = normalizeGitBranch(branch);
  return `vibe-git-batch-draft-${normalized || "__global"}--${branchKey}`;
}

export function readGitBatchDraft(projectPath: string, branch: string): GitBatchDraft | null {
  const key = gitBatchDraftStorageKey(projectPath, branch);
  const draft = lsGetJson<GitBatchDraft>(key);
  if (!draft || !Array.isArray(draft.unstagedPaths) || !Array.isArray(draft.messages)) {
    return null;
  }
  if (draft.groups != null && !Array.isArray(draft.groups)) {
    return null;
  }
  return {
    unstagedPaths: draft.unstagedPaths.map(normalizeGitPath),
    groups: draft.groups,
    analysisComplete: draft.analysisComplete !== false,
    messages: draft.messages,
    sectionOpen: Boolean(draft.sectionOpen),
  };
}

export function writeGitBatchDraft(projectPath: string, branch: string, draft: GitBatchDraft): void {
  if (!normalizeProjectPath(projectPath)) return;
  lsSetJson(gitBatchDraftStorageKey(projectPath, branch), {
    ...draft,
    unstagedPaths: draft.unstagedPaths.map(normalizeGitPath),
  });
}

export function removeGitBatchDraft(projectPath: string, branch: string): void {
  lsRemove(gitBatchDraftStorageKey(projectPath, branch));
}

export function pathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (normalizeGitPath(a[i]) !== normalizeGitPath(b[i])) return false;
  }
  return true;
}

export function sortedUnstagedPaths(paths: string[]): string[] {
  return [...paths].map(normalizeGitPath).sort();
}
