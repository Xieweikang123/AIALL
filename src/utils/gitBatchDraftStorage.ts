import type { AiBatchGroupItem } from "../services/vibeGitClient";
import { lsGetJson, lsRemove, lsSetJson } from "./localStorageSafe";

export type GitBatchDraft = {
  unstagedPaths: string[];
  groups: AiBatchGroupItem[] | null;
  messages: string[];
  sectionOpen: boolean;
};

function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/\\/g, "/").replace(/\/$/, "");
}

export function gitBatchDraftStorageKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);
  return `vibe-git-batch-draft-${normalized || "__global"}`;
}

export function readGitBatchDraft(projectPath: string): GitBatchDraft | null {
  const key = gitBatchDraftStorageKey(projectPath);
  const draft = lsGetJson<GitBatchDraft>(key);
  if (!draft || !Array.isArray(draft.unstagedPaths) || !Array.isArray(draft.messages)) {
    return null;
  }
  if (draft.groups !== null && !Array.isArray(draft.groups)) {
    return null;
  }
  return {
    unstagedPaths: draft.unstagedPaths,
    groups: draft.groups,
    messages: draft.messages,
    sectionOpen: Boolean(draft.sectionOpen),
  };
}

export function writeGitBatchDraft(projectPath: string, draft: GitBatchDraft): void {
  if (!normalizeProjectPath(projectPath)) return;
  lsSetJson(gitBatchDraftStorageKey(projectPath), draft);
}

export function removeGitBatchDraft(projectPath: string): void {
  lsRemove(gitBatchDraftStorageKey(projectPath));
}

export function pathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function sortedUnstagedPaths(paths: string[]): string[] {
  return [...paths].sort();
}
