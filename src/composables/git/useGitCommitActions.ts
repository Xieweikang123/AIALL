import { toErrorMessage } from "../../utils/vibeHelpers";
import {
  commitGitChanges,
  generateCommitMessage as generateCommitMessageApi,
  gitPushRemote,
} from "../../services/vibeGitClient";
import type { GitPanelState } from "./createGitPanelState";

export interface UseGitCommitActionsOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  aiConfig: () => { endpoint: string; apiKey: string; model: string };
  configReady: () => boolean;
  state: GitPanelState;
  onRefreshTree?: () => void;
  refreshGitStatus: (options?: { showLoading?: boolean; force?: boolean }) => Promise<void>;
  refreshGitRemotes: () => Promise<void>;
  refreshGitLogIfOpen: (pathOverride?: string) => Promise<void>;
  refreshGitAheadCommits: (aheadCount?: number) => Promise<void>;
}

export function useGitCommitActions(options: UseGitCommitActionsOptions) {
  const {
    projectPath,
    projectOpened,
    aiConfig,
    configReady,
    state,
    onRefreshTree,
    refreshGitStatus,
    refreshGitRemotes,
    refreshGitLogIfOpen,
    refreshGitAheadCommits,
  } = options;

  async function commitGit() {
    if (!projectOpened() || !state.gitCommitMessage.value.trim()) return;
    if (!state.gitStagedFiles.value.length) {
      state.gitError.value = "请先暂存要提交的文件";
      return;
    }
    state.gitCommitting.value = true;
    state.gitError.value = "";
    state.clearGitDiffCache();
    const commitMessage = state.gitCommitMessage.value.trim();
    state.gitStatus.value = state.gitStatus.value.filter((f) => !f.staged);
    state.gitCommitMessage.value = "";
    try {
      const result = await commitGitChanges(projectPath(), commitMessage);
      if (!result.ok) {
        state.gitError.value = result.error || "提交失败";
        state.gitCommitMessage.value = commitMessage;
        await refreshGitStatus();
        return;
      }
      await refreshGitStatus({ showLoading: false, force: true });
      await refreshGitRemotes();
      onRefreshTree?.();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "提交失败");
      await refreshGitStatus({ force: true });
      onRefreshTree?.();
    } finally {
      state.gitCommitting.value = false;
    }
  }

  async function generateCommitMessage() {
    if (!projectOpened() || !state.gitStagedFiles.value.length) return;
    if (!configReady()) {
      state.gitError.value = "请先配置 AI 模型";
      return;
    }
    state.gitError.value = "";
    try {
      state.gitGenStep.value = "获取变更…";
      await new Promise((r) => setTimeout(r, 100));

      state.gitGenStep.value = "AI 生成中…";
      let streamText = "";
      const cfg = aiConfig();
      const result = await generateCommitMessageApi(
        projectPath(),
        cfg.endpoint.trim(),
        cfg.apiKey.trim(),
        cfg.model.trim(),
        (delta) => {
          streamText += delta;
          state.gitCommitMessage.value = streamText.replace(/^["'"']|["'"']$/g, "").trim();
        },
      );
      if (!result.ok) {
        state.gitError.value = result.error || "AI 生成失败";
        return;
      }
      if (!result.message) {
        state.gitError.value = "AI 未返回内容";
        return;
      }
      state.gitGenStep.value = "完成 ✓";
      state.gitCommitMessage.value = result.message;
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "AI 生成提交信息失败");
    } finally {
      state.gitGenStep.value = "";
    }
  }

  async function aiCommitAndPush() {
    if (!projectOpened() || !state.gitStagedFiles.value.length) return;
    if (!configReady()) {
      state.gitError.value = "请先配置 AI 模型";
      return;
    }
    state.gitError.value = "";
    try {
      state.gitAiPushStep.value = "生成中…";
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
          state.gitCommitMessage.value = streamText.replace(/^["'"']|["'"']$/g, "").trim();
        },
      );
      if (!genResult.ok) {
        state.gitError.value = genResult.error || "AI 生成提交信息失败";
        return;
      }
      if (!genResult.message) {
        state.gitError.value = "AI 未返回内容";
        return;
      }
      state.gitCommitMessage.value = genResult.message;

      state.gitAiPushStep.value = "提交中…";
      await new Promise((r) => setTimeout(r, 100));
      state.clearGitDiffCache();
      const commitResult = await commitGitChanges(projectPath(), state.gitCommitMessage.value.trim());
      if (!commitResult.ok) {
        state.gitError.value = commitResult.error || "提交失败";
        await refreshGitStatus();
        return;
      }
      await refreshGitStatus({ showLoading: false, force: true });

      state.gitAiPushStep.value = "推送中…";
      await new Promise((r) => setTimeout(r, 100));
      const needsUpstream = !state.gitTrackingBranch.value.trim();
      const remote =
        state.gitSelectedRemote.value.trim()
        || state.gitRemotes.value[0]?.name
        || "origin";
      const branch = state.gitBranch.value.trim() || undefined;
      const pushResult = await gitPushRemote(
        projectPath(),
        needsUpstream ? remote : undefined,
        needsUpstream ? branch : undefined,
        needsUpstream,
      );
      if (!pushResult.ok) {
        state.gitError.value = pushResult.error || "推送失败";
        await refreshGitRemotes();
        return;
      }
      await refreshGitStatus({ showLoading: false, force: true });
      await refreshGitRemotes();
      await refreshGitLogIfOpen();
      await refreshGitAheadCommits();

      state.gitAiPushStep.value = "完成 ✓";
      state.gitCommitMessage.value = "";
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "AI 一键推送失败");
      await refreshGitStatus();
    } finally {
      state.gitAiPushStep.value = "";
    }
  }

  return {
    commitGit,
    generateCommitMessage,
    aiCommitAndPush,
  };
}
