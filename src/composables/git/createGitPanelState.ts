import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { lsGet, lsSet } from "../../utils/localStorageSafe";
import { sortedUnstagedPaths } from "../../utils/gitBatchDraftStorage";
import { parseGitFileSelectionKey, pruneGitFileSelection } from "../../utils/gitHelpers";
import { fetchGitLog, type GitHunkInfo, type GitStatusFile } from "../../services/vibeGitClient";
import type { GitFileDiff } from "./types";

export type GitPanelMode = "files" | "git" | "sessions" | "project";
export type ProjectPanelView = "knowledge" | "health" | "fix" | "map";

const GIT_PANEL_MODE_KEY = "vibe-coding-git-panel-mode";
const GIT_DIFF_CACHE_MAX = 30;
const PROJECT_PANEL_VIEW_KEY = "vibe-coding-project-panel-view";

export type HunkLoader = (filePath: string, staged?: boolean) => Promise<GitHunkInfo[]>;

export interface GitPanelState {
  gitPanelMode: Ref<GitPanelMode>;
  projectPanelView: Ref<ProjectPanelView>;
  gitStatus: Ref<GitStatusFile[]>;
  gitBranch: Ref<string>;
  gitHeadCommit: Ref<string>;
  gitIsRepo: Ref<boolean>;
  /** Discovered git repos under the project root (project-root repo first). */
  gitRepos: Ref<import("../../services/vibeGitClient").GitRepoInfo[]>;
  /** Absolute path of the repo the Git panel currently operates on. */
  gitActiveRepoPath: Ref<string>;
  gitStatusKnown: Ref<boolean>;
  gitLoading: Ref<boolean>;
  gitError: Ref<string>;
  gitStatusRefreshToken: Ref<number>;
  gitLogSearchToken: Ref<number>;
  gitCommitMessage: Ref<string>;
  gitCommitting: Ref<boolean>;
  gitGenStep: Ref<string>;
  gitLogEntries: Ref<import("../../services/vibeGitClient").GitLogEntry[]>;
  gitLogOpen: Ref<boolean>;
  gitLogCount: Ref<number>;
  gitLogSearchQuery: Ref<string>;
  /** When true, log uses `git log --all` (all branches/refs). */
  gitLogAllBranches: Ref<boolean>;
  gitLogBranchFilter: Ref<string>;
  gitLogAuthorFilter: Ref<string>;
  gitLogPathFilter: Ref<string>;
  gitLogSince: Ref<string>;
  gitLogUntil: Ref<string>;
  gitLogLoadingMore: Ref<boolean>;
  gitLogSearchLoading: Ref<boolean>;
  hasMoreGitLog: ComputedRef<boolean>;
  gitStagedOpen: Ref<boolean>;
  gitUnstagedOpen: Ref<boolean>;
  gitUntrackedOpen: Ref<boolean>;
  expandedGitLogEntries: Ref<Set<string>>;
  gitStashSectionOpen: Ref<boolean>;
  gitLocalChangesOpen: Ref<boolean>;
  gitIgnoredLocalFiles: Ref<string[]>;
  gitIgnoredLocalOpen: Ref<boolean>;
  /** 距「正在加载 Git 状态…」开始已等待的毫秒数（诊断用，超时兜底后停止累加） */
  gitLoadingElapsedMs: Ref<number>;
  selectedGitFiles: Ref<string[]>;
  gitDiffLoadingKey: Ref<string>;
  gitDiffContentCache: Ref<Record<string, GitFileDiff>>;
  gitStagingInProgress: Ref<boolean>;
  gitLastStagingAt: Ref<number>;
  gitRemotes: Ref<import("../../services/vibeGitClient").GitRemoteInfo[]>;
  gitTrackingBranch: Ref<string>;
  gitAhead: Ref<number>;
  gitBehind: Ref<number>;
  gitRemoteLoading: Ref<boolean>;
  gitRemoteAction: Ref<string>;
  gitStashes: Ref<Array<{ index: string; message: string }>>;
  gitStashOpen: Ref<boolean>;
  gitStashAction: Ref<string>;
  gitStashMessage: Ref<string>;
  gitAiPushStep: Ref<string>;
  gitAheadCommits: Ref<import("../../services/vibeGitClient").GitLogEntry[]>;
  gitAheadCommitsOpen: Ref<boolean>;
  gitAheadCommitsLoading: Ref<boolean>;
  gitBehindCommits: Ref<import("../../services/vibeGitClient").GitLogEntry[]>;
  gitBehindCommitsOpen: Ref<boolean>;
  gitBehindCommitsLoading: Ref<boolean>;
  gitBranches: Ref<import("../../services/vibeGitClient").GitBranchInfo[]>;
  gitSecondaryHint: Ref<string>;
  gitSelectedRemote: Ref<string>;
  gitMergeInProgress: Ref<boolean>;
  gitRebaseInProgress: Ref<boolean>;
  gitAdvancedOpen: Ref<boolean>;
  gitAdvancedAction: Ref<string>;
  gitTags: Ref<import("../../services/vibeGitClient").GitTagInfo[]>;
  gitSubmodules: Ref<import("../../services/vibeGitClient").GitSubmoduleInfo[]>;
  gitTagNameInput: Ref<string>;
  gitMergeTarget: Ref<string>;
  gitRebaseOnto: Ref<string>;
  gitConflictedFiles: ComputedRef<GitStatusFile[]>;
  gitStagedFiles: ComputedRef<GitStatusFile[]>;
  gitUnstagedFiles: ComputedRef<GitStatusFile[]>;
  gitModifiedFiles: ComputedRef<GitStatusFile[]>;
  gitUntrackedFiles: ComputedRef<GitStatusFile[]>;
  gitHunkTargetFile: Ref<string>;
  gitHunks: Ref<GitHunkInfo[]>;
  gitStagedHunks: Ref<GitHunkInfo[]>;
  gitHunkStagingIndex: Ref<number | null>;
  gitHunkUnstagingIndex: Ref<number | null>;
  gitBatchSourceFiles: ComputedRef<GitStatusFile[]>;
  gitChangeCount: ComputedRef<number>;
  canGitCommit: ComputedRef<boolean>;
  hunkLoadToken: { current: number };
  clearGitDiffCache: () => void;
  evictOldestCacheEntry: () => void;
  isGitLogEntryOpen: (hash: string) => boolean;
  toggleGitLogEntry: (hash: string) => void;
  gitHistoryDiffKey: (hash: string, filePath: string, oldPath?: string) => string;
  gitWorkingTreeDiffKey: (filePath: string, staged?: boolean) => string;
}

