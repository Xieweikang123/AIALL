import { watch } from "vue";
import { appendDebugLogFile, debugLog } from "../../utils/debugLog";
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

/** 路径是否指向同一目录（规范化比较，避免反斜杠/正斜杠差异误判） */
function sameGitPath(a: string, b: string): boolean {
  return normalizeGitPath(a) === normalizeGitPath(b);
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

  // 「本地忽略」查询（git ls-files -v）全量列已跟踪文件，成本高；
  // 节流到至少间隔这么久才在状态刷新路径里跑一次。
  const IGNORED_FILES_MIN_REFRESH_MS = 30_000;
  let lastIgnoredRefreshAt = 0;

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

  // 同一时间只跑一个状态刷新：文件 watcher 触发频繁时，若每次都新起一个，
  // token 会不断被顶掉，导致 gitStatusKnown 永远不置位、「正在加载」卡死。
  // 刷新进行中再来请求 → 标记一次补跑，等当前跑完后再跑。
  let statusRefreshInFlight = false;
  let statusRefreshQueued: { showLoading?: boolean; force?: boolean } | null = null;
  let loadingWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

  // 首次状态加载（gitStatusKnown 仍为 false）超过该时长未完成 → 不再死等，
  // 先让 UI 退出「正在加载…」，等慢请求回来再自动应用。
  const GIT_STATUS_FIRST_LOAD_MAX_MS = 12_000;

  // 诊断：loading 期间累计已等待秒数（界面上显示），+ git-status.log 计时明细
  let loadingElapsedTimer: ReturnType<typeof setInterval> | null = null;
  let gitStatusChurnCount = 0;

  function stopLoadingElapsedTimer() {
    if (loadingElapsedTimer) {
      clearInterval(loadingElapsedTimer);
      loadingElapsedTimer = null;
    }
  }

  function startLoadingElapsedTimer() {
    stopLoadingElapsedTimer();
    state.gitLoadingElapsedMs.value = 0;
    loadingElapsedTimer = setInterval(() => {
      state.gitLoadingElapsedMs.value += 500;
    }, 500);
  }

  function clearLoadingWatchdog() {
    if (loadingWatchdogTimer) {
      clearTimeout(loadingWatchdogTimer);
      loadingWatchdogTimer = null;
    }
  }

  async function refreshGitStatus(refreshOptions?: { showLoading?: boolean; force?: boolean }) {
    if (!projectOpened()) return;
    if (!refreshOptions?.force) {
      if (state.gitStagingInProgress.value) return;
      if (state.gitLastStagingAt.value && Date.now() - state.gitLastStagingAt.value < 1000) return;
    }
    if (statusRefreshInFlight) {
      statusRefreshQueued = refreshOptions ?? {};
      return;
    }
    statusRefreshInFlight = true;
    try {
      do {
        const runOptions = statusRefreshQueued ?? refreshOptions ?? {};
        statusRefreshQueued = null;
        await runRefreshGitStatus(runOptions);
      } while (statusRefreshQueued);
    } finally {
      statusRefreshInFlight = false;
      clearLoadingWatchdog();
    }
  }

  async function runRefreshGitStatus(refreshOptions: { showLoading?: boolean; force?: boolean }) {
    const showLoading = refreshOptions.showLoading !== false;
    const pathAtStart = projectPath();
    const token = ++state.gitStatusRefreshToken.value;
    const startTs = Date.now();
    debugLog("[git-status] refresh start", { token, path: pathAtStart, force: Boolean(refreshOptions.force) });
    if (showLoading) {
      state.gitLoading.value = true;
      state.gitError.value = "";
      startLoadingElapsedTimer();
    }
    clearLoadingWatchdog();
    if (showLoading && !state.gitStatusKnown.value) {
      loadingWatchdogTimer = setTimeout(() => {
        loadingWatchdogTimer = null;
        stopLoadingElapsedTimer();
        appendDebugLogFile(
          "git-status.log",
          `[${token}] FIRST-LOAD TIMEOUT after ${GIT_STATUS_FIRST_LOAD_MAX_MS}ms (churn=${gitStatusChurnCount})`,
          "git-status",
        );
        if (state.gitLoading.value && !state.gitStatusKnown.value) {
          state.gitLoading.value = false;
          state.gitError.value = "Git 状态加载较慢（仓库较大或 git 被占用），结果返回后会自动更新";
        }
      }, GIT_STATUS_FIRST_LOAD_MAX_MS);
    }
    try {
      const result = await fetchGitStatus(pathAtStart);
      if (token !== state.gitStatusRefreshToken.value || !sameGitPath(projectPath(), pathAtStart)) {
        gitStatusChurnCount += 1;
        debugLog("[git-status] stale refresh ignored", { token, activeToken: state.gitStatusRefreshToken.value, pathAtStart, now: projectPath() });
        appendDebugLogFile(
          "git-status.log",
          `[${token}] stale ignored (active=${state.gitStatusRefreshToken.value}, path ${pathAtStart} -> ${projectPath()}) after ${Date.now() - startTs}ms`,
          "git-status",
        );
        return;
      }
      if (!result.ok) {
        state.gitError.value = result.error || "获取 Git 状态失败";
        appendDebugLogFile("git-status.log", `[${token}] error after ${Date.now() - startTs}ms: ${state.gitError.value}`, "git-status");
        return;
      }
      state.gitIsRepo.value = result.isRepo;
      state.gitBranch.value = result.branch;
      state.gitHeadCommit.value = result.headCommit?.trim() || "";
      state.gitStatus.value = result.files;
      state.gitStatusKnown.value = true;
      debugLog("[git-status] refresh applied", { token, branch: result.branch, fileCount: result.files.length, stagedCount: result.stagedCount, unstagedCount: result.unstagedCount });
      appendDebugLogFile(
        "git-status.log",
        `[${token}] applied ${result.files.length} files in ${Date.now() - startTs}ms (churn=${gitStatusChurnCount})`,
        "git-status",
      );
      syncBatchStateWithSourceFiles?.();
      if (showLoading) {
        state.gitError.value = "";
      }
      state.clearGitDiffCache();

      if (result.isRepo) {
        void refreshIgnoredLocalFiles(Boolean(refreshOptions.force));
        void afterStatusRefresh.refreshGitRemotes();
        void afterStatusRefresh.refreshGitStashes();
        void afterStatusRefresh.refreshGitBranches();
        if (state.gitLogOpen.value) {
          void afterStatusRefresh.refreshGitLogIfOpen(pathAtStart);
        }
      }
    } catch (e) {
      if (token !== state.gitStatusRefreshToken.value || !sameGitPath(projectPath(), pathAtStart)) {
        debugLog("[git-status] stale refresh error ignored", { token, activeToken: state.gitStatusRefreshToken.value });
        return;
      }
      state.gitError.value = toErrorMessage(e, "获取 Git 状态失败");
      appendDebugLogFile("git-status.log", `[${token}] exception after ${Date.now() - startTs}ms: ${state.gitError.value}`, "git-status");
    } finally {
      // loading 只属于发起它的那次刷新：只要 token 仍是当前（没有更新的刷新顶上），
      // 就清掉 loading；路径表示法差异不应让它卡死。
      if (token === state.gitStatusRefreshToken.value) {
        state.gitLoading.value = false;
      }
      stopLoadingElapsedTimer();
      clearLoadingWatchdog();
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

  async function refreshIgnoredLocalFiles(force = false) {
    if (!projectOpened() || !state.gitIsRepo.value) return;
    // `git ls-files -v` 要全量列已跟踪文件，很贵（实测 ~284ms）。状态刷新在每次
    // 文件变动后都会触发，这里做最小间隔节流：平时最多每 30s 一次，
    // 展开「已忽略本地改动」面板或执行忽略/恢复操作时 force 刷新。
    const now = Date.now();
    if (!force && now - lastIgnoredRefreshAt < IGNORED_FILES_MIN_REFRESH_MS) return;
    lastIgnoredRefreshAt = now;
    try {
      const result = await listIgnoredLocalChanges(projectPath());
      if (result.ok) {
        state.gitIgnoredLocalFiles.value = result.ignored ?? [];
      }
    } catch {
      // ignore — status itself already surfaced errors
    }
  }

  // 展开「已忽略本地改动」面板时，强制拉取最新列表
  watch(
    () => state.gitIgnoredLocalOpen.value,
    (open) => {
      if (open) void refreshIgnoredLocalFiles(true);
    },
  );

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
