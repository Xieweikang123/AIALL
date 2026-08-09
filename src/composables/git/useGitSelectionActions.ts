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
import { unstageGitFiles, discardGitFiles, ignoreLocalChanges, unignoreLocalChanges } from "../../services/vibeGitClient";
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

  async function stageSelectedFiles(extraPath?: string) {
    if (!projectOpened()) return;
    if (!state.selectedGitFiles.value.length && !extraPath) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const filesToStage = batchPaths(
      state.selectedGitFiles.value,
      extraPath,
      (x) => !x.staged,
      (path) => state.gitUnstagedFiles.value.some((f) => f.path === path),
    );
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

  async function unstageSelectedFiles(extraPath?: string) {
    if (!projectOpened()) return;
    if (!state.selectedGitFiles.value.length && !extraPath) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const filesToUnstage = batchPaths(
      state.selectedGitFiles.value,
      extraPath,
      (x) => x.staged,
      (path) => state.gitStagedFiles.value.some((f) => f.path === path),
    );
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

  async function discardSelectedFiles(extraPathOrEvent?: string | MouseEvent, event?: MouseEvent) {
    let extraPath: string | undefined;
    let ev: MouseEvent | undefined;
    if (typeof extraPathOrEvent === "string") {
      extraPath = extraPathOrEvent;
      ev = event;
    } else {
      ev = extraPathOrEvent;
    }
    if (!projectOpened()) return;
    if (!state.selectedGitFiles.value.length && !extraPath) return;
    const filesToDiscard = batchPaths(
      state.selectedGitFiles.value,
      extraPath,
      (x) => !x.staged,
      (path) => state.gitUnstagedFiles.value.some((f) => f.path === path),
    );
    if (!filesToDiscard.length) return;
    const untrackedSet = new Set(state.gitUntrackedFiles.value.map((f) => f.path));
    const allUntracked = filesToDiscard.every((p) => untrackedSet.has(p));
    const label = filesToDiscard.length === 1 ? filesToDiscard[0] : `${filesToDiscard.length} 个文件`;
    const confirmMsg = allUntracked
      ? filesToDiscard.length === 1
        ? `确定删除未跟踪文件 ${filesToDiscard[0]}？此操作不可恢复。`
        : `确定删除 ${filesToDiscard.length} 个未跟踪文件？此操作不可恢复。`
      : `确定丢弃 ${label} 的更改？`;
    if (!(await confirm(confirmMsg, ev))) return;
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

  /** 选中集合 ∪ 额外点击的文件，再按动作方向过滤。 */
  function batchPaths(
    selectedKeys: string[],
    extraPath: string | undefined,
    sideFilter: (parsed: { path: string; staged: boolean }) => boolean,
    exists: (path: string) => boolean,
  ): string[] {
    const fromSelection = selectedKeys
      .map((key) => parseGitFileSelectionKey(key))
      .filter((x): x is { path: string; staged: boolean } => !!x && sideFilter(x))
      .map((x) => x.path);
    return Array.from(new Set([...fromSelection, ...(extraPath ? [extraPath] : [])])).filter(exists);
  }

  /** 忽略本地改动：skip-worktree 后文件不再出现在 git status，避免误提交。 */
  async function ignoreSelectedFiles(extraPath?: string) {
    if (!projectOpened()) return;
    if (!state.selectedGitFiles.value.length && !extraPath) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const files = batchPaths(
      state.selectedGitFiles.value,
      extraPath,
      (x) => !x.staged,
      (path) => state.gitModifiedFiles.value.some((f) => f.path === path),
    );
    if (!files.length) return;
    const result = await ignoreLocalChanges(projectPath(), files);
    if (!result.ok) {
      state.gitError.value = result.error || "忽略本地改动失败";
    }
    state.selectedGitFiles.value = [];
    await refreshGitStatus({ showLoading: false, force: true });
  }

  /** 恢复跟踪：去掉 skip-worktree，文件重新出现在 git status。 */
  async function unignoreSelectedFiles(extraPath?: string) {
    if (!projectOpened()) return;
    if (!state.selectedGitFiles.value.length && !extraPath) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const files = batchPaths(
      state.selectedGitFiles.value,
      extraPath,
      () => true,
      (path) => state.gitIgnoredLocalFiles.value.includes(path),
    );
    if (!files.length) return;
    const result = await unignoreLocalChanges(projectPath(), files);
    if (!result.ok) {
      state.gitError.value = result.error || "恢复跟踪失败";
    }
    state.selectedGitFiles.value = [];
    await refreshGitStatus({ showLoading: false, force: true });
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
          : listScope === "ignored-local"
            ? state.gitIgnoredLocalFiles.value
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
    ignoreSelectedFiles,
    unignoreSelectedFiles,
    toggleGitFileSelection,
    clearGitSelection,
  };
}
