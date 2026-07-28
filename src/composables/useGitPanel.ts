import { computed, reactive, ref, watch } from "vue";
import { debugLog } from "../utils/debugLog";
import { toErrorMessage } from "../utils/vibeHelpers";
import { lsGet, lsSet } from "../utils/localStorageSafe";
import {
  filterStageableGitPaths,
  formatGitStageSkippedHint,
  isGitPathStageBlocked,
} from "../../shared/gitStageGuard";
import {
  sortedUnstagedPaths,
} from "../utils/gitBatchDraftStorage";
import { gitStatusIcon, gitStatusColor } from "../utils/gitHelpers";
import {
  fetchGitStatus,
  fetchGitDiff,
  fetchGitDiffContent,
  fetchGitCommitFileDiff,
  commitGitChanges,
  fetchGitLog,
  fetchAheadCommits,
  stageGitFiles,
  unstageGitFiles,
  discardGitFiles,
  generateCommitMessage as generateCommitMessageApi,
  fetchGitRemotes,
  gitFetchRemote,
  gitPullRemote,
  gitPushRemote,
  gitStashListRemote,
  gitStashSaveRemote,
  gitStashApplyRemote,
  gitStashDropRemote,
  type GitStatusFile,
  type GitLogEntry,
  type GitLogFile,
  type GitRemoteInfo,
  fetchGitBranches,
  gitCheckoutBranch as gitCheckoutBranchApi,
  gitDeleteBranch as gitDeleteBranchApi,
  type GitBranchInfo,
  gitMerge,
  gitMergeAbort,
  gitRebase,
  gitRebaseAbort,
  gitCherryPick,
  gitRevertCommit,
  gitAmend,
  gitTagCreate,
  gitTagDelete,
  gitSubmoduleUpdate,
  gitResolveConflict,
  gitResetToCommit,
  gitStashPopRemote,
  fetchGitTags,
  fetchGitSubmodules,
  type GitTagInfo,
  type GitSubmoduleInfo,
  type GitConflictSide,
  type GitResetMode,
} from "../services/vibeGitClient";
import { useGitBatchCommit } from "./useGitBatchCommit";

export type GitFileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
};

export type { BatchGroup } from "./useGitBatchCommit";

