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
  const aiBatchAnalysisComplete = ref(false);
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
  let aiBatchRunId = 0;

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
    // Snapshot/path empty means "nothing to write", not "delete draft".
    // Deletion must go through clearBatchDraftPersist / invalidate / commit finish.
    // Otherwise beforeunload flush after reset (or a transient empty status) wipes AI 分析.
    if (!paths.length || !batchUnstagedSnapshot.value) {
      return;
    }
    writeGitBatchDraft(project, branch, {
      unstagedPaths: paths,
      groups: aiBatchGroupsResult.value,
      analysisComplete: aiBatchAnalysisComplete.value,
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
    aiBatchRunId += 1;
    debugLog("[git-ai] reset analysis state", { runId: aiBatchRunId });
    batchUnstagedSnapshot.value = null;
    batchDraftBranch.value = null;
    aiBatchGroupsResult.value = null;
    aiBatchAnalysisComplete.value = false;
    batchMessages.value = [];
    batchSectionOpen.value = false;
  }

  function tryRestoreBatchDraft() {
    const paths = currentBatchPaths();
    if (!paths.length) return;

    const { project, branch } = batchDraftScope();
    const draft = readGitBatchDraft(project, branch);
    batchUnstagedSnapshot.value = paths;
    batchDraftBranch.value = branch;

    if (!draft) {
      syncBatchMessagesFromGroups();
      return;
    }

    const pathSet = new Set(paths);
    const restoredGroups = (draft.groups ?? [])
      .map((g) => ({
        ...g,
        files: g.files.map((p) => p.replace(/\\/g, "/")).filter((p) => pathSet.has(p)),
      }))
      .filter((g) => g.files.length > 0);

    const exactPaths = pathsEqual(draft.unstagedPaths, paths);

    // Exact match, or overlapping AI groups after path drift (same policy as in-memory sync).
    if (draft.groups?.length && (exactPaths || restoredGroups.length > 0)) {
      aiBatchGroupsResult.value = exactPaths ? draft.groups : restoredGroups;
      aiBatchAnalysisComplete.value = draft.analysisComplete !== false;
      batchSectionOpen.value = draft.sectionOpen;
      const groups = batchGroups.value;
      batchMessages.value = groups.map((g, i) => draft.messages[i] ?? defaultBatchMessage(g));
      if (!exactPaths) schedulePersistBatchDraft();
      return;
    }

    if (!draft.groups?.length && exactPaths) {
      aiBatchGroupsResult.value = null;
      aiBatchAnalysisComplete.value = false;
      batchSectionOpen.value = draft.sectionOpen;
      const groups = batchGroups.value;
      batchMessages.value = draft.messages.length === groups.length
        ? [...draft.messages]
        : groups.map((g, i) => draft.messages[i] ?? defaultBatchMessage(g));
      return;
    }

    syncBatchMessagesFromGroups();
    removeGitBatchDraft(project, branch);
  }

  function invalidateBatchDraft() {
    aiBatchRunId += 1;
    debugLog("[git-ai] invalidate analysis state", { runId: aiBatchRunId });
    aiBatchGroupsResult.value = null;
    aiBatchAnalysisComplete.value = false;
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

  const batchGroupsFromAi = computed(() => aiBatchAnalysisComplete.value && Boolean(aiBatchGroupsResult.value?.length));
  const batchTotalFiles = computed(() =>
    (batchGroups.value ?? []).reduce((sum, g) => sum + g.files.length, 0),
  );
  const batchReadyCount = computed(() =>
    batchMessages.value.filter((m) => m?.trim()).length,
  );

  const canCommitAllBatches = computed(() => {
    const n = batchGroups.value?.length ?? 0;
    if (!batchGroupsFromAi.value || !n || batchCommittingIndex.value !== null) return false;
    return batchMessages.value.length === n && batchMessages.value.every((m) => m?.trim());
  });

  function requireAiBatchGroups(): boolean {
    if (batchGroupsFromAi.value) return true;
    gitError.value = "请先完成 AI 分析变更，再进行分组提交";
    batchSectionOpen.value = true;
    return false;
  }

  function syncBatchStateWithSourceFiles() {
    if (!gitStatusKnown.value) return;
    if (batchCommittingAll.value) return;
    // A status refresh can briefly report no files while the analysis request is
    // still running. Keep the in-flight result until the request settles.
    if (aiBatchGrouping.value) return;

    const branch = batchDraftScope().branch;
    if (batchDraftBranch.value !== null && batchDraftBranch.value !== branch) {
      resetBatchDraftSessionState();
    }

    const current = currentBatchPaths();
    if (!current.length) {
      // Status can briefly report zero files (watcher/refresh races). Clear the
      // in-memory panel only; keep localStorage draft so AI 分析 can restore
      // when the file list comes back. Explicit clear happens on commit finish.
      resetBatchDraftSessionState();
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
    if (!requireAiBatchGroups()) return;
    if (!projectPath().trim() || !message.trim()) return;
    const group = batchGroups.value[index];
    if (!group) return;
    batchCommittingIndex.value = index;
    gitError.value = "";
    clearGitDiffCache();
    const filePaths = group.files.map((f) => f.path);
    let committed = false;
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
      committed = true;
      await refreshGitStatus({ showLoading: false });
      await refreshGitRemotes();
    } catch (e) {
      gitError.value = toErrorMessage(e, "批量提交失败");
      await refreshGitStatus({ showLoading: false, force: true });
      onRefreshTree?.();
    } finally {
      batchCommittingIndex.value = null;
      if (committed) {
        pruneAiBatchGroupsAfterCommit(filePaths);
      }
    }
  }

  function pruneAiBatchGroupsAfterCommit(committedPaths: string[]) {
    const committed = new Set(committedPaths);
    if (aiBatchGroupsResult.value) {
      const next = aiBatchGroupsResult.value
        .map((g) => ({
          ...g,
          files: g.files.filter((p) => !committed.has(p)),
        }))
        .filter((g) => g.files.length > 0);
      aiBatchGroupsResult.value = next.length > 0 ? next : null;
    }

    if (aiBatchGroupsResult.value) {
      batchUnstagedSnapshot.value = currentBatchPaths();
      batchDraftBranch.value = batchDraftScope().branch;
      batchMessages.value = batchGroups.value.map((g) => defaultBatchMessage(g));
      persistBatchDraft();
    } else {
      batchUnstagedSnapshot.value = null;
      batchDraftBranch.value = null;
      const { project, branch } = batchDraftScope();
      removeGitBatchDraft(project, branch);
      syncBatchMessagesFromGroups();
    }
  }

  async function commitAllBatches(messages: string[]) {
    if (!requireAiBatchGroups()) return;
    const n = batchGroups.value?.length ?? 0;
    if (!n) return;
    if (messages.length !== n || messages.some((m) => !m?.trim())) {
      gitError.value = "请先为每组填写提交说明";
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
    if (!cfg.endpoint.trim() || !cfg.model.trim()) {
      gitError.value = "请先配置 AI 模型";
      return;
    }
    const runId = ++aiBatchRunId;
    const runProject = projectPath().trim();
    const runBranch = batchDraftScope().branch;
    const runPaths = currentBatchPaths();
    debugLog("[git-ai] analysis start", {
      runId,
      project: runProject,
      branch: runBranch,
      paths: runPaths,
      fileCount: runPaths.length,
    });
    aiBatchGrouping.value = true;
    aiBatchGroupingStep.value = "连接服务…";
    gitError.value = "";
    aiBatchAnalysisComplete.value = false;
    // Anchor the result to the input set before streaming starts. This prevents
    // a concurrent Git status refresh from treating the analysis as a new draft.
    batchUnstagedSnapshot.value = runPaths;
    batchDraftBranch.value = runBranch;
    let accumulatedJson = "";
    try {
      const result = await aiBatchGroupsApi(
        projectPath(),
        cfg.endpoint.trim(),
        cfg.apiKey.trim(),
        cfg.model.trim(),
        (delta) => {
          if (runId !== aiBatchRunId) {
            debugLog("[git-ai] stale delta ignored", { runId, activeRunId: aiBatchRunId, chars: delta.length });
            return;
          }
          accumulatedJson += delta;
          const partial = parsePartialGroups(accumulatedJson);
          if (partial.length > 0) {
            aiBatchGroupsResult.value = partial;
          }
        },
        (step) => {
          if (runId !== aiBatchRunId) {
            debugLog("[git-ai] stale progress ignored", { runId, activeRunId: aiBatchRunId, step });
            return;
          }
          aiBatchGroupingStep.value = step;
        },
      );
      if (runId !== aiBatchRunId || projectPath().trim() !== runProject || batchDraftScope().branch !== runBranch) {
        debugLog("[git-ai] stale result ignored", {
          runId,
          activeRunId: aiBatchRunId,
          projectChanged: projectPath().trim() !== runProject,
          branchChanged: batchDraftScope().branch !== runBranch,
          ok: result.ok,
          groupCount: result.groups?.length ?? 0,
        });
        return;
      }
      if (!result.ok) {
        debugLog("[git-ai] analysis failed", { runId, error: result.error, partialGroupCount: aiBatchGroupsResult.value?.length ?? 0 });
        gitError.value = result.error || "AI 分组失败";
        if (result.groups.length > 0) {
          aiBatchGroupsResult.value = result.groups;
          gitError.value += "；已保留已识别的部分分组";
        } else if (aiBatchGroupsResult.value?.length) {
          gitError.value += "；分析未完成，已保留已识别的部分分组";
        } else {
          aiBatchGroupsResult.value = null;
        }
        // Keep recoverable groups across reloads, but persist the incomplete
        // flag so they remain non-committable until a full rerun succeeds.
        if (aiBatchGroupsResult.value?.length) {
          batchSectionOpen.value = true;
          batchMessages.value = batchGroups.value.map((g) => defaultBatchMessage(g));
          persistBatchDraft();
          debugLog("[git-ai] partial analysis persisted", {
            runId,
            groupCount: aiBatchGroupsResult.value.length,
            complete: false,
          });
        }
      } else if (result.groups.length === 0) {
        debugLog("[git-ai] analysis returned no groups", { runId });
        gitError.value = "AI 未返回有效分组，请重试或手动按目录提交";
        aiBatchGroupsResult.value = null;
      } else {
        debugLog("[git-ai] analysis success", { runId, groupCount: result.groups.length, paths: result.groups.flatMap((g) => g.files).length });
        aiBatchGroupsResult.value = result.groups;
        aiBatchAnalysisComplete.value = true;
        batchUnstagedSnapshot.value = currentBatchPaths();
        batchSectionOpen.value = true;
        batchMessages.value = batchGroups.value.map((g) => defaultBatchMessage(g));
        persistBatchDraft();
        aiBatchGroupingStep.value = "完成 ✓";
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) {
      if (runId !== aiBatchRunId) {
        debugLog("[git-ai] stale error ignored", { runId, activeRunId: aiBatchRunId });
        return;
      }
      debugLog("[git-ai] analysis exception", { runId, error: e instanceof Error ? e.message : String(e) });
      gitError.value = toErrorMessage(e, "AI 分组失败");
      if (aiBatchGroupsResult.value?.length) {
        gitError.value += "；分析未完成，已保留已识别的部分分组";
      } else {
        aiBatchGroupsResult.value = null;
      }
    } finally {
      if (runId === aiBatchRunId) {
        aiBatchGrouping.value = false;
        aiBatchGroupingStep.value = "";
        debugLog("[git-ai] analysis settled", { runId, complete: aiBatchAnalysisComplete.value });
      }
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
