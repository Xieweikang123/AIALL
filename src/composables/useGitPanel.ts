import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { debugLog } from "../utils/debugLog";
import { lsGet, lsSet } from "../utils/localStorageSafe";
import {
  pathsEqual,
  readGitBatchDraft,
  removeGitBatchDraft,
  sortedUnstagedPaths,
  writeGitBatchDraft,
} from "../utils/gitBatchDraftStorage";
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
  aiBatchGroups as aiBatchGroupsApi,
  type AiBatchGroupItem,
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
} from "../services/vibeGitClient";

export type GitFileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
};

export type BatchGroup = {
  dir: string;
  files: { path: string; status: string }[];
  message?: string;
};

function getTopLevelDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIdx = normalized.indexOf("/");
  return slashIdx === -1 ? normalized : normalized.slice(0, slashIdx);
}

function defaultBatchMessage(g: BatchGroup): string {
  if (g.message) return g.message;
  let dir = g.dir;
  if (dir === "正在分析其余变更") {
    dir = "其他未分组变更";
  }
  if (g.files.length === 1) {
    const name = g.files[0].path.split("/").pop() || dir;
    return `${dir}: ${name}`;
  }
  return `${dir}: update ${g.files.length} files`;
}

function parsePartialGroups(jsonStr: string): AiBatchGroupItem[] {
  const groups: AiBatchGroupItem[] = [];
  const groupsMatch = jsonStr.match(/"groups"\s*:\s*\[([\s\S]*)/);
  if (!groupsMatch) return groups;

  const arrayContent = groupsMatch[1];
  let braceCount = 0;
  let inString = false;
  let escape = false;
  let startIdx = -1;

  for (let i = 0; i < arrayContent.length; i++) {
    const char = arrayContent[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") {
        if (braceCount === 0) {
          startIdx = i;
        }
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0 && startIdx !== -1) {
          const objStr = arrayContent.slice(startIdx, i + 1);
          try {
            const parsed = JSON.parse(objStr) as AiBatchGroupItem;
            if (parsed && typeof parsed.name === "string" && Array.isArray(parsed.files)) {
              groups.push(parsed);
            }
          } catch {
            // ignore incomplete
          }
        }
      } else if (char === "]") {
        if (braceCount === 0) break;
      }
    }
  }
  return groups;
}

