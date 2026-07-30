import { debugLog } from "../../utils/debugLog";
import { toErrorMessage } from "../../utils/vibeHelpers";
import {
  filterStageableGitPaths,
  formatGitStageSkippedHint,
  isGitPathStageBlocked,
} from "../../../shared/gitStageGuard";
import { gitPathsUnderDir } from "../../utils/gitFileTree";
import {
  stageGitFiles,
  unstageGitFiles,
  discardGitFiles,
} from "../../services/vibeGitClient";
import type { GitPanelState } from "./createGitPanelState";
import { mergeStageWarnings, withGitStagingSession } from "./gitStagingSession";

export interface UseGitFileStagingActionsOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>;
  onRefreshTree?: () => void;
  refreshGitStatus: (options?: { showLoading?: boolean; force?: boolean }) => Promise<void>;
}

type GitDirScope = "modified" | "untracked" | "staged";

export function useGitFileStagingActions(options: UseGitFileStagingActionsOptions) {
  const { projectPath, projectOpened, state, confirm, onRefreshTree, refreshGitStatus } = options;

  async function runStageGitFiles(paths: string[]): Promise<{ ok: boolean; stageable: string[] }> {
    const { stageable, blocked } = filterStageableGitPaths(paths);
    if (!stageable.length) {
      state.gitError.value = formatGitStageSkippedHint(blocked) || "没有可暂存的文件";
      return { ok: false, stageable };
    }
    const result = await stageGitFiles(projectPath(), stageable);
    const warning = mergeStageWarnings(blocked, result.warning);
    if (!result.ok) {
      state.gitError.value = result.error || "暂存失败";
      await refreshGitStatus({ showLoading: false, force: true });
      return { ok: false, stageable };
    }
    if (warning) state.gitError.value = warning;
    return { ok: true, stageable };
  }

  async function stageFile(filePath: string) {
    if (!projectOpened()) return;
    if (isGitPathStageBlocked(filePath)) {
      state.gitError.value = formatGitStageSkippedHint([filePath]);
      return;
    }
    state.gitError.value = "";
    state.clearGitDiffCache();
    const t = Date.now();
    state.gitStatus.value = state.gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: true } : f));
    debugLog("stageFile start", { filePath, ts: t });
    await withGitStagingSession(state, async () => {
      try {
        const result = await runStageGitFiles([filePath]);
        debugLog("stageFile API done", { ok: result.ok, elapsed: Date.now() - t });
        await refreshGitStatus({ showLoading: false, force: true });
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "暂存失败");
        await refreshGitStatus({ showLoading: false, force: true });
      }
    });
  }

  async function unstageFile(filePath: string) {
    if (!projectOpened()) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    state.gitStatus.value = state.gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: false } : f));
    await withGitStagingSession(state, async () => {
      try {
        const result = await unstageGitFiles(projectPath(), [filePath]);
        if (!result.ok) state.gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "取消暂存失败");
        await refreshGitStatus({ showLoading: false, force: true });
      }
    });
  }

  async function stageAll() {
    if (!projectOpened()) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const filesToStage = state.gitModifiedFiles.value.map((f) => f.path);
    if (!filesToStage.length) return;
    const { stageable } = filterStageableGitPaths(filesToStage);
    if (!stageable.length) {
      state.gitError.value = formatGitStageSkippedHint(filesToStage) || "没有可暂存的文件";
      return;
    }
    state.gitStatus.value = state.gitStatus.value.map((f) =>
      stageable.includes(f.path) ? { ...f, staged: true } : f,
    );
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

  async function stageUntracked() {
    await stagePaths(state.gitUntrackedFiles.value.map((f) => f.path));
  }

  async function unstageAll() {
    if (!projectOpened()) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    if (!state.gitStagedFiles.value.length) return;
    const pathsToUnstage = state.gitStagedFiles.value.map((f) => f.path);
    state.gitStatus.value = state.gitStatus.value.map((f) => ({ ...f, staged: false }));
    await withGitStagingSession(state, async () => {
      try {
        const result = await unstageGitFiles(projectPath(), pathsToUnstage);
        if (!result.ok) state.gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "取消暂存失败");
        await refreshGitStatus({ showLoading: false, force: true });
      }
    });
  }

  async function discardFile(filePath: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    if (!(await confirm(`确定丢弃 ${filePath} 的更改？`, event))) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    state.gitStatus.value = state.gitStatus.value.filter((f) => f.path !== filePath);
    await withGitStagingSession(state, async () => {
      try {
        const result = await discardGitFiles(projectPath(), [filePath]);
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

  async function discardAll(event?: MouseEvent) {
    const paths = state.gitModifiedFiles.value.map((f) => f.path);
    if (!paths.length) return;
    await discardPaths(paths, event);
  }

  async function stagePaths(paths: string[]) {
    if (!projectOpened() || !paths.length) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const { stageable } = filterStageableGitPaths(paths);
    if (!stageable.length) {
      state.gitError.value = formatGitStageSkippedHint(paths) || "没有可暂存的文件";
      return;
    }
    state.gitStatus.value = state.gitStatus.value.map((f) =>
      stageable.includes(f.path) ? { ...f, staged: true } : f,
    );
    await withGitStagingSession(state, async () => {
      try {
        await runStageGitFiles(stageable);
        await refreshGitStatus({ showLoading: false, force: true });
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "暂存失败");
        await refreshGitStatus({ showLoading: false, force: true });
      }
    });
  }

  async function unstagePaths(paths: string[]) {
    if (!projectOpened() || !paths.length) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    state.gitStatus.value = state.gitStatus.value.map((f) =>
      paths.includes(f.path) ? { ...f, staged: false } : f,
    );
    await withGitStagingSession(state, async () => {
      try {
        const result = await unstageGitFiles(projectPath(), paths);
        if (!result.ok) state.gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "取消暂存失败");
        await refreshGitStatus({ showLoading: false, force: true });
      }
    });
  }

  async function discardPaths(paths: string[], event?: MouseEvent) {
    if (!projectOpened() || !paths.length) return;
    const untrackedSet = new Set(state.gitUntrackedFiles.value.map((f) => f.path));
    const allUntracked = paths.every((p) => untrackedSet.has(p));
    const label = paths.length === 1 ? paths[0] : `${paths.length} 个文件`;
    const confirmMsg = allUntracked
      ? paths.length === 1
        ? `确定删除未跟踪文件 ${paths[0]}？此操作不可恢复。`
        : `确定删除 ${paths.length} 个未跟踪文件？此操作不可恢复。`
      : `确定丢弃 ${label} 的更改？`;
    if (!(await confirm(confirmMsg, event))) return;
    state.gitError.value = "";
    state.clearGitDiffCache();
    state.gitStatus.value = state.gitStatus.value.filter((f) => !paths.includes(f.path));
    await withGitStagingSession(state, async () => {
      try {
        const result = await discardGitFiles(projectPath(), paths);
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

  function filesForDirScope(scope: GitDirScope) {
    if (scope === "staged") return state.gitStagedFiles.value;
    if (scope === "modified") return state.gitModifiedFiles.value;
    return state.gitUntrackedFiles.value;
  }

  async function stageDir(dirPath: string, scope: GitDirScope = "modified") {
    if (scope === "staged") return;
    await stagePaths(gitPathsUnderDir(filesForDirScope(scope), dirPath));
  }

  async function unstageDir(dirPath: string) {
    await unstagePaths(gitPathsUnderDir(state.gitStagedFiles.value, dirPath));
  }

  async function discardDir(dirPath: string, scope: GitDirScope = "modified", event?: MouseEvent) {
    if (scope === "staged") return;
    await discardPaths(gitPathsUnderDir(filesForDirScope(scope), dirPath), event);
  }

  return {
    runStageGitFiles,
    stageFile,
    unstageFile,
    stageAll,
    stageUntracked,
    unstageAll,
    discardFile,
    discardAll,
    stageDir,
    unstageDir,
    discardDir,
  };
}
