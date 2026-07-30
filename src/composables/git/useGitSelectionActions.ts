import { toErrorMessage } from "../../utils/vibeHelpers";
import {
  filterStageableGitPaths,
  formatGitStageSkippedHint,
} from "../../../shared/gitStageGuard";
import {
  gitFileSelectionKey,
  parseGitFileSelectionKey,
  gitFileListScopeIsStaged,
  type GitFileListScope,
} from "../../utils/gitHelpers";
import { unstageGitFiles, discardGitFiles } from "../../services/vibeGitClient";
import type { GitPanelState } from "./createGitPanelState";
import { withGitStagingSession } from "./gitStagingSession";

export interface UseGitSelectionActionsOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>;
  onRefreshTree?: () => void;
  refreshGitStatus: (options?: { showLoading?: boolean; force?: boolean }) => Promise<void>;
  runStageGitFiles: (paths: string[]) => Promise<{ ok: boolean; stageable: string[] }>;
}

export function useGitSelectionActions(options: UseGitSelectionActionsOptions) {
  const {
    projectPath,
    projectOpened,
    state,
    confirm,
    onRefreshTree,
    refreshGitStatus,
    runStageGitFiles,
  } = options;

  async function stageSelectedFiles() {
    if (!projectOpened()) return;
    if (!state.selectedGitFiles.value.length) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const filesToStage = state.selectedGitFiles.value
      .map((key) => parseGitFileSelectionKey(key))
      .filter((x): x is { path: string; staged: boolean } => !!x && !x.staged)
      .map((x) => x.path)
      .filter((path) => state.gitUnstagedFiles.value.some((f) => f.path === path));
    if (!filesToStage.length) return;
    const { stageable } = filterStageableGitPaths(filesToStage);
    if (!stageable.length) {
      state.gitError.value = formatGitStageSkippedHint(filesToStage) || "没有可暂存的文件";
      return;
    }
    state.gitStatus.value = state.gitStatus.value.map((f) =>
      stageable.includes(f.path) ? { ...f, staged: true } : f,
    );
    state.selectedGitFiles.value = [];
    await withGitStagingSession(state, async () => {
      try {
        await runStageGitFiles(filesToStage);
        await refreshGitStatus({ showLoading: false, force: true });
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "暂存失败");
        await refreshGitStatus({ showLoading: false, force: true });
      }
    });
  }

  async function unstageSelectedFiles() {
    if (!projectOpened()) return;
    if (!state.selectedGitFiles.value.length) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const filesToUnstage = state.selectedGitFiles.value
      .map((key) => parseGitFileSelectionKey(key))
      .filter((x): x is { path: string; staged: boolean } => !!x && x.staged)
      .map((x) => x.path)
      .filter((path) => state.gitStagedFiles.value.some((f) => f.path === path));
    if (!filesToUnstage.length) return;
    state.gitStatus.value = state.gitStatus.value.map((f) =>
      filesToUnstage.includes(f.path) ? { ...f, staged: false } : f,
    );
    state.selectedGitFiles.value = [];
    await withGitStagingSession(state, async () => {
      try {
        const result = await unstageGitFiles(projectPath(), filesToUnstage);
        if (!result.ok) state.gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "取消暂存失败");
        await refreshGitStatus({ showLoading: false, force: true });
      }
    });
  }

  async function discardSelectedFiles(event?: MouseEvent) {
    if (!projectOpened()) return;
    if (!state.selectedGitFiles.value.length) return;
    const filesToDiscard = state.selectedGitFiles.value
      .map((key) => parseGitFileSelectionKey(key))
      .filter((x): x is { path: string; staged: boolean } => !!x && !x.staged)
      .map((x) => x.path)
      .filter((path) => state.gitUnstagedFiles.value.some((f) => f.path === path));
    if (!filesToDiscard.length) return;
    if (!(await confirm(`确定丢弃 ${filesToDiscard.length} 个文件的更改？`, event))) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    state.gitStatus.value = state.gitStatus.value.filter((f) => !filesToDiscard.includes(f.path));
    state.selectedGitFiles.value = [];
    await withGitStagingSession(state, async () => {
      try {
        const result = await discardGitFiles(projectPath(), filesToDiscard);
        if (!result.ok) state.gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus({ showLoading: false, force: true });
        onRefreshTree?.();
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "丢弃更改失败");
        await refreshGitStatus({ showLoading: false, force: true });
        onRefreshTree?.();
      }
    });
  }

  function toggleGitFileSelection(
    path: string,
    shiftKey: boolean,
    ctrlKey: boolean,
    listScope: GitFileListScope = "modified",
  ) {
    const staged = gitFileListScopeIsStaged(listScope);
    const key = gitFileSelectionKey(path, staged);
    const scopeFiles =
      listScope === "staged"
        ? state.gitStagedFiles.value.map((f) => f.path)
        : listScope === "untracked"
          ? state.gitUntrackedFiles.value.map((f) => f.path)
          : state.gitModifiedFiles.value.map((f) => f.path);

    if (shiftKey && state.selectedGitFiles.value.length > 0) {
      const last = parseGitFileSelectionKey(state.selectedGitFiles.value[state.selectedGitFiles.value.length - 1]);
      if (last && last.staged === staged) {
        const lastIndex = scopeFiles.indexOf(last.path);
        const currentIndex = scopeFiles.indexOf(path);
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const rangeFiles = scopeFiles.slice(start, end + 1).map((p) => gitFileSelectionKey(p, staged));
          if (ctrlKey) {
            const newSet = new Set(state.selectedGitFiles.value);
            rangeFiles.forEach((f) => newSet.add(f));
            state.selectedGitFiles.value = Array.from(newSet);
          } else {
            state.selectedGitFiles.value = rangeFiles;
          }
          return;
        }
      }
    }

    if (ctrlKey) {
      const sameStageSide = state.selectedGitFiles.value.every((k) => {
        const parsed = parseGitFileSelectionKey(k);
        return parsed && parsed.staged === staged;
      });
      if (!sameStageSide && state.selectedGitFiles.value.length > 0) {
        state.selectedGitFiles.value = [key];
        return;
      }
      const index = state.selectedGitFiles.value.indexOf(key);
      if (index === -1) {
        state.selectedGitFiles.value = [...state.selectedGitFiles.value, key];
      } else {
        state.selectedGitFiles.value = state.selectedGitFiles.value.filter((f) => f !== key);
      }
    } else {
      state.selectedGitFiles.value = [key];
    }
  }

  function clearGitSelection() {
    state.selectedGitFiles.value = [];
  }

  return {
    stageSelectedFiles,
    unstageSelectedFiles,
    discardSelectedFiles,
    toggleGitFileSelection,
    clearGitSelection,
  };
}