export function createGitPanelState(
  projectPath: () => string,
  projectOpened: () => boolean,
  hunkLoaderHolder: { load?: HunkLoader },
): GitPanelState {
  const _storedPanelMode = lsGet(GIT_PANEL_MODE_KEY);
  if (_storedPanelMode === "knowledge" || _storedPanelMode === "health") {
    lsSet(GIT_PANEL_MODE_KEY, "project");
    lsSet(
      PROJECT_PANEL_VIEW_KEY,
      _storedPanelMode === "health" ? "health" : "knowledge",
    );
  }

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
  const gitRepos = ref<import("../../services/vibeGitClient").GitRepoInfo[]>([]);
  const gitActiveRepoPath = ref("");
  const gitStatusKnown = ref(false);
  const gitLoading = ref(false);
  const gitError = ref("");
  const gitStatusRefreshToken = ref(0);
  const gitLogSearchToken = ref(0);
  const gitCommitMessage = ref("");
  const gitCommitting = ref(false);
  const gitGenStep = ref("");
  const gitLogEntries = ref<import("../../services/vibeGitClient").GitLogEntry[]>([]);
  const gitLogOpen = ref(false);
  const gitLogCount = ref(30);
  const gitLogSearchQuery = ref("");
  const gitLogAllBranches = ref(false);
  const gitLogBranchFilter = ref("");
  const gitLogAuthorFilter = ref("");
  const gitLogPathFilter = ref("");
  const gitLogSince = ref("");
  const gitLogUntil = ref("");
  const gitLogLoadingMore = ref(false);
  const gitLogSearchLoading = ref(false);
  const hasMoreGitLog = computed(() => {
    return gitLogEntries.value.length === gitLogCount.value;
  });
  const gitStagedOpen = ref(true);
  const gitUnstagedOpen = ref(true);
  const gitUntrackedOpen = ref(true);
  const expandedGitLogEntries = ref<Set<string>>(new Set());
  const gitStashSectionOpen = ref(false);
  const gitLocalChangesOpen = ref(false);
  const gitIgnoredLocalFiles = ref<string[]>([]);
  const gitIgnoredLocalOpen = ref(false);
  const gitLoadingElapsedMs = ref(0);
  const selectedGitFiles = ref<string[]>([]);
  const gitDiffLoadingKey = ref("");
  const gitDiffContentCache = ref<Record<string, GitFileDiff>>({});
  const gitStagingInProgress = ref(false);
  const gitLastStagingAt = ref(0);

  function evictOldestCacheEntry() {
    const keys = Object.keys(gitDiffContentCache.value);
    if (keys.length <= GIT_DIFF_CACHE_MAX) return;
    const toRemove = keys.slice(0, keys.length - GIT_DIFF_CACHE_MAX);
    const next = { ...gitDiffContentCache.value };
    for (const k of toRemove) delete next[k];
    gitDiffContentCache.value = next;
  }

  const gitRemotes = ref<import("../../services/vibeGitClient").GitRemoteInfo[]>([]);
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
  const gitAheadCommits = ref<import("../../services/vibeGitClient").GitLogEntry[]>([]);
  const gitAheadCommitsOpen = ref(false);
  const gitAheadCommitsLoading = ref(false);
  const gitBehindCommits = ref<import("../../services/vibeGitClient").GitLogEntry[]>([]);
  const gitBehindCommitsOpen = ref(false);
  const gitBehindCommitsLoading = ref(false);
  const gitBranches = ref<import("../../services/vibeGitClient").GitBranchInfo[]>([]);
  const gitSecondaryHint = ref("");
  const gitSelectedRemote = ref("");
  const gitMergeInProgress = ref(false);
  const gitRebaseInProgress = ref(false);
  const gitAdvancedOpen = ref(false);
  const gitAdvancedAction = ref("");
  const gitTags = ref<import("../../services/vibeGitClient").GitTagInfo[]>([]);
  const gitSubmodules = ref<import("../../services/vibeGitClient").GitSubmoduleInfo[]>([]);
  const gitTagNameInput = ref("");
  const gitMergeTarget = ref("");
  const gitRebaseOnto = ref("");

  watch(gitLogOpen, (open) => {
    if (open) {
      gitStagedOpen.value = false;
      gitUnstagedOpen.value = false;
      gitAheadCommitsOpen.value = false;
      gitBehindCommitsOpen.value = false;
      gitStashOpen.value = false;
      if (projectOpened() && gitIsRepo.value) {
        const openSearch = gitLogSearchQuery.value || undefined;
        gitLogLoadingMore.value = true;
        fetchGitLog(projectPath(), gitLogCount.value, openSearch, {
          all: gitLogAllBranches.value,
          author: gitLogAuthorFilter.value,
          path: gitLogPathFilter.value,
          since: gitLogSince.value,
          until: gitLogUntil.value,
          branch: gitLogBranchFilter.value,
        })
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

  // Keep multi-select bar in sync when status empties (commit/refresh),
  // a file leaves a side, or persisted selection is restored against a clean tree.
  watch(
    [gitStatus, selectedGitFiles, gitIgnoredLocalFiles],
    ([files, selected]) => {
      if (!selected.length) return;
      const withIgnored: Array<{ path: string; staged: boolean }> = [
        ...files,
        ...gitIgnoredLocalFiles.value.map((p) => ({ path: p, staged: false })),
      ];
      const pruned = pruneGitFileSelection(selected, withIgnored);
      if (pruned.length !== selected.length || pruned.some((key, i) => key !== selected[i])) {
        selectedGitFiles.value = pruned;
      }
    },
  );

  const gitConflictedFiles = computed(() => {
    const seen = new Set<string>();
    const result: GitStatusFile[] = [];
    for (const f of gitStatus.value) {
      if (f.status !== "conflicted" || seen.has(f.path)) continue;
      seen.add(f.path);
      result.push(f);
    }
    return result;
  });
  const gitStagedFiles = computed(() => {
    const seen = new Set<string>();
    const result: GitStatusFile[] = [];
    for (const f of gitStatus.value) {
      if (f.status === "conflicted") continue;
      if (f.staged && !seen.has(f.path)) {
        seen.add(f.path);
        result.push(f);
      }
    }
    return result;
  });
  const gitUnstagedFiles = computed(() => {
    const unstaged = gitStatus.value.filter(
      (f) => !f.staged && f.status !== "conflicted",
    );
    const paths = sortedUnstagedPaths(unstaged.map((f) => f.path));
    const byPath = new Map(unstaged.map((f) => [f.path, f]));
    return paths.map((p) => byPath.get(p)).filter((f): f is GitStatusFile => f != null);
  });
  const gitModifiedFiles = computed(() =>
    gitUnstagedFiles.value.filter((f) => f.status !== "untracked"),
  );
  const gitUntrackedFiles = computed(() =>
    gitUnstagedFiles.value.filter((f) => f.status === "untracked"),
  );
  const gitHunkTargetFile = ref("");
  const gitHunks = ref<GitHunkInfo[]>([]);
  const gitStagedHunks = ref<GitHunkInfo[]>([]);
  const gitHunkStagingIndex = ref<number | null>(null);
  const gitHunkUnstagingIndex = ref<number | null>(null);
  const hunkLoadToken = { current: 0 };

  const gitBatchSourceFiles = computed(() => {
    if (gitUnstagedFiles.value.length > 0) return gitUnstagedFiles.value;
    return gitStagedFiles.value;
  });
  const gitChangeCount = computed(() => {
    const paths = new Set<string>();
    for (const f of gitStagedFiles.value) paths.add(f.path);
    for (const f of gitUnstagedFiles.value) paths.add(f.path);
    for (const f of gitConflictedFiles.value) paths.add(f.path);
    return paths.size;
  });
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

  watch(
    () =>
      [
        selectedGitFiles.value.join("\n"),
        gitModifiedFiles.value.map((f) => f.path).join("\n"),
        gitStagedFiles.value.map((f) => f.path).join("\n"),
      ] as const,
    async () => {
      const selected = selectedGitFiles.value;
      const token = ++hunkLoadToken.current;
      if (selected.length !== 1) {
        gitHunkTargetFile.value = "";
        gitHunks.value = [];
        gitStagedHunks.value = [];
        return;
      }
      const parsed = parseGitFileSelectionKey(selected[0]);
      if (!parsed) {
        gitHunkTargetFile.value = "";
        gitHunks.value = [];
        gitStagedHunks.value = [];
        return;
      }
      const path = parsed.path;
      const hasUnstaged = gitModifiedFiles.value.some((f) => f.path === path);
      const hasStaged = gitStagedFiles.value.some((f) => f.path === path);
      if (!hasUnstaged && !hasStaged) {
        gitHunkTargetFile.value = "";
        gitHunks.value = [];
        gitStagedHunks.value = [];
        return;
      }
      gitHunkTargetFile.value = path;
      const load = hunkLoaderHolder.load;
      if (!load) return;
      const [unstaged, staged] = await Promise.all([
        hasUnstaged ? load(path, false) : Promise.resolve([] as GitHunkInfo[]),
        hasStaged ? load(path, true) : Promise.resolve([] as GitHunkInfo[]),
      ]);
      if (token !== hunkLoadToken.current) return;
      gitHunks.value = unstaged;
      gitStagedHunks.value = staged;
    },
  );

  return {
    gitPanelMode,
    projectPanelView,
    gitStatus,
    gitBranch,
    gitHeadCommit,
    gitIsRepo,
    gitRepos,
    gitActiveRepoPath,
    gitStatusKnown,
    gitLoading,
    gitError,
    gitStatusRefreshToken,
    gitLogSearchToken,
    gitCommitMessage,
    gitCommitting,
    gitGenStep,
    gitLogEntries,
    gitLogOpen,
    gitLogCount,
    gitLogSearchQuery,
    gitLogAllBranches,
    gitLogBranchFilter,
    gitLogAuthorFilter,
    gitLogPathFilter,
    gitLogSince,
    gitLogUntil,
    gitLogLoadingMore,
    gitLogSearchLoading,
    hasMoreGitLog,
    gitStagedOpen,
    gitUnstagedOpen,
    gitUntrackedOpen,
    expandedGitLogEntries,
    gitStashSectionOpen,
    gitLocalChangesOpen,
    gitIgnoredLocalFiles,
    gitIgnoredLocalOpen,
    gitLoadingElapsedMs,
    selectedGitFiles,
    gitDiffLoadingKey,
    gitDiffContentCache,
    gitStagingInProgress,
    gitLastStagingAt,
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
    gitBehindCommits,
    gitBehindCommitsOpen,
    gitBehindCommitsLoading,
    gitBranches,
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
    gitStagedFiles,
    gitUnstagedFiles,
    gitModifiedFiles,
    gitUntrackedFiles,
    gitHunkTargetFile,
    gitHunks,
    gitStagedHunks,
    gitHunkStagingIndex,
    gitHunkUnstagingIndex,
    gitBatchSourceFiles,
    gitChangeCount,
    canGitCommit,
    hunkLoadToken,
    clearGitDiffCache,
    evictOldestCacheEntry,
    isGitLogEntryOpen,
    toggleGitLogEntry,
    gitHistoryDiffKey,
    gitWorkingTreeDiffKey,
  };
}
