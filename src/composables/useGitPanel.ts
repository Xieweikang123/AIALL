import { computed, onUnmounted, reactive, ref, watch } from "vue";
import { debugLog } from "../utils/debugLog";
import {
  fetchGitStatus,
  fetchGitDiff,
  fetchGitDiffContent,
  fetchGitCommitFileDiff,
  commitGitChanges,
  fetchGitLog,
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
} from "../services/vibeGitClient";

export type GitFileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
};

export function useGitPanel(
  projectPath: () => string,
  projectOpened: () => boolean,
  aiConfig: () => { endpoint: string; apiKey: string; model: string },
  configReady: () => boolean,
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>,
  onRefreshTree?: () => void,
) {
  const GIT_PANEL_MODE_KEY = "vibe-coding-git-panel-mode";

  const gitPanelMode = ref<"files" | "git">(
    localStorage.getItem(GIT_PANEL_MODE_KEY) === "git" ? "git" : "files",
  );
  const gitStatus = ref<GitStatusFile[]>([]);
  const gitBranch = ref("");
  const gitIsRepo = ref(false);
  const gitStatusKnown = ref(false);
  const gitLoading = ref(false);
  const gitError = ref("");
  let gitStatusRefreshToken = 0;
  const gitCommitMessage = ref("");
  const gitCommitting = ref(false);
  const gitGenStep = ref("");
  const gitLogEntries = ref<GitLogEntry[]>([]);
  const gitLogOpen = ref(false);
  const gitStagedOpen = ref(true);
  const gitUnstagedOpen = ref(true);
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
    gitStatus.value = [];
    gitLogEntries.value = [];
    clearGitDiffCache();
  }

  async function refreshGitStatus(options?: { showLoading?: boolean }) {
    if (!projectOpened()) return;
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
      gitStatus.value = result.files;
      gitError.value = "";
      clearGitDiffCache();

      if (result.isRepo) {
        void refreshGitRemotes();
        void refreshGitStashes();
        if (gitLogOpen.value) {
          const logResult = await fetchGitLog(pathAtStart, 20);
          if (token !== gitStatusRefreshToken || projectPath() !== pathAtStart) return;
          if (logResult.ok) {
            gitLogEntries.value = logResult.entries;
          }
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
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "提交失败";
      await refreshGitStatus();
      onRefreshTree?.();
    } finally {
      gitCommitting.value = false;
    }
  }

  async function stageFile(filePath: string) {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    const t = Date.now();
    gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: true } : f));
    gitStagingInProgress.value = true;
    gitLastStagingAt.value = t;
    debugLog("stageFile start", filePath, "ts", t);
    try {
      const result = await stageGitFiles(projectPath(), [filePath]);
      debugLog("stageFile API done", "ok:", result.ok, "elapsed:", Date.now() - t);
      if (!result.ok) {
        gitError.value = result.error || "暂存失败";
        await refreshGitStatus({ showLoading: false });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "暂存失败";
      await refreshGitStatus({ showLoading: false });
    } finally {
      gitStagingInProgress.value = false;
    }
  }

  async function unstageFile(filePath: string) {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: false } : f));
    gitStagingInProgress.value = true;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "取消暂存失败";
      await refreshGitStatus({ showLoading: false });
    } finally {
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
    gitLastStagingAt.value = Date.now();
    try {
      const result = await stageGitFiles(projectPath(), filesToStage);
      if (!result.ok) {
        gitError.value = result.error || "暂存失败";
        await refreshGitStatus({ showLoading: false });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "暂存失败";
      await refreshGitStatus({ showLoading: false });
    } finally {
      gitStagingInProgress.value = false;
    }
  }

  async function unstageAll() {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    if (!gitStagedFiles.value.length) return;
    gitStatus.value = gitStatus.value.map((f) => ({ ...f, staged: false }));
    gitStagingInProgress.value = true;
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), gitStagedFiles.value.map((f) => f.path));
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "取消暂存失败";
      await refreshGitStatus({ showLoading: false });
    } finally {
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
    gitLastStagingAt.value = Date.now();
    try {
      const result = await discardGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus({ showLoading: false });
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
      await refreshGitStatus({ showLoading: false });
      onRefreshTree?.();
    } finally {
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
    gitLastStagingAt.value = Date.now();
    try {
      const result = await discardGitFiles(projectPath(), unstagedPaths);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus({ showLoading: false });
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
      await refreshGitStatus({ showLoading: false });
      onRefreshTree?.();
    } finally {
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
    gitLastStagingAt.value = Date.now();
    try {
      const result = await stageGitFiles(projectPath(), filesToStage);
      if (!result.ok) {
        gitError.value = result.error || "暂存失败";
        await refreshGitStatus({ showLoading: false });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "暂存失败";
      await refreshGitStatus({ showLoading: false });
    } finally {
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
    gitLastStagingAt.value = Date.now();
    try {
      const result = await unstageGitFiles(projectPath(), filesToUnstage);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus({ showLoading: false });
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "取消暂存失败";
      await refreshGitStatus({ showLoading: false });
    } finally {
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
        await refreshGitStatus({ showLoading: false });
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
      await refreshGitStatus({ showLoading: false });
      onRefreshTree?.();
    } finally {
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
      gitAiPushStep.value = "AI 生成提交信息…";
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
      await refreshGitStatus({ showLoading: false });

      gitAiPushStep.value = "推送中…";
      await new Promise((r) => setTimeout(r, 100));
      const pushResult = await gitPushRemote(projectPath());
      if (!pushResult.ok) {
        gitError.value = pushResult.error || "推送失败";
        await refreshGitRemotes();
        return;
      }
      await refreshGitRemotes();

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

  return {
    gitPanelMode,
    gitStatus,
    gitBranch,
    gitIsRepo,
    gitStatusKnown,
    gitLoading,
    gitError,
    gitCommitMessage,
    gitCommitting,
    gitGenStep,
    gitLogEntries,
    gitLogOpen,
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

    gitStagedFiles,
    gitUnstagedFiles,
    gitChangeCount,
    canGitCommit,

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
    doFetch,
    doPull,
    doPush,
    refreshGitStashes,
    doStashSave,
    doStashApply,
    doStashDrop,
  };
}