export function useGitPanel(
  projectPath: () => string,
  projectOpened: () => boolean,
  aiConfig: () => { endpoint: string; apiKey: string; model: string },
  configReady: () => boolean,
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>,
  onRefreshTree?: () => void,
) {
  const GIT_PANEL_MODE_KEY = "vibe-coding-git-panel-mode";
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
  type ProjectPanelView = "knowledge" | "health";

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
    _storedProjectView === "health" || _storedProjectView === "knowledge"
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
  let gitStatusRefreshToken = 0;
  let gitLogSearchToken = 0;
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
  const gitStagedOpen = ref(localStorage.getItem("git-staged-open") !== "false");
  const gitUnstagedOpen = ref(localStorage.getItem("git-unstaged-open") !== "false");
  const expandedGitLogEntries = ref<Set<string>>(new Set());
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

  // 持久化折叠状态到 localStorage
  watch(gitUnstagedOpen, (v) => {
    localStorage.setItem("git-unstaged-open", String(v));
  });
  watch(gitStagedOpen, (v) => {
    localStorage.setItem("git-staged-open", String(v));
  });
  watch(gitStashOpen, (v) => {
    localStorage.setItem("git-stash-open", String(v));
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
  const gitUnstagedFiles = computed(() => gitStatus.value.filter((f) => !f.staged));
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

  function gitStatusIcon(status: string): string {
    switch (status) {
      case "M":
      case "modified":
        return "M";
      case "A":
      case "added":
        return "A";
      case "D":
      case "deleted":
        return "D";
      case "R":
      case "renamed":
        return "R";
      case "C":
        return "C";
      case "untracked":
        return "?";
      default:
        return "!";
    }
  }

  function gitStatusColor(status: string): string {
    switch (status) {
      case "M":
      case "modified":
        return "#e2c08c";
      case "A":
      case "added":
        return "#73daca";
      case "D":
      case "deleted":
        return "#f7768e";
      case "R":
      case "renamed":
        return "#bb9af7";
      case "C":
        return "#bb9af7";
      case "untracked":
        return "#7aa2f7";
      default:
        return "#9aa5ce";
    }
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
    return `${staged ? "staged" : "worktree"}:${filePath}`;
  }

  function resetGitPanelState() {
    gitStatusRefreshToken += 1;
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
    aiBatchGroupsResult.value = null;
    batchMessages.value = [];
    batchSectionOpen.value = false;
    batchUnstagedSnapshot.value = null;
    if (batchDraftPersistTimer) {
      clearTimeout(batchDraftPersistTimer);
      batchDraftPersistTimer = null;
    }
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
    const token = ++gitStatusRefreshToken;
    if (showLoading) gitLoading.value = true;
    if (showLoading) gitError.value = "";
    try {
      const result = await fetchGitStatus(pathAtStart);
      if (token !== gitStatusRefreshToken || projectPath() !== pathAtStart) return;
      gitStatusKnown.value = true;
      if (!result.ok) {
        gitError.value = result.error || "获取 Git 状态失败";
        return;
      }
      gitIsRepo.value = result.isRepo;
      gitBranch.value = result.branch;
      gitHeadCommit.value = result.headCommit?.trim() || "";
      gitStatus.value = result.files;
      gitError.value = "";
      clearGitDiffCache();

      if (result.isRepo) {
        void refreshGitRemotes();
        void refreshGitStashes();
        void refreshGitBranches();
        if (gitLogOpen.value) {
          await refreshGitLogIfOpen(pathAtStart);
          if (token !== gitStatusRefreshToken || projectPath() !== pathAtStart) return;
        }
      }
    } catch (e) {
      if (token !== gitStatusRefreshToken || projectPath() !== pathAtStart) return;
      gitStatusKnown.value = true;
      gitError.value = e instanceof Error ? e.message : "获取 Git 状态失败";
    } finally {
      if (token === gitStatusRefreshToken && projectPath() === pathAtStart) {
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

    const token = ++gitLogSearchToken;
    gitLogSearchLoading.value = true;
    try {
      const logResult = await fetchGitLog(projectPath(), gitLogCount.value, trimmed || undefined);
      if (token !== gitLogSearchToken) return;
      if (logResult.ok) {
        gitLogEntries.value = logResult.entries;
      }
    } catch (e) {
      debugLog("searchGitLog exception:", e);
    } finally {
      if (token === gitLogSearchToken) {
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
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "提交失败";
      await refreshGitStatus({ force: true });
      onRefreshTree?.();
    } finally {
      gitCommitting.value = false;
    }
  }

  const aiBatchGroupsResult = ref<AiBatchGroupItem[] | null>(null);
  const aiBatchGrouping = ref(false);
  const aiBatchGroupingStep = ref("");
  const batchCommittingAll = ref(false);
  const batchMessages = ref<string[]>([]);
  const batchSectionOpen = ref(false);
  const batchUnstagedSnapshot = ref<string[] | null>(null);
  let batchDraftPersistTimer: ReturnType<typeof setTimeout> | null = null;

  function currentUnstagedPaths(): string[] {
    return sortedUnstagedPaths(gitUnstagedFiles.value.map((f) => f.path));
  }

  function syncBatchMessagesFromGroups() {
    batchMessages.value = batchGroups.value.map((g) => defaultBatchMessage(g));
  }

  function schedulePersistBatchDraft() {
    if (batchDraftPersistTimer) clearTimeout(batchDraftPersistTimer);
    batchDraftPersistTimer = setTimeout(() => {
      batchDraftPersistTimer = null;
      persistBatchDraft();
    }, 300);
  }

  function persistBatchDraft() {
    if (!projectOpened()) return;
    const paths = currentUnstagedPaths();
    if (!paths.length || !batchUnstagedSnapshot.value) {
      removeGitBatchDraft(projectPath());
      return;
    }
    writeGitBatchDraft(projectPath(), {
      unstagedPaths: paths,
      groups: aiBatchGroupsResult.value,
      messages: [...batchMessages.value],
      sectionOpen: batchSectionOpen.value,
    });
  }

  function clearBatchDraftPersist() {
    if (batchDraftPersistTimer) {
      clearTimeout(batchDraftPersistTimer);
      batchDraftPersistTimer = null;
    }
    removeGitBatchDraft(projectPath());
    batchUnstagedSnapshot.value = null;
  }

  function tryRestoreBatchDraft() {
    const paths = currentUnstagedPaths();
    if (!paths.length) return;

    const draft = readGitBatchDraft(projectPath());
    if (draft && pathsEqual(draft.unstagedPaths, paths)) {
      batchUnstagedSnapshot.value = paths;
      aiBatchGroupsResult.value = draft.groups?.length ? draft.groups : null;
      batchSectionOpen.value = draft.sectionOpen;
      const groups = batchGroups.value;
      batchMessages.value = draft.messages.length === groups.length
        ? [...draft.messages]
        : groups.map((g, i) => draft.messages[i] ?? defaultBatchMessage(g));
      return;
    }

    batchUnstagedSnapshot.value = paths;
    syncBatchMessagesFromGroups();
    if (draft && !pathsEqual(draft.unstagedPaths, paths)) {
      removeGitBatchDraft(projectPath());
    }
  }

  function invalidateBatchDraft() {
    aiBatchGroupsResult.value = null;
    if (batchDraftPersistTimer) {
      clearTimeout(batchDraftPersistTimer);
      batchDraftPersistTimer = null;
    }
    removeGitBatchDraft(projectPath());
    batchUnstagedSnapshot.value = null;
    syncBatchMessagesFromGroups();
    const paths = currentUnstagedPaths();
    if (paths.length) {
      batchUnstagedSnapshot.value = paths;
    }
  }

  const batchGroups = computed<BatchGroup[]>(() => {
    if (aiBatchGroupsResult.value) {
      const groups = aiBatchGroupsResult.value.map((g) => ({
        dir: g.name,
        files: g.files.map((p) => {
          const orig = gitUnstagedFiles.value.find((uf) => uf.path === p);
          return { path: p, status: orig?.status || "modified" };
        }),
        message: g.message,
      }));

      // Find any unstaged files that haven't been grouped yet
      const groupedPaths = new Set(aiBatchGroupsResult.value.flatMap((g) => g.files));
      const remaining = gitUnstagedFiles.value.filter((f) => !groupedPaths.has(f.path));
      if (remaining.length > 0) {
        groups.push({
          dir: aiBatchGrouping.value ? "正在分析其余变更" : "其他未分组变更",
          files: remaining.map((f) => ({ path: f.path, status: f.status })),
          message: "",
        });
      }
      return groups;
    }
    const dirMap = new Map<string, { path: string; status: string }[]>();
    for (const f of gitUnstagedFiles.value) {
      const dir = getTopLevelDir(f.path);
      if (!dirMap.has(dir)) dirMap.set(dir, []);
      dirMap.get(dir)!.push({ path: f.path, status: f.status });
    }
    return Array.from(dirMap.entries())
      .map(([dir, files]) => ({ dir, files }))
      .sort((a, b) => a.dir.localeCompare(b.dir));
  });

  const batchGroupsFromAi = computed(() => Boolean(aiBatchGroupsResult.value?.length));

  const batchCommittingIndex = ref<number | null>(null);

  watch(
    () => gitUnstagedFiles.value.map((f) => f.path).join("\n"),
    () => {
      if (!gitStatusKnown.value) return;
      if (batchCommittingAll.value) return;
      const current = currentUnstagedPaths();
      if (!current.length) {
        aiBatchGroupsResult.value = null;
        batchMessages.value = [];
        batchSectionOpen.value = false;
        clearBatchDraftPersist();
        return;
      }
      if (!batchUnstagedSnapshot.value) {
        tryRestoreBatchDraft();
        return;
      }
      if (pathsEqual(current, batchUnstagedSnapshot.value)) return;
      invalidateBatchDraft();
    },
  );

  watch(
    aiBatchGroupsResult,
    (result) => {
      if (!aiBatchGrouping.value || !result?.length) return;
      batchMessages.value = batchGroups.value.map((g) => defaultBatchMessage(g));
    },
    { deep: true },
  );

  watch(batchMessages, () => {
    if (!batchUnstagedSnapshot.value || aiBatchGrouping.value) return;
    schedulePersistBatchDraft();
  }, { deep: true });

  watch(batchSectionOpen, () => {
    if (!batchUnstagedSnapshot.value || aiBatchGrouping.value) return;
    schedulePersistBatchDraft();
  });

  watch(aiBatchGrouping, (grouping) => {
    if (grouping) batchSectionOpen.value = true;
  });

  async function commitBatchGroup(index: number, message: string) {
    if (!projectOpened() || !message.trim()) return;
    const group = batchGroups.value[index];
    if (!group) return;
    batchCommittingIndex.value = index;
    gitError.value = "";
    clearGitDiffCache();
    const filePaths = group.files.map((f) => f.path);
    try {
      const stageResult = await stageGitFiles(projectPath(), filePaths);
      if (!stageResult.ok) {
        gitError.value = stageResult.error || "暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
        return;
      }
      const commitResult = await commitGitChanges(projectPath(), message.trim());
      if (!commitResult.ok) {
        gitError.value = commitResult.error || "提交失败";
        await refreshGitStatus({ showLoading: false, force: true });
        return;
      }
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "批量提交失败";
      await refreshGitStatus({ showLoading: false, force: true });
      onRefreshTree?.();
    } finally {
      batchCommittingIndex.value = null;
      aiBatchGroupsResult.value = null;
      batchUnstagedSnapshot.value = null;
      removeGitBatchDraft(projectPath());
    }
  }

  async function commitAllBatches(messages: string[]) {
    if (!batchGroupsFromAi.value) {
      gitError.value = "请先通过 AI 划分后再进行全部提交";
      return;
    }
    const snapshot = batchGroups.value.map((g, i) => ({
      filePaths: g.files.map((f) => f.path),
      message: messages[i] || "",
    }));
    batchCommittingAll.value = true;
    try {
      for (let i = 0; i < snapshot.length; i++) {
        await commitBatchGroupByPaths(snapshot[i].filePaths, snapshot[i].message, i, snapshot.length);
        if (gitError.value) break;
      }
    } finally {
      batchCommittingAll.value = false;
      aiBatchGroupsResult.value = null;
      batchUnstagedSnapshot.value = null;
      removeGitBatchDraft(projectPath());
    }
  }

  async function commitBatchGroupByPaths(filePaths: string[], message: string, index = 0, _total?: number) {
    if (!projectOpened() || !message.trim() || !filePaths.length) return;
    batchCommittingIndex.value = index;
    gitError.value = "";
    clearGitDiffCache();
    try {
      const stageResult = await stageGitFiles(projectPath(), filePaths);
      if (!stageResult.ok) {
        gitError.value = stageResult.error || "暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
        return;
      }
      const commitResult = await commitGitChanges(projectPath(), message.trim());
      if (!commitResult.ok) {
        gitError.value = commitResult.error || "提交失败";
        await refreshGitStatus({ showLoading: false, force: true });
        return;
      }
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "批量提交失败";
      await refreshGitStatus({ showLoading: false, force: true });
      onRefreshTree?.();
    } finally {
      batchCommittingIndex.value = null;
    }
  }

  async function generateAiBatchGroups() {
    if (!projectOpened() || aiBatchGrouping.value) return;
    const cfg = aiConfig();
    if (!cfg.endpoint.trim() || !cfg.model.trim()) return;
    aiBatchGrouping.value = true;
    aiBatchGroupingStep.value = "连接服务…";
    gitError.value = "";
    let accumulatedJson = "";
    try {
      const result = await aiBatchGroupsApi(
        projectPath(),
        cfg.endpoint.trim(),
        cfg.apiKey.trim(),
        cfg.model.trim(),
        (delta) => {
          if (!aiBatchGroupingStep.value.startsWith("AI")) {
            aiBatchGroupingStep.value = "AI 分析中…";
          }
          accumulatedJson += delta;
          const partial = parsePartialGroups(accumulatedJson);
          if (partial.length > 0) {
            aiBatchGroupsResult.value = partial;
          }
        },
        (step) => {
          aiBatchGroupingStep.value = step;
        },
      );
      if (!result.ok) {
        gitError.value = result.error || "AI 分组失败";
        aiBatchGroupsResult.value = null;
      } else {
        aiBatchGroupsResult.value = result.groups.length > 0 ? result.groups : null;
        if (result.groups.length > 0) {
          batchUnstagedSnapshot.value = currentUnstagedPaths();
          batchSectionOpen.value = true;
          batchMessages.value = batchGroups.value.map((g) => defaultBatchMessage(g));
          persistBatchDraft();
          aiBatchGroupingStep.value = "完成 ✓";
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "AI 分组失败";
      aiBatchGroupsResult.value = null;
    } finally {
      aiBatchGrouping.value = false;
      aiBatchGroupingStep.value = "";
    }
  }

  async function stageFile(filePath: string) {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    const t = Date.now();
    gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: true } : f));
    gitStagingInProgress.value = true;
    gitStatusRefreshToken += 1;
    gitLastStagingAt.value = t;
    debugLog("stageFile start", filePath, "ts", t);
    try {
      const result = await stageGitFiles(projectPath(), [filePath]);
      debugLog("stageFile API done", "ok:", result.ok, "elapsed:", Date.now() - t);
      if (!result.ok) {
        gitError.value = result.error || "暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "暂存失败";
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
    gitStatusRefreshToken += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "取消暂存失败";
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
    gitStatus.value = gitStatus.value.map((f) => ({ ...f, staged: true }));
    gitStagingInProgress.value = true;
    gitStatusRefreshToken += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await stageGitFiles(projectPath(), filesToStage);
      if (!result.ok) {
        gitError.value = result.error || "暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "暂存失败";
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
    gitStatusRefreshToken += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), pathsToUnstage);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "取消暂存失败";
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
    gitStatusRefreshToken += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await discardGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
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
    gitStatusRefreshToken += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await discardGitFiles(projectPath(), unstagedPaths);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
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
    gitStatus.value = gitStatus.value.map((f) =>
      filesToStage.includes(f.path) ? { ...f, staged: true } : f,
    );
    selectedGitFiles.value = [];
    gitStagingInProgress.value = true;
    gitStatusRefreshToken += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await stageGitFiles(projectPath(), filesToStage);
      if (!result.ok) {
        gitError.value = result.error || "暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "暂存失败";
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
    gitStatusRefreshToken += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), filesToUnstage);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "取消暂存失败";
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
      gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
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
      gitError.value = e instanceof Error ? e.message : "AI 生成提交信息失败";
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
      gitError.value = e instanceof Error ? e.message : "AI 一键推送失败";
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
      gitError.value = e instanceof Error ? e.message : "Fetch 失败";
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
      gitError.value = e instanceof Error ? e.message : "Pull 失败";
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
      gitError.value = e instanceof Error ? e.message : "Push 失败";
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
      gitError.value = e instanceof Error ? e.message : "贮藏失败";
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
      gitError.value = e instanceof Error ? e.message : "应用贮藏失败";
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
      gitError.value = e instanceof Error ? e.message : "删除贮藏失败";
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
      gitError.value = e instanceof Error ? e.message : "切换分支失败";
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
      gitError.value = e instanceof Error ? e.message : "删除分支失败";
    } finally {
      gitLoading.value = false;
    }
  }

  return {
    gitBranches,
    refreshGitBranches,
    checkoutBranch,
    createBranch,
    deleteBranch,
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

    batchGroups,
    batchGroupsFromAi,
    batchMessages,
    batchSectionOpen,
    batchCommittingIndex,
    commitBatchGroup,
    commitAllBatches,
    aiBatchGrouping,
    aiBatchGroupingStep,
    generateAiBatchGroups,

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
