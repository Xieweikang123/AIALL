import { gitStatusIcon, gitStatusColor } from "../utils/gitHelpers";
import { useGitBatchCommit } from "./useGitBatchCommit";
import { createGitPanelState } from "./git/createGitPanelState";
import { useGitStatusRefresh } from "./git/useGitStatusRefresh";
import { useGitStagingActions } from "./git/useGitStagingActions";
import { useGitCommitActions } from "./git/useGitCommitActions";
import { useGitRemoteActions } from "./git/useGitRemoteActions";
import { useGitAdvancedActions } from "./git/useGitAdvancedActions";

export type { GitFileDiff, BatchGroup } from "./git/types";

export function useGitPanel(
  projectPath: () => string,
  projectOpened: () => boolean,
  aiConfig: () => { endpoint: string; apiKey: string; model: string },
  configReady: () => boolean,
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>,
  onRefreshTree?: () => void,
) {
  const hunkLoaderHolder: { load?: (filePath: string, staged?: boolean) => Promise<import("../services/vibeGitClient").GitHunkInfo[]> } = {};
  const state = createGitPanelState(projectPath, projectOpened, hunkLoaderHolder);

  const afterStatusRefresh = {
    refreshGitRemotes: async () => {},
    refreshGitStashes: async () => {},
    refreshGitBranches: async () => {},
    refreshGitLogIfOpen: async (_pathOverride?: string) => {},
  };

  let batchReset: (() => void) | undefined;
  let batchSync: (() => void) | undefined;
  let suggestBatchCommit: (() => void) | undefined;

  const statusRefresh = useGitStatusRefresh({
    projectPath,
    projectOpened,
    state,
    afterStatusRefresh,
    onResetBatch: () => batchReset?.(),
    syncBatchStateWithSourceFiles: () => batchSync?.(),
  });

  const remoteActions = useGitRemoteActions({
    projectPath,
    projectOpened,
    state,
    confirm,
    refreshGitStatus: statusRefresh.refreshGitStatus,
    refreshGitLogIfOpen: statusRefresh.refreshGitLogIfOpen,
  });

  afterStatusRefresh.refreshGitRemotes = remoteActions.refreshGitRemotes;
  afterStatusRefresh.refreshGitStashes = remoteActions.refreshGitStashes;
  afterStatusRefresh.refreshGitLogIfOpen = statusRefresh.refreshGitLogIfOpen;

  const advancedActions = useGitAdvancedActions({
    projectPath,
    projectOpened,
    state,
    confirm,
    onRefreshTree,
    refreshGitStatus: statusRefresh.refreshGitStatus,
  });

  afterStatusRefresh.refreshGitBranches = advancedActions.refreshGitBranches;

  const stagingActions = useGitStagingActions({
    projectPath,
    projectOpened,
    state,
    confirm,
    onRefreshTree,
    refreshGitStatus: statusRefresh.refreshGitStatus,
  });

  hunkLoaderHolder.load = stagingActions.loadHunksForFile;

  const commitActions = useGitCommitActions({
    projectPath,
    projectOpened,
    aiConfig,
    configReady,
    state,
    onRefreshTree,
    onSuggestBatchCommit: () => suggestBatchCommit?.(),
    refreshGitStatus: statusRefresh.refreshGitStatus,
    refreshGitRemotes: remoteActions.refreshGitRemotes,
    refreshGitLogIfOpen: statusRefresh.refreshGitLogIfOpen,
    refreshGitAheadCommits: remoteActions.refreshGitAheadCommits,
  });

  const batch = useGitBatchCommit({
    projectPath,
    gitStatus: state.gitStatus,
    gitError: state.gitError,
    gitBranch: state.gitBranch,
    gitStatusKnown: state.gitStatusKnown,
    gitStagedFiles: state.gitStagedFiles,
    gitUnstagedFiles: state.gitUnstagedFiles,
    gitBatchSourceFiles: state.gitBatchSourceFiles,
    aiConfig,
    configReady,
    confirm,
    onRefreshTree,
    runStageGitFiles: stagingActions.runStageGitFiles,
    refreshGitStatus: statusRefresh.refreshGitStatus,
    refreshGitRemotes: remoteActions.refreshGitRemotes,
    clearGitDiffCache: state.clearGitDiffCache,
    gitStagingInProgress: state.gitStagingInProgress,
    gitLastStagingAt: state.gitLastStagingAt,
    gitStatusRefreshToken: state.gitStatusRefreshToken,
  });

  batchReset = batch.resetBatchDraftSessionState;
  batchSync = batch.syncBatchStateWithSourceFiles;
  suggestBatchCommit = () => {
    batch.batchSectionOpen.value = true;
  };

  return {
    gitBranches: state.gitBranches,
    refreshGitBranches: advancedActions.refreshGitBranches,
    checkoutBranch: advancedActions.checkoutBranch,
    createBranch: advancedActions.createBranch,
    deleteBranch: advancedActions.deleteBranch,
    resolveConflict: advancedActions.resolveConflict,
    doMerge: advancedActions.doMerge,
    doMergeAbort: advancedActions.doMergeAbort,
    doRebase: advancedActions.doRebase,
    doRebaseAbort: advancedActions.doRebaseAbort,
    doCherryPick: advancedActions.doCherryPick,
    doRevertCommit: advancedActions.doRevertCommit,
    doCreateTag: advancedActions.doCreateTag,
    doDeleteTag: advancedActions.doDeleteTag,
    doSubmoduleUpdate: advancedActions.doSubmoduleUpdate,
    doResetCommit: advancedActions.doResetCommit,
    doStashPop: remoteActions.doStashPop,
    gitSecondaryHint: state.gitSecondaryHint,
    gitSelectedRemote: state.gitSelectedRemote,
    gitMergeInProgress: state.gitMergeInProgress,
    gitRebaseInProgress: state.gitRebaseInProgress,
    gitAdvancedOpen: state.gitAdvancedOpen,
    gitAdvancedAction: state.gitAdvancedAction,
    gitTags: state.gitTags,
    gitSubmodules: state.gitSubmodules,
    gitTagNameInput: state.gitTagNameInput,
    gitMergeTarget: state.gitMergeTarget,
    gitRebaseOnto: state.gitRebaseOnto,
    gitConflictedFiles: state.gitConflictedFiles,
    gitPanelMode: state.gitPanelMode,
    projectPanelView: state.projectPanelView,
    gitStatus: state.gitStatus,
    gitBranch: state.gitBranch,
    gitHeadCommit: state.gitHeadCommit,
    gitIsRepo: state.gitIsRepo,
    gitStatusKnown: state.gitStatusKnown,
    gitLoading: state.gitLoading,
    gitError: state.gitError,
    gitCommitMessage: state.gitCommitMessage,
    gitCommitting: state.gitCommitting,
    gitGenStep: state.gitGenStep,
    gitLogEntries: state.gitLogEntries,
    gitLogOpen: state.gitLogOpen,
    gitLogCount: state.gitLogCount,
    gitLogSearchQuery: state.gitLogSearchQuery,
    gitLogAllBranches: state.gitLogAllBranches,
    gitLogBranchFilter: state.gitLogBranchFilter,
    gitLogAuthorFilter: state.gitLogAuthorFilter,
    gitLogPathFilter: state.gitLogPathFilter,
    gitLogSince: state.gitLogSince,
    gitLogUntil: state.gitLogUntil,
    hasMoreGitLog: state.hasMoreGitLog,
    gitLogLoadingMore: state.gitLogLoadingMore,
    gitLogSearchLoading: state.gitLogSearchLoading,
    loadMoreGitLog: statusRefresh.loadMoreGitLog,
    searchGitLog: statusRefresh.searchGitLog,
    setGitLogAllBranches: statusRefresh.setGitLogAllBranches,
    setGitLogBranchFilter: statusRefresh.setGitLogBranchFilter,
    setGitLogFilters: statusRefresh.setGitLogFilters,
    gitStagedOpen: state.gitStagedOpen,
    gitUnstagedOpen: state.gitUnstagedOpen,
    gitUntrackedOpen: state.gitUntrackedOpen,
    expandedGitLogEntries: state.expandedGitLogEntries,
    gitStashSectionOpen: state.gitStashSectionOpen,
    gitLocalChangesOpen: state.gitLocalChangesOpen,
    selectedGitFiles: state.selectedGitFiles,
    gitDiffLoadingKey: state.gitDiffLoadingKey,
    gitDiffContentCache: state.gitDiffContentCache,
    gitRemotes: state.gitRemotes,
    gitTrackingBranch: state.gitTrackingBranch,
    gitAhead: state.gitAhead,
    gitBehind: state.gitBehind,
    gitRemoteLoading: state.gitRemoteLoading,
    gitRemoteAction: state.gitRemoteAction,
    gitStashes: state.gitStashes,
    gitStashOpen: state.gitStashOpen,
    gitStashAction: state.gitStashAction,
    gitStashMessage: state.gitStashMessage,
    gitAiPushStep: state.gitAiPushStep,
    gitAheadCommits: state.gitAheadCommits,
    gitAheadCommitsOpen: state.gitAheadCommitsOpen,
    gitAheadCommitsLoading: state.gitAheadCommitsLoading,
    gitBehindCommits: state.gitBehindCommits,
    gitBehindCommitsOpen: state.gitBehindCommitsOpen,
    gitBehindCommitsLoading: state.gitBehindCommitsLoading,

    gitStagedFiles: state.gitStagedFiles,
    gitUnstagedFiles: state.gitUnstagedFiles,
    gitModifiedFiles: state.gitModifiedFiles,
    gitUntrackedFiles: state.gitUntrackedFiles,
    gitHunkTargetFile: state.gitHunkTargetFile,
    gitHunks: state.gitHunks,
    gitStagedHunks: state.gitStagedHunks,
    gitHunkStagingIndex: state.gitHunkStagingIndex,
    gitHunkUnstagingIndex: state.gitHunkUnstagingIndex,
    gitChangeCount: state.gitChangeCount,
    canGitCommit: state.canGitCommit,

    ...batch,

    clearGitDiffCache: state.clearGitDiffCache,
    evictOldestCacheEntry: state.evictOldestCacheEntry,
    gitStagingInProgress: state.gitStagingInProgress,
    gitLastStagingAt: state.gitLastStagingAt,
    gitStatusIcon,
    gitStatusColor,
    isGitLogEntryOpen: state.isGitLogEntryOpen,
    toggleGitLogEntry: state.toggleGitLogEntry,
    gitHistoryDiffKey: state.gitHistoryDiffKey,
    gitWorkingTreeDiffKey: state.gitWorkingTreeDiffKey,
    resetGitPanelState: statusRefresh.resetGitPanelState,
    refreshGitStatus: statusRefresh.refreshGitStatus,
    commitGit: commitActions.commitGit,
    stageFile: stagingActions.stageFile,
    unstageFile: stagingActions.unstageFile,
    stageAll: stagingActions.stageAll,
    stageUntracked: stagingActions.stageUntracked,
    unstageAll: stagingActions.unstageAll,
    discardFile: stagingActions.discardFile,
    discardAll: stagingActions.discardAll,
    stageDir: stagingActions.stageDir,
    unstageDir: stagingActions.unstageDir,
    discardDir: stagingActions.discardDir,
    stageHunk: stagingActions.stageHunk,
    unstageHunk: stagingActions.unstageHunk,
    loadHunksForFile: stagingActions.loadHunksForFile,
    stageSelectedFiles: stagingActions.stageSelectedFiles,
    unstageSelectedFiles: stagingActions.unstageSelectedFiles,
    discardSelectedFiles: stagingActions.discardSelectedFiles,
    toggleGitFileSelection: stagingActions.toggleGitFileSelection,
    clearGitSelection: stagingActions.clearGitSelection,
    generateCommitMessage: commitActions.generateCommitMessage,
    aiCommitAndPush: commitActions.aiCommitAndPush,
    refreshGitRemotes: remoteActions.refreshGitRemotes,
    refreshGitAheadCommits: remoteActions.refreshGitAheadCommits,
    refreshGitBehindCommits: remoteActions.refreshGitBehindCommits,
    doFetch: remoteActions.doFetch,
    doPull: remoteActions.doPull,
    doPush: remoteActions.doPush,
    refreshGitStashes: remoteActions.refreshGitStashes,
    doStashSave: remoteActions.doStashSave,
    doStashApply: remoteActions.doStashApply,
    doStashDrop: remoteActions.doStashDrop,
  };
}