export function useGitPanel(
  projectPath: () => string,
  projectOpened: () => boolean,
  aiConfig: () => { endpoint: string; apiKey: string; model: string },
  configReady: () => boolean,
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>,
  onRefreshTree?: () => void,
) {
  const GIT_PANEL_MODE_KEY = "vibe-coding-git-panel-mode";
  const GIT_STAGED_OPEN_KEY = "git-staged-open";
  const GIT_UNSTAGED_OPEN_KEY = "git-unstaged-open";

  function readGitSectionOpen(key: string): boolean {
    return lsGet(key) !== "false";
  }
  const PROJECT_PANEL_VIEW_KEY = "vibe-coding-project-panel-view";

  const _storedPanelMode = lsGet(GIT_PANEL_MODE_KEY);
  if (_storedPanelMode === "knowledge" || _storedPanelMode === "health") {
    lsSet(GIT_PANEL_MODE_KEY, "project");
    lsSet(
      PROJECT_PANEL_VIEW_KEY,
      _storedPanelMode === "health" ? "health" : "knowledge",
    );
  }

  type GitPanelMode = "files" | "git" | "sessions" | "project";
  type ProjectPanelView = "knowledge" | "health" | "fix" | "map";

  const gitPanelMode = ref<GitPanelMode>(
    _storedPanelMode === "git"
      || _storedPanelMode === "sessions"
      || _storedPanelMode === "project"
      || _storedPanelMode === "knowledge"
      || _storedPanelMode === "health"
      ? (_storedPanelMode === "knowledge" || _storedPanelMode === "health" ? "project" : _storedPanelMode as GitPanelMode)
      : "files",
  );

  const _storedProjectView = lsGet(PROJECT_PANEL_VIEW_KEY);
  const projectPanelView = ref<ProjectPanelView>(
    _storedProjectView === "health"
      || _storedProjectView === "knowledge"
      || _storedProjectView === "fix"
      || _storedProjectView === "map"
      ? _storedProjectView
      : _storedPanelMode === "health"
        ? "health"
        : "knowledge",
  );

  watch(gitPanelMode, (mode) => {
    lsSet(GIT_PANEL_MODE_KEY, mode);
  });
  watch(projectPanelView, (view) => {
    lsSet(PROJECT_PANEL_VIEW_KEY, view);
  });
  const gitStatus = ref<GitStatusFile[]>([]);
  const gitBranch = ref("");
  const gitHeadCommit = ref("");
  const gitIsRepo = ref(false);
  const gitStatusKnown = ref(false);
  const gitLoading = ref(false);
  const gitError = ref("");
  const gitStatusRefreshToken = ref(0);
  const gitLogSearchToken = ref(0);
  const gitCommitMessage = ref("");
  const gitCommitting = ref(false);
  const gitGenStep = ref("");
  const gitLogEntries = ref<GitLogEntry[]>([]);
  const gitLogOpen = ref(false);
  const gitLogCount = ref(30);
  const gitLogSearchQuery = ref("");
  const gitLogLoadingMore = ref(false);
  const gitLogSearchLoading = ref(false);
  const hasMoreGitLog = computed(() => {
    return gitLogEntries.value.length === gitLogCount.value;
  });
  const gitStagedOpen = ref(readGitSectionOpen(GIT_STAGED_OPEN_KEY));
  const gitUnstagedOpen = ref(readGitSectionOpen(GIT_UNSTAGED_OPEN_KEY));
  const expandedGitLogEntries = ref<Set<string>>(new Set());
  const gitStashSectionOpen = ref(false);
  const gitLocalChangesOpen = ref(false);
  const gitTreeExpandedDirs = ref<Set<string>>(new Set());
  const selectedGitFiles = ref<string[]>([]);
  const gitDiffLoadingKey = ref("");
  const gitDiffContentCache = ref<Record<string, GitFileDiff>>({});
  const gitStagingInProgress = ref(false);
  const gitLastStagingAt = ref(0);
  const GIT_DIFF_CACHE_MAX = 30;

  function evictOldestCacheEntry() {
    const keys = Object.keys(gitDiffContentCache.value);
    if (keys.length <= GIT_DIFF_CACHE_MAX) return;
    const toRemove = keys.slice(0, keys.length - GIT_DIFF_CACHE_MAX);
    const next = { ...gitDiffContentCache.value };
    for (const k of toRemove) delete next[k];
    gitDiffContentCache.value = next;
  }
  const gitRemotes = ref<GitRemoteInfo[]>([]);
  const gitTrackingBranch = ref("");
  const gitAhead = ref(0);
  const gitBehind = ref(0);
  const gitRemoteLoading = ref(false);
  const gitRemoteAction = ref("");
  const gitStashes = ref<Array<{ index: string; message: string }>>([]);
  const gitStashOpen = ref(false);
  const gitStashAction = ref("");
  const gitStashMessage = ref("");
  const gitAiPushStep = ref("");
  const gitAheadCommits = ref<GitLogEntry[]>([]);
  const gitAheadCommitsOpen = ref(false);
  const gitAheadCommitsLoading = ref(false);
  const gitBranches = ref<GitBranchInfo[]>([]);
  const gitSecondaryHint = ref("");
  const gitSelectedRemote = ref("");
  const gitMergeInProgress = ref(false);
  const gitRebaseInProgress = ref(false);
  const gitAdvancedOpen = ref(false);
  const gitAdvancedAction = ref("");
  const gitTags = ref<GitTagInfo[]>([]);
  const gitSubmodules = ref<GitSubmoduleInfo[]>([]);
  const gitTagNameInput = ref("");
  const gitMergeTarget = ref("");
  const gitRebaseOnto = ref("");
  const gitConflictedFiles = ref<GitStatusFile[]>([]);

  watch(gitLogOpen, (open) => {
    if (open) {
      gitStagedOpen.value = false;
      gitUnstagedOpen.value = false;
      gitAheadCommitsOpen.value = false;
      gitStashOpen.value = false;
      if (projectOpened() && gitIsRepo.value) {
        const openSearch = gitLogSearchQuery.value || undefined;
        gitLogLoadingMore.value = true;
        fetchGitLog(projectPath(), gitLogCount.value, openSearch)
          .then((logResult) => {
            if (logResult.ok) {
              gitLogEntries.value = logResult.entries;
            }
          })
          .finally(() => {
            gitLogLoadingMore.value = false;
          });
      }
    }
  });

  watch(gitStagedOpen, (open) => {
    lsSet(GIT_STAGED_OPEN_KEY, String(open));
  });
  watch(gitUnstagedOpen, (open) => {
    lsSet(GIT_UNSTAGED_OPEN_KEY, String(open));
  });

  const gitStagedFiles = computed(() => {
    const seen = new Set<string>();
    const result: GitStatusFile[] = [];
    for (const f of gitStatus.value) {
      if (f.staged && !seen.has(f.path)) {
        seen.add(f.path);
        result.push(f);
      }
    }
    return result;
  });
  const gitUnstagedFiles = computed(() => {
    const unstaged = gitStatus.value.filter((f) => !f.staged);
    const paths = sortedUnstagedPaths(unstaged.map((f) => f.path));
    const byPath = new Map(unstaged.map((f) => [f.path, f]));
    return paths.map((p) => byPath.get(p)).filter((f): f is GitStatusFile => f != null);
  });
  /** 分批提交数据源：优先未暂存；若已全部暂存则回退到已暂存列表 */
  const gitBatchSourceFiles = computed(() => {
    if (gitUnstagedFiles.value.length > 0) return gitUnstagedFiles.value;
    return gitStagedFiles.value;
  });
  const gitChangeCount = computed(() => gitStatus.value.length);
  const canGitCommit = computed(
    () =>
      !gitCommitting.value &&
      !!gitCommitMessage.value.trim() &&
      gitStagedFiles.value.length > 0,
  );

  function clearGitDiffCache() {
    gitDiffContentCache.value = {};
    gitDiffLoadingKey.value = "";
  }

  function isGitLogEntryOpen(hash: string): boolean {
    return expandedGitLogEntries.value.has(hash);
  }

  function toggleGitLogEntry(hash: string) {
    const next = new Set(expandedGitLogEntries.value);
    if (next.has(hash)) next.delete(hash);
    else next.add(hash);
    expandedGitLogEntries.value = next;
  }

  function gitHistoryDiffKey(hash: string, filePath: string, oldPath?: string): string {
    return `history:${hash}:${oldPath || ""}:${filePath}`;
  }

  function gitWorkingTreeDiffKey(filePath: string, staged = false): string {
    return `${staged ? "staged" : "unstaged"}:${filePath}`;
  }

  function mergeStageWarnings(blocked: string[], apiWarning?: string): string {
    return [blocked.length ? formatGitStageSkippedHint(blocked) : "", apiWarning || ""]
      .filter(Boolean)
      .join(" ");
  }

  async function runStageGitFiles(paths: string[]): Promise<{ ok: boolean; stageable: string[] }> {
    const { stageable, blocked } = filterStageableGitPaths(paths);
    if (!stageable.length) {
      gitError.value = formatGitStageSkippedHint(blocked) || "没有可暂存的文件";
      return { ok: false, stageable };
    }
    const result = await stageGitFiles(projectPath(), stageable);
    const warning = mergeStageWarnings(blocked, result.warning);
    if (!result.ok) {
      gitError.value = result.error || "暂存失败";
      await refreshGitStatus({ showLoading: false, force: true });
      return { ok: false, stageable };
    }
    if (warning) gitError.value = warning;
    return { ok: true, stageable };
  }

  function resetGitPanelState() {
    gitStatusRefreshToken.value += 1;
    gitIsRepo.value = false;
    gitStatusKnown.value = false;
    gitLoading.value = false;
    gitError.value = "";
    gitBranch.value = "";
    gitHeadCommit.value = "";
    gitStatus.value = [];
    gitBranches.value = [];
    gitLogEntries.value = [];
    gitLogCount.value = 30;
    gitLogSearchQuery.value = "";
    gitLogLoadingMore.value = false;
    gitLogSearchLoading.value = false;
    batch.resetBatchDraftSessionState();
    clearGitDiffCache();
  }

  async function refreshGitStatus(options?: { showLoading?: boolean; force?: boolean }) {
    if (!projectOpened()) return;
    // 正在执行暂存/取消暂存操作时，跳过外部触发的刷新，防止覆盖乐观更新导致闪烁
    if (!options?.force) {
      if (gitStagingInProgress.value) return;
      // 即使 stagingInProgress 已变 false（finally 已执行），只要距上次暂存操作不足 1s 就跳过，
      // 防止 API 返回 → finally 置 false → 延迟的 watcher/回调仍拉回旧状态导致闪烁
      if (gitLastStagingAt.value && Date.now() - gitLastStagingAt.value < 1000) return;
    }
    const showLoading = options?.showLoading !== false;
    const pathAtStart = projectPath();
    const token = ++gitStatusRefreshToken.value;
    if (showLoading) gitLoading.value = true;
    if (showLoading) gitError.value = "";
    try {
      const result = await fetchGitStatus(pathAtStart);
      if (token !== gitStatusRefreshToken.value || projectPath() !== pathAtStart) return;
      if (!result.ok) {
        gitError.value = result.error || "获取 Git 状态失败";
        return;
      }
      gitIsRepo.value = result.isRepo;
      gitBranch.value = result.branch;
      gitHeadCommit.value = result.headCommit?.trim() || "";
      gitStatus.value = result.files;
      gitStatusKnown.value = true;
      batch.syncBatchStateWithSourceFiles();
      if (showLoading) {
        gitError.value = "";
      }
      clearGitDiffCache();

      if (result.isRepo) {
        void refreshGitRemotes();
        void refreshGitStashes();
        void refreshGitBranches();
        if (gitLogOpen.value) {
          void refreshGitLogIfOpen(pathAtStart);
        }
      }
    } catch (e) {
      if (token !== gitStatusRefreshToken.value || projectPath() !== pathAtStart) return;
      gitError.value = toErrorMessage(e, "获取 Git 状态失败");
    } finally {
      if (token === gitStatusRefreshToken.value && projectPath() === pathAtStart) {
        gitLoading.value = false;
      }
    }
  }

  async function refreshGitLogIfOpen(pathOverride?: string) {
    if (!gitLogOpen.value || !projectOpened() || !gitIsRepo.value) return;
    const path = pathOverride ?? projectPath();
    try {
      const logResult = await fetchGitLog(path, gitLogCount.value, gitLogSearchQuery.value);
      if (logResult.ok && projectPath() === path) {
        gitLogEntries.value = logResult.entries;
      }
    } catch {
      // ignore
    }
  }

  async function loadMoreGitLog() {
    if (gitLogLoadingMore.value || gitLogSearchLoading.value || !projectOpened() || !gitIsRepo.value) return;
    gitLogLoadingMore.value = true;
    gitLogCount.value += 30;
    try {
      const logResult = await fetchGitLog(projectPath(), gitLogCount.value, gitLogSearchQuery.value);
      if (logResult.ok) {
        gitLogEntries.value = logResult.entries;
      }
    } catch (e) {
      debugLog("加载更多提交历史失败:", e);
    } finally {
      gitLogLoadingMore.value = false;
    }
  }

  async function searchGitLog(query: string) {
    const trimmed = query.trim();
    gitLogSearchQuery.value = trimmed;
    gitLogCount.value = 30;
    if (!projectOpened() || !gitIsRepo.value) {
      gitLogSearchLoading.value = false;
      return;
    }

    const token = ++gitLogSearchToken.value;
    gitLogSearchLoading.value = true;
    try {
      const logResult = await fetchGitLog(projectPath(), gitLogCount.value, trimmed || undefined);
      if (token !== gitLogSearchToken.value) return;
      if (logResult.ok) {
        gitLogEntries.value = logResult.entries;
      }
    } catch (e) {
      debugLog("searchGitLog exception:", e);
    } finally {
      if (token === gitLogSearchToken.value) {
        gitLogSearchLoading.value = false;
      }
    }
  }

  async function commitGit() {
    if (!projectOpened() || !gitCommitMessage.value.trim()) return;
    if (!gitStagedFiles.value.length) {
      gitError.value = "请先暂存要提交的文件";
      return;
    }
    gitCommitting.value = true;
    gitError.value = "";
    clearGitDiffCache();
    const commitMessage = gitCommitMessage.value.trim();
    gitStatus.value = gitStatus.value.filter((f) => !f.staged);
    gitCommitMessage.value = "";
    try {
      const result = await commitGitChanges(projectPath(), commitMessage);
      if (!result.ok) {
        gitError.value = result.error || "提交失败";
        gitCommitMessage.value = commitMessage;
        await refreshGitStatus();
        return;
      }
      await refreshGitStatus({ showLoading: false, force: true });
      await refreshGitRemotes();
      onRefreshTree?.();
    } catch (e) {
      gitError.value = toErrorMessage(e, "提交失败");
      await refreshGitStatus({ force: true });
      onRefreshTree?.();
    } finally {
      gitCommitting.value = false;
    }
  }

  const batch = useGitBatchCommit({
    projectPath,
    gitStatus,
    gitError,
    gitBranch,
    gitStatusKnown,
    gitStagedFiles,
    gitUnstagedFiles,
    gitBatchSourceFiles,
    aiConfig,
    configReady,
    confirm,
    onRefreshTree,
    runStageGitFiles,
    refreshGitStatus,
    refreshGitRemotes,
    clearGitDiffCache,
    gitStagingInProgress,
    gitLastStagingAt,
    gitStatusRefreshToken,
  });

  async function stageFile(filePath: string) {
    if (!projectOpened()) return;
    if (isGitPathStageBlocked(filePath)) {
      gitError.value = formatGitStageSkippedHint([filePath]);
      return;
    }
    gitError.value = "";
    clearGitDiffCache();
    const t = Date.now();
    gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: true } : f));
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = t;
    debugLog("stageFile start", { filePath, ts: t });
    try {
      const result = await runStageGitFiles([filePath]);
      debugLog("stageFile API done", { ok: result.ok, elapsed: Date.now() - t });
      if (!result.ok) {
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = toErrorMessage(e, "暂存失败");
      await refreshGitStatus({ showLoading: false, force: true });
    } finally {
      // 先重置时间戳再释放标志，确保 watcher 监听 gitStagingInProgress=false 时
      // 1s 守卫已就绪，防止 flush:sync watcher 在两行之间触发 refresh 拉回旧态导致闪烁
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function unstageFile(filePath: string) {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: false } : f));
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = toErrorMessage(e, "取消暂存失败");
      await refreshGitStatus({ showLoading: false, force: true });
    } finally {
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function stageAll() {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    const filesToStage = gitUnstagedFiles.value.map((f) => f.path);
    if (!filesToStage.length) return;
    const { stageable } = filterStageableGitPaths(filesToStage);
    if (!stageable.length) {
      gitError.value = formatGitStageSkippedHint(filesToStage) || "没有可暂存的文件";
      return;
    }
    gitStatus.value = gitStatus.value.map((f) =>
      stageable.includes(f.path) ? { ...f, staged: true } : f,
    );
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await runStageGitFiles(filesToStage);
      if (!result.ok) {
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = toErrorMessage(e, "暂存失败");
      await refreshGitStatus({ showLoading: false, force: true });
    } finally {
      // 必须先重置时间戳再释放标志，防止 watcher 在两行间隙触发 refresh 拉回旧态闪烁
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function unstageAll() {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    if (!gitStagedFiles.value.length) return;
    // 先保存待取消暂存的文件路径，再做乐观更新（否则 gitStagedFiles computed 会立即变空）
    const pathsToUnstage = gitStagedFiles.value.map((f) => f.path);
    gitStatus.value = gitStatus.value.map((f) => ({ ...f, staged: false }));
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), pathsToUnstage);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = toErrorMessage(e, "取消暂存失败");
      await refreshGitStatus({ showLoading: false, force: true });
    } finally {
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function discardFile(filePath: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    if (!(await confirm(`确定丢弃 ${filePath} 的更改？`, event))) return;
    gitError.value = "";
    clearGitDiffCache();
    gitStatus.value = gitStatus.value.filter((f) => f.path !== filePath);
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await discardGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = toErrorMessage(e, "丢弃更改失败");
      await refreshGitStatus({ showLoading: false, force: true });
      onRefreshTree?.();
    } finally {
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function discardAll(event?: MouseEvent) {
    if (!projectOpened()) return;
    if (!(await confirm("确定丢弃所有未暂存的更改？", event))) return;
    gitError.value = "";
    clearGitDiffCache();
    const unstagedPaths = gitUnstagedFiles.value.map((f) => f.path);
    if (!unstagedPaths.length) return;
    gitStatus.value = gitStagedFiles.value;
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await discardGitFiles(projectPath(), unstagedPaths);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = toErrorMessage(e, "丢弃更改失败");
      await refreshGitStatus({ showLoading: false, force: true });
      onRefreshTree?.();
    } finally {
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function stageSelectedFiles() {
    if (!projectOpened()) return;
    if (!selectedGitFiles.value.length) return;
    gitError.value = "";
    clearGitDiffCache();
    const filesToStage = selectedGitFiles.value.filter(
      (path) => gitUnstagedFiles.value.some((f) => f.path === path),
    );
    if (!filesToStage.length) return;
    const { stageable } = filterStageableGitPaths(filesToStage);
    if (!stageable.length) {
      gitError.value = formatGitStageSkippedHint(filesToStage) || "没有可暂存的文件";
      return;
    }
    gitStatus.value = gitStatus.value.map((f) =>
      stageable.includes(f.path) ? { ...f, staged: true } : f,
    );
    selectedGitFiles.value = [];
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await runStageGitFiles(filesToStage);
      if (!result.ok) {
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = toErrorMessage(e, "暂存失败");
      await refreshGitStatus({ showLoading: false, force: true });
    } finally {
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function unstageSelectedFiles() {
    if (!projectOpened()) return;
    if (!selectedGitFiles.value.length) return;
    gitError.value = "";
    clearGitDiffCache();
    const filesToUnstage = selectedGitFiles.value.filter(
      (path) => gitStagedFiles.value.some((f) => f.path === path),
    );
    if (!filesToUnstage.length) return;
    gitStatus.value = gitStatus.value.map((f) =>
      filesToUnstage.includes(f.path) ? { ...f, staged: false } : f,
    );
    selectedGitFiles.value = [];
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), filesToUnstage);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = toErrorMessage(e, "取消暂存失败");
      await refreshGitStatus({ showLoading: false, force: true });
    } finally {
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function discardSelectedFiles(event?: MouseEvent) {
    if (!projectOpened()) return;
    if (!selectedGitFiles.value.length) return;
    if (!(await confirm(`确定丢弃 ${selectedGitFiles.value.length} 个文件的更改？`, event))) return;
    gitError.value = "";
    clearGitDiffCache();
    const filesToDiscard = selectedGitFiles.value.filter((path) =>
      gitUnstagedFiles.value.some((f) => f.path === path),
    );
    if (!filesToDiscard.length) return;
    gitStatus.value = gitStatus.value.filter((f) => !filesToDiscard.includes(f.path));
    selectedGitFiles.value = [];
    gitStagingInProgress.value = true;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await discardGitFiles(projectPath(), filesToDiscard);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = toErrorMessage(e, "丢弃更改失败");
      await refreshGitStatus({ showLoading: false, force: true });
      onRefreshTree?.();
    } finally {
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  function toggleGitFileSelection(path: string, shiftKey: boolean, ctrlKey: boolean) {
    const allFiles = [
      ...gitStagedFiles.value.map((f) => f.path),
      ...gitUnstagedFiles.value.map((f) => f.path),
    ];
    const uniqueFiles = [...new Set(allFiles)];

    if (shiftKey && selectedGitFiles.value.length > 0) {
      const lastSelected = selectedGitFiles.value[selectedGitFiles.value.length - 1];
      const lastIndex = uniqueFiles.indexOf(lastSelected);
      const currentIndex = uniqueFiles.indexOf(path);
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeFiles = uniqueFiles.slice(start, end + 1);
        if (ctrlKey) {
          const newSet = new Set(selectedGitFiles.value);
          rangeFiles.forEach((f) => newSet.add(f));
          selectedGitFiles.value = Array.from(newSet);
        } else {
          selectedGitFiles.value = rangeFiles;
        }
        return;
      }
    }

    if (ctrlKey) {
      const index = selectedGitFiles.value.indexOf(path);
      if (index === -1) {
        selectedGitFiles.value = [...selectedGitFiles.value, path];
      } else {
        selectedGitFiles.value = selectedGitFiles.value.filter((f) => f !== path);
      }
    } else {
      if (selectedGitFiles.value.length === 1 && selectedGitFiles.value[0] === path) {
        selectedGitFiles.value = [];
      } else {
        selectedGitFiles.value = [path];
      }
    }
  }

  function clearGitSelection() {
    selectedGitFiles.value = [];
  }

  async function generateCommitMessage() {
    if (!projectOpened() || !gitStagedFiles.value.length) return;
    if (!configReady()) {
      gitError.value = "请先配置 AI 模型";
      return;
    }
    gitError.value = "";
    try {
      gitGenStep.value = "获取变更…";
      await new Promise((r) => setTimeout(r, 100));

      gitGenStep.value = "AI 生成中…";
      let streamText = "";
      const cfg = aiConfig();
      const result = await generateCommitMessageApi(
        projectPath(),
        cfg.endpoint.trim(),
        cfg.apiKey.trim(),
        cfg.model.trim(),
        (delta) => {
          streamText += delta;
          gitCommitMessage.value = streamText.replace(/^["'"']|["'"']$/g, "").trim();
        },
      );
      if (!result.ok) {
        gitError.value = result.error || "AI 生成失败";
        return;
      }
      if (!result.message) {
        gitError.value = "AI 未返回内容";
        return;
      }
      gitGenStep.value = "完成 ✓";
      gitCommitMessage.value = result.message;
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      gitError.value = toErrorMessage(e, "AI 生成提交信息失败");
    } finally {
      gitGenStep.value = "";
    }
  }

  async function aiCommitAndPush() {
    if (!projectOpened() || !gitStagedFiles.value.length) return;
    if (!configReady()) {
      gitError.value = "请先配置 AI 模型";
      return;
    }
    gitError.value = "";
    try {
      gitAiPushStep.value = "生成中…";
      await new Promise((r) => setTimeout(r, 100));

      const cfg = aiConfig();
      let streamText = "";
      const genResult = await generateCommitMessageApi(
        projectPath(),
        cfg.endpoint.trim(),
        cfg.apiKey.trim(),
        cfg.model.trim(),
        (delta) => {
          streamText += delta;
          gitCommitMessage.value = streamText.replace(/^["'"']|["'"']$/g, "").trim();
        },
      );
      if (!genResult.ok) {
        gitError.value = genResult.error || "AI 生成提交信息失败";
        return;
      }
      if (!genResult.message) {
        gitError.value = "AI 未返回内容";
        return;
      }
      gitCommitMessage.value = genResult.message;

      gitAiPushStep.value = "提交中…";
      await new Promise((r) => setTimeout(r, 100));
      clearGitDiffCache();
      const commitResult = await commitGitChanges(projectPath(), gitCommitMessage.value.trim());
      if (!commitResult.ok) {
        gitError.value = commitResult.error || "提交失败";
        await refreshGitStatus();
        return;
      }
      await refreshGitStatus({ showLoading: false, force: true });

      gitAiPushStep.value = "推送中…";
      await new Promise((r) => setTimeout(r, 100));
      const pushResult = await gitPushRemote(projectPath());
      if (!pushResult.ok) {
        gitError.value = pushResult.error || "推送失败";
        await refreshGitRemotes();
        return;
      }
      await refreshGitStatus({ showLoading: false, force: true });
      await refreshGitRemotes();
      await refreshGitLogIfOpen();
      await refreshGitAheadCommits();

      gitAiPushStep.value = "完成 ✓";
      gitCommitMessage.value = "";
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      gitError.value = toErrorMessage(e, "AI 一键推送失败");
      await refreshGitStatus();
    } finally {
      gitAiPushStep.value = "";
    }
  }

  async function refreshGitAheadCommits(aheadCount?: number) {
    const ahead = aheadCount ?? gitAhead.value;
    if (!projectOpened() || !gitIsRepo.value || ahead === 0) {
      gitAheadCommits.value = [];
      return;
    }
    gitAheadCommitsLoading.value = true;
    try {
      const result = await fetchAheadCommits(projectPath(), 20);
      if (result.ok) {
        gitAheadCommits.value = result.entries;
      }
    } catch {
      // ignore
    } finally {
      gitAheadCommitsLoading.value = false;
    }
  }

  async function refreshGitRemotes() {
    if (!projectOpened() || !gitIsRepo.value) return;
    gitRemoteLoading.value = true;
    try {
      const result = await fetchGitRemotes(projectPath());
      if (result.ok) {
        gitRemotes.value = result.remotes;
        gitTrackingBranch.value = result.trackingBranch;
        gitAhead.value = result.ahead;
        gitBehind.value = result.behind;
        // 用刚获取的 ahead 值刷新待推送提交，避免异步竞态
        void refreshGitAheadCommits(result.ahead);
      }
    } catch {
      // ignore
    } finally {
      gitRemoteLoading.value = false;
    }
  }

  async function doFetch() {
    if (!projectOpened()) return;
    gitRemoteAction.value = "fetch";
    gitError.value = "";
    try {
      const result = await gitFetchRemote(projectPath());
      if (!result.ok) {
        gitError.value = result.error || "Fetch 失败";
        return;
      }
      await refreshGitRemotes();
    } catch (e) {
      gitError.value = toErrorMessage(e, "Fetch 失败");
    } finally {
      gitRemoteAction.value = "";
    }
  }

  async function doPull() {
    if (!projectOpened()) return;
    gitRemoteAction.value = "pull";
    gitError.value = "";
    try {
      const result = await gitPullRemote(projectPath());
      if (!result.ok) {
        gitError.value = result.error || "Pull 失败";
        return;
      }
      await refreshGitStatus();
      await refreshGitRemotes();
      await refreshGitLogIfOpen();
    } catch (e) {
      gitError.value = toErrorMessage(e, "Pull 失败");
    } finally {
      gitRemoteAction.value = "";
    }
  }

  async function doPush() {
    if (!projectOpened()) return;
    gitRemoteAction.value = "push";
    gitError.value = "";
    try {
      const result = await gitPushRemote(projectPath());
      if (!result.ok) {
        gitError.value = result.error || "Push 失败";
        return;
      }
      await refreshGitRemotes();
      await refreshGitLogIfOpen();
      await refreshGitAheadCommits();
    } catch (e) {
      gitError.value = toErrorMessage(e, "Push 失败");
    } finally {
      gitRemoteAction.value = "";
    }
  }

  async function refreshGitStashes() {
    if (!projectOpened()) return;
    try {
      const result = await gitStashListRemote(projectPath());
      if (result.ok) {
        gitStashes.value = result.stashes || [];
      }
    } catch {
      // ignore
    }
  }

  async function doStashSave() {
    if (!projectOpened()) return;
    gitStashAction.value = "save";
    gitError.value = "";
    try {
      const result = await gitStashSaveRemote(projectPath(), gitStashMessage.value.trim() || undefined);
      if (!result.ok) {
        gitError.value = result.error || "贮藏失败";
        return;
      }
      gitStashMessage.value = "";
      await refreshGitStashes();
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      gitError.value = toErrorMessage(e, "贮藏失败");
    } finally {
      gitStashAction.value = "";
    }
  }

  async function doStashApply(stashIndex: string) {
    if (!projectOpened()) return;
    if (!(await confirm(`确定应用 stash@{${stashIndex}}？可能产生冲突。`))) return;
    gitStashAction.value = `apply-${stashIndex}`;
    gitError.value = "";
    try {
      const result = await gitStashApplyRemote(projectPath(), Number(stashIndex));
      if (!result.ok) {
        gitError.value = result.error || "应用贮藏失败";
        return;
      }
      await refreshGitStashes();
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      gitError.value = toErrorMessage(e, "应用贮藏失败");
    } finally {
      gitStashAction.value = "";
    }
  }

  async function doStashDrop(stashIndex: string) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定要删除 stash@{${stashIndex}} 吗？此操作不可撤销。`);
    if (!ok) return;
    gitStashAction.value = `drop-${stashIndex}`;
    gitError.value = "";
    try {
      const result = await gitStashDropRemote(projectPath(), Number(stashIndex));
      if (!result.ok) {
        gitError.value = result.error || "删除贮藏失败";
        return;
      }
      await refreshGitStashes();
    } catch (e) {
      gitError.value = toErrorMessage(e, "删除贮藏失败");
    } finally {
      gitStashAction.value = "";
    }
  }

  async function refreshGitBranches() {
    if (!projectOpened() || !gitIsRepo.value) return;
    try {
      const result = await fetchGitBranches(projectPath());
      if (result.ok) {
        gitBranches.value = result.branches;
      }
    } catch (e) {
      debugLog("refreshGitBranches exception:", e);
    }
  }

  async function checkoutBranch(branchName: string, createNew = false, startPoint?: string) {
    if (!projectOpened()) return;
    gitLoading.value = true;
    gitError.value = "";
    try {
      const result = await gitCheckoutBranchApi(projectPath(), branchName, createNew, startPoint);
      if (!result.ok) {
        gitError.value = result.error || "切换分支失败";
        return;
      }
      await refreshGitStatus({ force: true });
      onRefreshTree?.();
    } catch (e) {
      gitError.value = toErrorMessage(e, "切换分支失败");
    } finally {
      gitLoading.value = false;
    }
  }

  async function createBranch(branchName: string, startPoint?: string) {
    await checkoutBranch(branchName, true, startPoint);
  }

  async function deleteBranch(branchName: string, force = false) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定要删除本地分支 ${branchName} 吗？`);
    if (!ok) return;
    gitLoading.value = true;
    gitError.value = "";
    try {
      const result = await gitDeleteBranchApi(projectPath(), branchName, force);
      if (!result.ok) {
        gitError.value = result.error || "删除分支失败";
        return;
      }
      await refreshGitBranches();
    } catch (e) {
      gitError.value = toErrorMessage(e, "删除分支失败");
    } finally {
      gitLoading.value = false;
    }
  }

  async function resolveConflict(filePath: string, side: GitConflictSide = "ours") {
    if (!projectOpened()) return;
    gitError.value = "";
    try {
      const result = await gitResolveConflict(projectPath(), filePath, side);
      if (!result.ok) {
        gitError.value = result.error || "解决冲突失败";
        return;
      }
      await refreshGitStatus({ force: true });
    } catch (e) {
      gitError.value = toErrorMessage(e, "解决冲突失败");
    }
  }

  async function doMerge(source: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定合并分支 ${source} 到当前分支？`, event);
    if (!ok) return;
    gitError.value = "";
    gitMergeInProgress.value = true;
    try {
      const result = await gitMerge(projectPath(), source);
      if (!result.ok) {
        gitError.value = result.error || "合并失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
      onRefreshTree?.();
    } catch (e) {
      gitError.value = toErrorMessage(e, "合并失败");
    } finally {
      gitMergeInProgress.value = false;
    }
  }

  async function doMergeAbort(event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm("确定中止合并？", event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitMergeAbort(projectPath());
      if (!result.ok) {
        gitError.value = result.error || "中止合并失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
    } catch (e) {
      gitError.value = toErrorMessage(e, "中止合并失败");
    }
  }

  async function doRebase(onto: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定变基到 ${onto}？`, event);
    if (!ok) return;
    gitError.value = "";
    gitRebaseInProgress.value = true;
    try {
      const result = await gitRebase(projectPath(), onto);
      if (!result.ok) {
        gitError.value = result.error || "变基失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
    } catch (e) {
      gitError.value = toErrorMessage(e, "变基失败");
    } finally {
      gitRebaseInProgress.value = false;
    }
  }

  async function doRebaseAbort(event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm("确定中止变基？", event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitRebaseAbort(projectPath());
      if (!result.ok) {
        gitError.value = result.error || "中止变基失败";
        return;
      }
      await refreshGitStatus({ force: true });
    } catch (e) {
      gitError.value = toErrorMessage(e, "中止变基失败");
    }
  }

  async function doCherryPick(hash: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定拣选提交 ${hash.slice(0, 8)}？`, event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitCherryPick(projectPath(), hash);
      if (!result.ok) {
        gitError.value = result.error || "拣选失败";
        return;
      }
      await refreshGitStatus({ force: true });
    } catch (e) {
      gitError.value = toErrorMessage(e, "拣选失败");
    }
  }

  async function doRevertCommit(hash: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定还原提交 ${hash.slice(0, 8)}？`, event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitRevertCommit(projectPath(), hash);
      if (!result.ok) {
        gitError.value = result.error || "还原提交失败";
        return;
      }
      await refreshGitStatus({ force: true });
    } catch (e) {
      gitError.value = toErrorMessage(e, "还原提交失败");
    }
  }

  async function doAmend(event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm("确定修改上次提交？", event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitAmend(projectPath(), gitCommitMessage.value.trim() || undefined);
      if (!result.ok) {
        gitError.value = result.error || "修改提交失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
    } catch (e) {
      gitError.value = toErrorMessage(e, "修改提交失败");
    }
  }

  async function doCreateTag(name?: string, hash?: string, event?: MouseEvent) {
    const tagName = name || gitTagNameInput.value.trim();
    if (!projectOpened() || !tagName) return;
    const ok = await confirm(`确定创建标签 ${tagName}？`, event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitTagCreate(projectPath(), tagName, hash);
      if (!result.ok) {
        gitError.value = result.error || "创建标签失败";
        return;
      }
      gitTagNameInput.value = "";
      const tagsResult = await fetchGitTags(projectPath());
      if (tagsResult.ok) gitTags.value = tagsResult.tags;
    } catch (e) {
      gitError.value = toErrorMessage(e, "创建标签失败");
    }
  }

  async function doDeleteTag(name: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定删除标签 ${name}？`, event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitTagDelete(projectPath(), name);
      if (!result.ok) {
        gitError.value = result.error || "删除标签失败";
        return;
      }
      const tagsResult = await fetchGitTags(projectPath());
      if (tagsResult.ok) gitTags.value = tagsResult.tags;
    } catch (e) {
      gitError.value = toErrorMessage(e, "删除标签失败");
    }
  }

  async function doSubmoduleUpdate(event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm("确定更新子模块？", event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitSubmoduleUpdate(projectPath());
      if (!result.ok) {
        gitError.value = result.error || "子模块更新失败";
        return;
      }
      const subResult = await fetchGitSubmodules(projectPath());
      if (subResult.ok) gitSubmodules.value = subResult.submodules;
    } catch (e) {
      gitError.value = toErrorMessage(e, "子模块更新失败");
    }
  }

  async function doResetCommit(hash: string, mode: GitResetMode = "mixed", shortHash?: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const label = shortHash || hash.slice(0, 8);
    const ok = await confirm(`确定重置到 ${label}（${mode} 模式）？此操作可能丢失更改。`, event);
    if (!ok) return;
    gitError.value = "";
    try {
      const result = await gitResetToCommit(projectPath(), hash, mode);
      if (!result.ok) {
        gitError.value = result.error || "重置失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
      onRefreshTree?.();
    } catch (e) {
      gitError.value = toErrorMessage(e, "重置失败");
    }
  }

  async function undoLastCommit(event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm("确定撤销上次提交（soft reset）？", event);
    if (!ok) return;
    await doResetCommit("HEAD~1", "soft", "HEAD~1", event);
  }

  async function doStashPop(stashIndex: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定弹出 stash@{${stashIndex}}？`, event);
    if (!ok) return;
    gitStashAction.value = `pop-${stashIndex}`;
    gitError.value = "";
    try {
      const result = await gitStashPopRemote(projectPath(), Number(stashIndex));
      if (!result.ok) {
        gitError.value = result.error || "弹出贮藏失败";
        return;
      }
      await refreshGitStashes();
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      gitError.value = toErrorMessage(e, "弹出贮藏失败");
    } finally {
      gitStashAction.value = "";
    }
  }

  return {
    gitBranches,
    refreshGitBranches,
    checkoutBranch,
    createBranch,
    deleteBranch,
    resolveConflict,
    doMerge,
    doMergeAbort,
    doRebase,
    doRebaseAbort,
    doCherryPick,
    doRevertCommit,
    doAmend,
    doCreateTag,
    doDeleteTag,
    doSubmoduleUpdate,
    doResetCommit,
    undoLastCommit,
    doStashPop,
    gitSecondaryHint,
    gitSelectedRemote,
    gitMergeInProgress,
    gitRebaseInProgress,
    gitAdvancedOpen,
    gitAdvancedAction,
    gitTags,
    gitSubmodules,
    gitTagNameInput,
    gitMergeTarget,
    gitRebaseOnto,
    gitConflictedFiles,
    gitPanelMode,
    projectPanelView,
    gitStatus,
    gitBranch,
    gitHeadCommit,
    gitIsRepo,
    gitStatusKnown,
    gitLoading,
    gitError,
    gitCommitMessage,
    gitCommitting,
    gitGenStep,
    gitLogEntries,
    gitLogOpen,
    gitLogCount,
    gitLogSearchQuery,
    hasMoreGitLog,
    gitLogLoadingMore,
    gitLogSearchLoading,
    loadMoreGitLog,
    searchGitLog,
    gitStagedOpen,
    gitUnstagedOpen,
    expandedGitLogEntries,
    gitStashSectionOpen,
    gitLocalChangesOpen,
    gitTreeExpandedDirs,
    selectedGitFiles,
    gitDiffLoadingKey,
    gitDiffContentCache,
    gitRemotes,
    gitTrackingBranch,
    gitAhead,
    gitBehind,
    gitRemoteLoading,
    gitRemoteAction,
    gitStashes,
    gitStashOpen,
    gitStashAction,
    gitStashMessage,
    gitAiPushStep,
    gitAheadCommits,
    gitAheadCommitsOpen,
    gitAheadCommitsLoading,

    gitStagedFiles,
    gitUnstagedFiles,
    gitChangeCount,
    canGitCommit,

    ...batch,

    clearGitDiffCache,
    evictOldestCacheEntry,
    gitStagingInProgress,
    gitLastStagingAt,
    gitStatusIcon,
    gitStatusColor,
    isGitLogEntryOpen,
    toggleGitLogEntry,
    gitHistoryDiffKey,
    gitWorkingTreeDiffKey,
    resetGitPanelState,
    refreshGitStatus,
    commitGit,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    discardFile,
    discardAll,
    stageSelectedFiles,
    unstageSelectedFiles,
    discardSelectedFiles,
    toggleGitFileSelection,
    clearGitSelection,
    generateCommitMessage,
    aiCommitAndPush,
    refreshGitRemotes,
    refreshGitAheadCommits,
    doFetch,
    doPull,
    doPush,
    refreshGitStashes,
    doStashSave,
    doStashApply,
    doStashDrop,
  };
}
