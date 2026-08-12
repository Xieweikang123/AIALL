import { debugLog } from "../../utils/debugLog";
import { toErrorMessage } from "../../utils/vibeHelpers";
import { lsGet, lsSet } from "../../utils/localStorageSafe";
import {
  fetchGitStatus,
  fetchGitLog,
  fetchGitRepos,
  listIgnoredLocalChanges,
  type GitRepoInfo,
} from "../../services/vibeGitClient";
import type { GitPanelState } from "./createGitPanelState";

export interface AfterStatusRefreshCallbacks {
  refreshGitRemotes: () => Promise<void>;
  refreshGitStashes: () => Promise<void>;
  refreshGitBranches: () => Promise<void>;
  refreshGitLogIfOpen: (pathOverride?: string) => Promise<void>;
}

export interface UseGitStatusRefreshOptions {
  /** Repo-aware path getter: active repo root, falling back to the project root. */
  projectPath: () => string;
  /** Raw project root (used for repo discovery and persisting the selection). */
  projectRootPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  afterStatusRefresh: AfterStatusRefreshCallbacks;
  onResetBatch?: () => void;
  syncBatchStateWithSourceFiles?: () => void;
}

const ACTIVE_REPO_KEY_PREFIX = "vibe-coding-git-active-repo:";

function normalizeGitPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function activeRepoKey(projectRoot: string): string {
  return `${ACTIVE_REPO_KEY_PREFIX}${projectRoot}`;
}

function resolveDefaultRepo(list: GitRepoInfo[]): string {
  const rootRepo = list.find((r) => r.isRoot);
  if (rootRepo) return rootRepo.path;
  const nested = list.filter((r) => !r.isRoot);
  if (!nested.length) return "";
  const shallowest = [...nested].sort(
    (a, b) => a.relPath.split("/").length - b.relPath.split("/").length,
  )[0];
  return shallowest.path;
}

export function useGitStatusRefresh(options: UseGitStatusRefreshOptions) {
  const {
    projectPath,
    projectRootPath,
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
    state.gitRepos.value = [];
    state.gitActiveRepoPath.value = "";
    state.selectedGitFiles.value = [];
    state.gitIgnoredLocalFiles.value = [];
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

  /**
   * Re-discover git repos under the project root and resolve the active repo:
   * keep the current one when still valid, else restore the persisted selection,
   * else fall back to the project-root repo / shallowest nested repo.
   */
  async function refreshGitRepos() {
    if (!projectOpened()) return;
    const root = projectRootPath().trim();
    if (!root) return;
    let result;
    try {
      result = await fetchGitRepos(root);
    } catch {
      return;
    }
    if (!result.ok) return;
    state.gitRepos.value = result.repos;
    const list = result.repos;
    const isValid = (p: string) => !!p && list.some((r) => normalizeGitPath(r.path) === normalizeGitPath(p));
    let active = state.gitActiveRepoPath.value;
    if (!isValid(active)) {
      const stored = lsGet(activeRepoKey(root));
      active = isValid(stored ?? "") ? (stored as string) : resolveDefaultRepo(list);
    }
    if (normalizeGitPath(active) === normalizeGitPath(state.gitActiveRepoPath.value)) {
      return;
    }
    state.gitActiveRepoPath.value = active;
    lsSet(activeRepoKey(root), active);
    debugLog("[git-repos] resolved active repo", { root, active, count: list.length });
    // Status was refreshed against the project root already; only re-refresh
    // when the resolved repo is a nested one (or an ancestor repo).
    if (active && normalizeGitPath(active) !== normalizeGitPath(root)) {
      await refreshGitStatus({ force: true });
    }
  }

  function switchGitRepo(repoPath: string) {
    if (!projectOpened() || !repoPath) return;
    if (normalizeGitPath(repoPath) === normalizeGitPath(state.gitActiveRepoPath.value)) return;
    state.gitActiveRepoPath.value = repoPath;
    const root = projectRootPath().trim();
    if (root) lsSet(activeRepoKey(root), repoPath);
    state.clearGitDiffCache();
    state.selectedGitFiles.value = [];
    debugLog("[git-repos] switch active repo", { root, repoPath });
    void refreshGitStatus({ force: true });
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
        void refreshIgnoredLocalFiles();
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
    const until = state.gitLogUntil.value.trim();
    return {
      all: state.gitLogAllBranches.value,
      branch: state.gitLogBranchFilter.value,
      author: state.gitLogAuthorFilter.value,
      path: state.gitLogPathFilter.value,
      since: state.gitLogSince.value,
      // Git's --until date is inclusive only up to midnight; use the next day.
      until: until ? `${until} 23:59:59` : "",
    };
  }

  async function refreshIgnoredLocalFiles() {
    if (!projectOpened() || !state.gitIsRepo.value) return;
    try {
      const result = await listIgnoredLocalChanges(projectPath());
      if (result.ok) {
        state.gitIgnoredLocalFiles.value = result.ignored ?? [];
      }
    } catch {
      // ignore — status itself already surfaced errors
    }
  }

  async function setGitLogFilters(filters: { author: string; path: string; since: string; until: string }) {
    state.gitLogAuthorFilter.value = filters.author.trim();
    state.gitLogPathFilter.value = filters.path.trim();
    state.gitLogSince.value = filters.since;
    state.gitLogUntil.value = filters.until;
    state.gitLogCount.value = 30;
    await refreshGitLogIfOpen();
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
    if (state.gitLogAllBranches.value === all && !state.gitLogBranchFilter.value) return;
    state.gitLogAllBranches.value = all;
    state.gitLogBranchFilter.value = "";
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

  async function setGitLogBranchFilter(branch: string) {
    const normalized = branch.trim();
    if (state.gitLogBranchFilter.value === normalized) return;
    state.gitLogBranchFilter.value = normalized;
    if (normalized) state.gitLogAllBranches.value = false;
    state.gitLogCount.value = 30;
    await refreshGitLogIfOpen();
  }

  return {
    resetGitPanelState,
    refreshGitStatus,
    refreshGitRepos,
    switchGitRepo,
    refreshIgnoredLocalFiles,
    refreshGitLogIfOpen,
    loadMoreGitLog,
    searchGitLog,
    setGitLogAllBranches,
    setGitLogBranchFilter,
    setGitLogFilters,
  };
}
