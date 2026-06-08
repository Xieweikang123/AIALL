import { computed, reactive, ref } from "vue";
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
  const gitLoading = ref(false);
  const gitError = ref("");
  const gitCommitMessage = ref("");
  const gitCommitting = ref(false);
  const gitGenStep = ref("");
  const gitLogEntries = ref<GitLogEntry[]>([]);
  const gitLogOpen = ref(false);
  const gitStagedOpen = ref(true);
  const gitUnstagedOpen = ref(true);
  const expandedGitLogEntries = ref<Set<string>>(new Set());
  const selectedGitFile = ref("");
  const gitDiffLoadingKey = ref("");
  const gitDiffContentCache = ref<Record<string, GitFileDiff>>({});
  const gitRemotes = ref<GitRemoteInfo[]>([]);
  const gitTrackingBranch = ref("");
  const gitAhead = ref(0);
  const gitBehind = ref(0);
  const gitRemoteLoading = ref(false);
  const gitRemoteAction = ref("");
  const gitStashes = ref<Array<{ index: string; message: string }>>([]);
  const gitStashAction = ref("");
  const gitStashMessage = ref("");
  const gitAiPushStep = ref("");

  const gitStagedFiles = computed(() => gitStatus.value.filter((f) => f.staged));
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

  async function refreshGitStatus(options?: { showLoading?: boolean }) {
    if (!projectOpened()) return;
    const showLoading = options?.showLoading !== false;
    if (showLoading) gitLoading.value = true;
    gitError.value = "";
    clearGitDiffCache();
    try {
      const result = await fetchGitStatus(projectPath());
      if (!result.ok) {
        gitError.value = result.error || "获取 Git 状态失败";
        gitIsRepo.value = false;
        return;
      }
      gitIsRepo.value = result.isRepo;
      gitBranch.value = result.branch;
      gitStatus.value = result.files;

      if (result.isRepo) {
        refreshGitRemotes();
        refreshGitStashes();
        if (gitLogOpen.value) {
          const logResult = await fetchGitLog(projectPath(), 20);
          if (logResult.ok) {
            gitLogEntries.value = logResult.entries;
          }
        }
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "获取 Git 状态失败";
    } finally {
      if (showLoading) gitLoading.value = false;
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
    gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: true } : f));
    try {
      const result = await stageGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "暂存失败";
        await refreshGitStatus();
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "暂存失败";
      await refreshGitStatus();
    }
  }

  async function unstageFile(filePath: string) {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    gitStatus.value = gitStatus.value.map((f) => (f.path === filePath ? { ...f, staged: false } : f));
    try {
      const result = await unstageGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus();
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "取消暂存失败";
      await refreshGitStatus();
    }
  }

  async function stageAll() {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    const filesToStage = gitUnstagedFiles.value.map((f) => f.path);
    if (!filesToStage.length) return;
    gitStatus.value = gitStatus.value.map((f) => ({ ...f, staged: true }));
    try {
      const result = await stageGitFiles(projectPath(), filesToStage);
      if (!result.ok) {
        gitError.value = result.error || "暂存失败";
        await refreshGitStatus();
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "暂存失败";
      await refreshGitStatus();
    }
  }

  async function unstageAll() {
    if (!projectOpened()) return;
    gitError.value = "";
    clearGitDiffCache();
    if (!gitStagedFiles.value.length) return;
    gitStatus.value = gitStatus.value.map((f) => ({ ...f, staged: false }));
    try {
      const result = await unstageGitFiles(projectPath(), []);
      if (!result.ok) {
        gitError.value = result.error || "取消暂存失败";
        await refreshGitStatus();
      }
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "取消暂存失败";
      await refreshGitStatus();
    }
  }

  async function discardFile(filePath: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    if (!(await confirm(`确定丢弃 ${filePath} 的更改？`, event))) return;
    gitError.value = "";
    clearGitDiffCache();
    gitStatus.value = gitStatus.value.filter((f) => f.path !== filePath);
    try {
      const result = await discardGitFiles(projectPath(), [filePath]);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus();
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
      await refreshGitStatus();
      onRefreshTree?.();
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
    try {
      const result = await discardGitFiles(projectPath(), unstagedPaths);
      if (!result.ok) {
        gitError.value = result.error || "丢弃更改失败";
        await refreshGitStatus();
      }
      onRefreshTree?.();
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "丢弃更改失败";
      await refreshGitStatus();
      onRefreshTree?.();
    }
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
    selectedGitFile,
    gitDiffLoadingKey,
    gitDiffContentCache,
    gitRemotes,
    gitTrackingBranch,
    gitAhead,
    gitBehind,
    gitRemoteLoading,
    gitRemoteAction,
    gitStashes,
    gitStashAction,
    gitStashMessage,
    gitAiPushStep,

    gitStagedFiles,
    gitUnstagedFiles,
    gitChangeCount,
    canGitCommit,

    clearGitDiffCache,
    gitStatusIcon,
    gitStatusColor,
    isGitLogEntryOpen,
    toggleGitLogEntry,
    gitHistoryDiffKey,
    gitWorkingTreeDiffKey,
    refreshGitStatus,
    commitGit,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    discardFile,
    discardAll,
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
