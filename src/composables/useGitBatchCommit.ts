import { ref, computed, watch, type Ref, type ComputedRef } from "vue";
import { debugLog } from "../utils/debugLog";
import { toErrorMessage } from "../utils/vibeHelpers";
import {
  pathsEqual,
  readGitBatchDraft,
  removeGitBatchDraft,
  sortedUnstagedPaths,
  writeGitBatchDraft,
} from "../utils/gitBatchDraftStorage";
import {
  commitGitChanges,
  unstageGitFiles,
  aiBatchGroups as aiBatchGroupsApi,
  type AiBatchGroupItem,
  type GitStatusFile,
} from "../services/vibeGitClient";

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

export interface UseGitBatchCommitOptions {
  projectPath: () => string;
  gitStatus: Ref<GitStatusFile[]>;
  gitError: Ref<string>;
  gitBranch: Ref<string>;
  gitStatusKnown: Ref<boolean>;
  gitStagedFiles: ComputedRef<GitStatusFile[]>;
  gitUnstagedFiles: ComputedRef<GitStatusFile[]>;
  gitBatchSourceFiles: ComputedRef<GitStatusFile[]>;
  aiConfig: () => { endpoint: string; apiKey: string; model: string };
  configReady: () => boolean;
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>;
  onRefreshTree?: () => void;
  runStageGitFiles: (paths: string[]) => Promise<{ ok: boolean; stageable: string[] }>;
  refreshGitStatus: (options?: { showLoading?: boolean; force?: boolean }) => Promise<void>;
  refreshGitRemotes: () => Promise<void>;
  clearGitDiffCache: () => void;
  gitStagingInProgress: Ref<boolean>;
  gitLastStagingAt: Ref<number>;
  gitStatusRefreshToken: Ref<number>;
}

