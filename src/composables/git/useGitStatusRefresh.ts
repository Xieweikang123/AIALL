import { debugLog } from "../../utils/debugLog";
import { toErrorMessage } from "../../utils/vibeHelpers";
import { debugLog } from "../../utils/debugLog";
import { fetchGitStatus, fetchGitLog } from "../../services/vibeGitClient";
import type { GitPanelState } from "./createGitPanelState";

export interface AfterStatusRefreshCallbacks {
  refreshGitRemotes: () => Promise<void>;
  refreshGitStashes: () => Promise<void>;
  refreshGitBranches: () => Promise<void>;
  refreshGitLogIfOpen: (pathOverride?: string) => Promise<void>;
}

export interface UseGitStatusRefreshOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  afterStatusRefresh: AfterStatusRefreshCallbacks;
  onResetBatch?: () => void;
  syncBatchStateWithSourceFiles?: () => void;
}

export function useGitStatusRefresh(options: UseGitStatusRefreshOptions) {
  const {
    projectPath,
    projectOpened,
    state,
    afterStatusRefresh,
    onResetBatch,
    syncBatchStateWithSourceFiles,
  } = options;

  function resetGitPanelState() {
    state.gitStatusRefreshToken.value += 1;
    state.gitIsRepo.value = false;
    state.gitStatusKnown.value = false;
    state.gitLoading.value = false;
    state.gitError.value = "";
    state.gitBranch.value = "";
    state.gitHeadCommit.value = "";
    state.gitStatus.value = [];
    state.selectedGitFiles.value = [];
    state.gitBranches.value = [];
    state.gitLogEntries.value = [];
    state.gitLogCount.value = 30;
    state.gitLogSearchQuery.value = "";
    state.gitLogLoadingMore.value = false;
    state.gitLogSearchLoading.value = false;
    onResetBatch?.();
    state.clearGitDiffCache();
    state.gitHunkTargetFile.value = "";
    state.gitHunks.value = [];
    state.gitStagedHunks.value = [];
    state.gitHunkStagingIndex.value = null;
    state.gitHunkUnstagingIndex.value = null;
  }

  async function refreshGitStatus(refreshOptions?: { showLoading?: boolean; force?: boolean }) {
    if (!projectOpened()) return;
    if (!refreshOptions?.force) {
      if (state.gitStagingInProgress.value) return;
      if (state.gitLastStagingAt.value && Date.now() - state.gitLastStagingAt.value < 1000) return;
    }
    const showLoading = refreshOptions?.showLoading !== false;
    const pathAtStart = projectPath();
    const token = ++state.gitStatusRefreshToken.value;
    debugLog("[git-status] refresh start", { token, path: pathAtStart, force: Boolean(refreshOptions?.force) });
    if (showLoading) state.gitLoading.value = true;
    if (showLoading) state.gitError.value = "";
    try {
      const result = await fetchGitStatus(pathAtStart);
      if (token !== state.gitStatusRefreshToken.value || projectPath() !== pathAtStart) {
        debugLog("[git-status] stale refresh ignored", { token, activeToken: state.gitStatusRefreshToken.value });
        return;
      }
      if (!result.ok) {
        state.gitError.value = result.error || "获取 Git 状态失败";
        return;
      }
      state.gitIsRepo.value = result.isRepo;
      state.gitBranch.value = result.branch;
      state.gitHeadCommit.value = result.headCommit?.trim() || "";
      state.gitStatus.value = result.files;
      state.gitStatusKnown.value = true;
      debugLog("[git-status] refresh applied", { token, branch: result.branch, fileCount: result.files.length, stagedCount: result.stagedCount, unstagedCount: result.unstagedCount });
      syncBatchStateWithSourceFiles?.();
      if (showLoading) {
        state.gitError.value = "";
      }
      state.clearGitDiffCache();

      if (result.isRepo) {
        void afterStatusRefresh.refreshGitRemotes();
        void afterStatusRefresh.refreshGitStashes();
        void afterStatusRefresh.refreshGitBranches();
        if (state.gitLogOpen.value) {
          void afterStatusRefresh.refreshGitLogIfOpen(pathAtStart);
        }
      }
    } catch (e) {
      if (token !== state.gitStatusRefreshToken.value || projectPath() !== pathAtStart) {
        debugLog("[git-status] stale refresh error ignored", { token, activeToken: state.gitStatusRefreshToken.value });
        return;
      }
      state.gitError.value = toErrorMessage(e, "获取 Git 状态失败");
    } finally {
      if (token === state.gitStatusRefreshToken.value && projectPath() === pathAtStart) {
        state.gitLoading.value = false;
      }
    }
  }

  function logFetchOptions() {
    return { all: state.gitLogAllBranches.value };
  }

  async function refreshGitLogIfOpen(pathOverride?: string) {
    if (!state.gitLogOpen.value || !projectOpened() || !state.gitIsRepo.value) return;
    const path = pathOverride ?? projectPath();
    try {
      const logResult = await fetchGitLog(
        path,
        state.gitLogCount.value,
        state.gitLogSearchQuery.value,
        logFetchOptions(),
      );
      if (logResult.ok && projectPath() === path) {
        state.gitLogEntries.value = logResult.entries;
      }
    } catch {
      // ignore
    }
  }

  async function loadMoreGitLog() {
    if (state.gitLogLoadingMore.value || state.gitLogSearchLoading.value || !projectOpened() || !state.gitIsRepo.value) return;
    state.gitLogLoadingMore.value = true;
    state.gitLogCount.value += 30;
    try {
      const logResult = await fetchGitLog(
        projectPath(),
        state.gitLogCount.value,
        state.gitLogSearchQuery.value,
        logFetchOptions(),
      );
      if (logResult.ok) {
        state.gitLogEntries.value = logResult.entries;
      }
    } catch (e) {
      debugLog("加载更多提交历史失败:", e);
    } finally {
      state.gitLogLoadingMore.value = false;
    }
  }

  async function searchGitLog(query: string) {
    const trimmed = query.trim();
    state.gitLogSearchQuery.value = trimmed;
    state.gitLogCount.value = 30;
    if (!projectOpened() || !state.gitIsRepo.value) {
      state.gitLogSearchLoading.value = false;
      return;
    }

    const token = ++state.gitLogSearchToken.value;
    state.gitLogSearchLoading.value = true;
    try {
      const logResult = await fetchGitLog(
        projectPath(),
        state.gitLogCount.value,
        trimmed || undefined,
        logFetchOptions(),
      );
      if (token !== state.gitLogSearchToken.value) return;
      if (logResult.ok) {
        state.gitLogEntries.value = logResult.entries;
      }
    } catch (e) {
      debugLog("searchGitLog exception:", e);
    } finally {
      if (token === state.gitLogSearchToken.value) {
        state.gitLogSearchLoading.value = false;
      }
    }
  }

  async function setGitLogAllBranches(all: boolean) {
    if (state.gitLogAllBranches.value === all) return;
    state.gitLogAllBranches.value = all;
    state.gitLogCount.value = 30;
    if (!state.gitLogOpen.value || !projectOpened() || !state.gitIsRepo.value) return;

    const token = ++state.gitLogSearchToken.value;
    state.gitLogSearchLoading.value = true;
    try {
      const logResult = await fetchGitLog(
        projectPath(),
        state.gitLogCount.value,
        state.gitLogSearchQuery.value || undefined,
        logFetchOptions(),
      );
      if (token !== state.gitLogSearchToken.value) return;
      if (logResult.ok) {
        state.gitLogEntries.value = logResult.entries;
      }
    } catch (e) {
      debugLog("setGitLogAllBranches exception:", e);
    } finally {
      if (token === state.gitLogSearchToken.value) {
        state.gitLogSearchLoading.value = false;
      }
    }
  }

  return {
    resetGitPanelState,
    refreshGitStatus,
    refreshGitLogIfOpen,
    loadMoreGitLog,
    searchGitLog,
    setGitLogAllBranches,
  };
}