export function useGitBatchCommit(options: UseGitBatchCommitOptions) {
  const {
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
  } = options;

  const aiBatchGroupsResult = ref<AiBatchGroupItem[] | null>(null);
  const aiBatchGrouping = ref(false);
  const aiBatchGroupingStep = ref("");
  const batchCommittingAll = ref(false);
  const batchMessages = ref<string[]>([]);
  const batchSectionOpen = ref(false);
  const batchUnstagedSnapshot = ref<string[] | null>(null);
  const batchDraftBranch = ref<string | null>(null);
  const batchCommittingIndex = ref<number | null>(null);
  const expandedBatchGroups = ref<Set<number>>(new Set());

  let batchDraftPersistTimer: ReturnType<typeof setTimeout> | null = null;

  const BATCH_FILES_PREVIEW = 4;
  const BATCH_GROUP_ACCENTS = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f778ba", "#79c0ff"];

  function currentBatchPaths(): string[] {
    return sortedUnstagedPaths(gitBatchSourceFiles.value.map((f) => f.path));
  }

  function batchDraftScope() {
    return {
      project: projectPath(),
      branch: gitBranch.value.trim() || "__detached__",
    };
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

  function flushBatchDraftPersist() {
    if (batchDraftPersistTimer) {
      clearTimeout(batchDraftPersistTimer);
      batchDraftPersistTimer = null;
    }
    persistBatchDraft();
  }

  function persistBatchDraft() {
    if (!projectPath().trim()) return;
    const { project, branch } = batchDraftScope();
    const paths = currentBatchPaths();
    if (!paths.length || !batchUnstagedSnapshot.value) {
      removeGitBatchDraft(project, branch);
      return;
    }
    writeGitBatchDraft(project, branch, {
      unstagedPaths: paths,
      groups: aiBatchGroupsResult.value,
      messages: [...batchMessages.value],
      sectionOpen: batchSectionOpen.value,
    });
    batchDraftBranch.value = branch;
  }

  function clearBatchDraftPersist() {
    if (batchDraftPersistTimer) {
      clearTimeout(batchDraftPersistTimer);
      batchDraftPersistTimer = null;
    }
    const { project, branch } = batchDraftScope();
    removeGitBatchDraft(project, branch);
    batchUnstagedSnapshot.value = null;
    batchDraftBranch.value = null;
  }

  function resetBatchDraftSessionState() {
    batchUnstagedSnapshot.value = null;
    batchDraftBranch.value = null;
    aiBatchGroupsResult.value = null;
    batchMessages.value = [];
    batchSectionOpen.value = false;
  }

  function tryRestoreBatchDraft() {
    const paths = currentBatchPaths();
    if (!paths.length) return;

    const { project, branch } = batchDraftScope();
    const draft = readGitBatchDraft(project, branch);
    if (draft && pathsEqual(draft.unstagedPaths, paths)) {
      batchUnstagedSnapshot.value = paths;
      batchDraftBranch.value = branch;
      aiBatchGroupsResult.value = draft.groups?.length ? draft.groups : null;
      batchSectionOpen.value = draft.sectionOpen;
      const groups = batchGroups.value;
      batchMessages.value = draft.messages.length === groups.length
        ? [...draft.messages]
        : groups.map((g, i) => draft.messages[i] ?? defaultBatchMessage(g));
      return;
    }

    batchUnstagedSnapshot.value = paths;
    batchDraftBranch.value = branch;
    syncBatchMessagesFromGroups();
    if (draft && !pathsEqual(draft.unstagedPaths, paths)) {
      removeGitBatchDraft(project, branch);
    }
  }

  function invalidateBatchDraft() {
    aiBatchGroupsResult.value = null;
    if (batchDraftPersistTimer) {
      clearTimeout(batchDraftPersistTimer);
      batchDraftPersistTimer = null;
    }
    const { project, branch } = batchDraftScope();
    removeGitBatchDraft(project, branch);
    batchUnstagedSnapshot.value = null;
    batchDraftBranch.value = null;
    syncBatchMessagesFromGroups();
    const paths = currentBatchPaths();
    if (paths.length) {
      batchUnstagedSnapshot.value = paths;
      batchDraftBranch.value = branch;
    }
  }

  const batchGroups = computed<BatchGroup[]>(() => {
    const sourceFiles = gitBatchSourceFiles.value;
    if (aiBatchGroupsResult.value) {
      const groups = aiBatchGroupsResult.value.map((g) => ({
        dir: g.name,
        files: g.files.map((p) => {
          const orig = sourceFiles.find((uf) => uf.path === p);
          return { path: p, status: orig?.status || "modified" };
        }),
        message: g.message,
      }));

      // Find any batch source files that haven't been grouped yet
      const groupedPaths = new Set(aiBatchGroupsResult.value.flatMap((g) => g.files));
      const remaining = sourceFiles.filter((f) => !groupedPaths.has(f.path));
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
    for (const f of sourceFiles) {
      const dir = getTopLevelDir(f.path);
      if (!dirMap.has(dir)) dirMap.set(dir, []);
      dirMap.get(dir)!.push({ path: f.path, status: f.status });
    }
    return Array.from(dirMap.entries())
      .map(([dir, files]) => ({ dir, files }))
      .sort((a, b) => a.dir.localeCompare(b.dir));
  });

  const batchGroupsFromAi = computed(() => Boolean(aiBatchGroupsResult.value?.length));
  const batchTotalFiles = computed(() =>
    (batchGroups.value ?? []).reduce((sum, g) => sum + g.files.length, 0),
  );
  const batchReadyCount = computed(() =>
    batchMessages.value.filter((m) => m?.trim()).length,
  );

  const canCommitAllBatches = computed(() => {
    const n = batchGroups.value?.length ?? 0;
    if (!n || batchCommittingIndex.value !== null) return false;
    if (!batchGroupsFromAi.value) return false;
    return batchMessages.value.length === n && batchMessages.value.every((m) => m?.trim());
  });

  function syncBatchStateWithSourceFiles() {
    if (!gitStatusKnown.value) return;
    if (batchCommittingAll.value) return;

    const branch = batchDraftScope().branch;
    if (batchDraftBranch.value !== null && batchDraftBranch.value !== branch) {
      resetBatchDraftSessionState();
    }

    const current = currentBatchPaths();
    if (!current.length) {
      resetBatchDraftSessionState();
      clearBatchDraftPersist();
      return;
    }
    if (!batchUnstagedSnapshot.value) {
      tryRestoreBatchDraft();
      return;
    }
    if (pathsEqual(current, batchUnstagedSnapshot.value)) return;
    // 文件列表变了但保留已有 AI 分组，batchGroups computed 会自动把新文件追加到"其他未分组变更"组
    batchUnstagedSnapshot.value = current;
    schedulePersistBatchDraft();
  }

  async function clearStagedIndexForBatchCommit(): Promise<boolean> {
    const stagedPaths = gitStagedFiles.value.map((f) => f.path);
    if (!stagedPaths.length) return true;
    gitError.value = "";
    gitStatus.value = gitStatus.value.map((f) => ({ ...f, staged: false }));
    gitStagingInProgress.value = true;
    gitStatusRefreshToken.value += 1;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), stagedPaths);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false, force: true });
        return false;
      }
      return true;
    } catch (e) {
      gitError.value = toErrorMessage(e, "取消暂存失败");
      await refreshGitStatus({ showLoading: false, force: true });
      return false;
    } finally {
      gitLastStagingAt.value = Date.now();
      gitStagingInProgress.value = false;
    }
  }

  async function commitBatchGroup(index: number, message: string) {
    if (!projectPath().trim() || !message.trim()) return;
    const group = batchGroups.value[index];
    if (!group) return;
    batchCommittingIndex.value = index;
    gitError.value = "";
    clearGitDiffCache();
    const filePaths = group.files.map((f) => f.path);
    try {
      if (!(await clearStagedIndexForBatchCommit())) return;
      const stageResult = await runStageGitFiles(filePaths);
      if (!stageResult.ok) {
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
      await refreshGitRemotes();
    } catch (e) {
      gitError.value = toErrorMessage(e, "批量提交失败");
      await refreshGitStatus({ showLoading: false, force: true });
      onRefreshTree?.();
    } finally {
      batchCommittingIndex.value = null;
      aiBatchGroupsResult.value = null;
      batchUnstagedSnapshot.value = null;
      batchDraftBranch.value = null;
      const { project, branch } = batchDraftScope();
      removeGitBatchDraft(project, branch);
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
        await commitBatchGroupByPaths(snapshot[i].filePaths, snapshot[i].message, i, snapshot.length, false);
        if (gitError.value) break;
      }
    } finally {
      batchCommittingIndex.value = null;
      batchCommittingAll.value = false;
      aiBatchGroupsResult.value = null;
      batchUnstagedSnapshot.value = null;
      batchDraftBranch.value = null;
      const { project, branch } = batchDraftScope();
      removeGitBatchDraft(project, branch);
    }
  }

  async function commitBatchGroupByPaths(filePaths: string[], message: string, index = 0, _total?: number, resetIndex = true) {
    if (!projectPath().trim() || !message.trim() || !filePaths.length) return;

    const batchPathSet = new Set(gitBatchSourceFiles.value.map((f) => f.path));
    const filesToCommit = filePaths.filter((p) => batchPathSet.has(p));
    if (filesToCommit.length === 0) {
      return;
    }

    batchCommittingIndex.value = index;
    gitError.value = "";
    clearGitDiffCache();
    try {
      if (!(await clearStagedIndexForBatchCommit())) return;
      const stageResult = await runStageGitFiles(filesToCommit);
      if (!stageResult.ok) {
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
      await refreshGitRemotes();
    } catch (e) {
      gitError.value = toErrorMessage(e, "批量提交失败");
      await refreshGitStatus({ showLoading: false, force: true });
      onRefreshTree?.();
    } finally {
      if (resetIndex) {
        batchCommittingIndex.value = null;
      }
    }
  }

  async function generateAiBatchGroups() {
    if (!projectPath().trim() || aiBatchGrouping.value) return;
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
          batchUnstagedSnapshot.value = currentBatchPaths();
          batchSectionOpen.value = true;
          batchMessages.value = batchGroups.value.map((g) => defaultBatchMessage(g));
          persistBatchDraft();
          aiBatchGroupingStep.value = "完成 ✓";
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } catch (e) {
      gitError.value = toErrorMessage(e, "AI 分组失败");
      aiBatchGroupsResult.value = null;
    } finally {
      aiBatchGrouping.value = false;
      aiBatchGroupingStep.value = "";
    }
  }

  function batchGroupTitle(group: BatchGroup): string {
    return batchGroupsFromAi.value ? group.dir : `${group.dir}/`;
  }

  function batchGroupAccent(index: number): string {
    return BATCH_GROUP_ACCENTS[index % BATCH_GROUP_ACCENTS.length];
  }

  function isBatchGroupExpanded(index: number): boolean {
    return expandedBatchGroups.value.has(index);
  }

  function toggleBatchGroupFiles(index: number) {
    const next = new Set(expandedBatchGroups.value);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    expandedBatchGroups.value = next;
  }

  function visibleBatchFiles(group: BatchGroup, index: number) {
    if (isBatchGroupExpanded(index) || group.files.length <= BATCH_FILES_PREVIEW) {
      return group.files;
    }
    return group.files.slice(0, BATCH_FILES_PREVIEW);
  }

  function onBatchMessageInput(index: number, value: string) {
    const next = [...batchMessages.value];
    next[index] = value;
    batchMessages.value = next;
  }

  watch(
    () => gitBatchSourceFiles.value.map((f) => f.path).join("\n"),
    () => {
      syncBatchStateWithSourceFiles();
    },
  );

  watch(
    aiBatchGroupsResult,
    (result) => {
      if (aiBatchGrouping.value && result?.length) {
        batchMessages.value = batchGroups.value.map((g) => defaultBatchMessage(g));
      } else if (!result?.length) {
        syncBatchMessagesFromGroups();
      }
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

  watch(
    () => batchGroups.value?.map((g) => `${g.dir}:${g.files.length}`).join("|"),
    () => {
      expandedBatchGroups.value = new Set();
    },
  );

  function invalidateBatchOnStatusChange() {
    if (batchCommittingAll.value) return;
    invalidateBatchDraft();
  }

  return {
    aiBatchGrouping,
    aiBatchGroupingStep,
    batchMessages,
    batchSectionOpen,
    batchCommittingIndex,
    batchGroups,
    batchGroupsFromAi,
    commitBatchGroup,
    commitAllBatches,
    generateAiBatchGroups,
    flushBatchDraftPersist,
    syncBatchStateWithSourceFiles,
    resetBatchDraftSessionState,
    clearBatchDraftPersist,
  };
}
