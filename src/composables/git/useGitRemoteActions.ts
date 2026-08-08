import { toErrorMessage } from "../../utils/vibeHelpers";
import {
  fetchGitRemotes,
  gitFetchRemote,
  gitPullRemote,
  gitPushRemote,
  gitStashListRemote,
  gitStashSaveRemote,
  gitStashApplyRemote,
  gitStashDropRemote,
  gitStashPopRemote,
  fetchAheadCommits,
  fetchBehindCommits,
} from "../../services/vibeGitClient";
import type { GitPanelState } from "./createGitPanelState";

export interface UseGitRemoteActionsOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>;
  refreshGitStatus: (options?: { showLoading?: boolean; force?: boolean }) => Promise<void>;
  refreshGitLogIfOpen: (pathOverride?: string) => Promise<void>;
}

export function useGitRemoteActions(options: UseGitRemoteActionsOptions) {
  const {
    projectPath,
    projectOpened,
    state,
    confirm,
    refreshGitStatus,
    refreshGitLogIfOpen,
  } = options;

  async function refreshGitAheadCommits(aheadCount?: number) {
    const ahead = aheadCount ?? state.gitAhead.value;
    if (!projectOpened() || !state.gitIsRepo.value || ahead === 0) {
      state.gitAheadCommits.value = [];
      return;
    }
    state.gitAheadCommitsLoading.value = true;
    try {
      const result = await fetchAheadCommits(projectPath(), 20);
      if (result.ok) {
        state.gitAheadCommits.value = result.entries;
      }
    } catch {
      // ignore
    } finally {
      state.gitAheadCommitsLoading.value = false;
    }
  }

  async function refreshGitBehindCommits(behindCount?: number) {
    const behind = behindCount ?? state.gitBehind.value;
    if (!projectOpened() || !state.gitIsRepo.value || behind === 0) {
      state.gitBehindCommits.value = [];
      return;
    }
    state.gitBehindCommitsLoading.value = true;
    try {
      const result = await fetchBehindCommits(projectPath(), 20);
      if (result.ok) {
        state.gitBehindCommits.value = result.entries;
      }
    } catch {
      // ignore
    } finally {
      state.gitBehindCommitsLoading.value = false;
    }
  }

  async function refreshGitRemotes() {
    if (!projectOpened() || !state.gitIsRepo.value) return;
    state.gitRemoteLoading.value = true;
    try {
      const result = await fetchGitRemotes(projectPath());
      if (result.ok) {
        state.gitRemotes.value = result.remotes;
        state.gitTrackingBranch.value = result.trackingBranch;
        state.gitAhead.value = result.ahead;
        state.gitBehind.value = result.behind;
        void refreshGitAheadCommits(result.ahead);
        void refreshGitBehindCommits(result.behind);
      }
    } catch {
      // ignore
    } finally {
      state.gitRemoteLoading.value = false;
    }
  }

  async function doFetch() {
    if (!projectOpened()) return;
    state.gitRemoteAction.value = "fetch";
    state.gitError.value = "";
    try {
      const result = await gitFetchRemote(projectPath());
      if (!result.ok) {
        state.gitError.value = result.error || "Fetch 失败";
        return;
      }
      await refreshGitRemotes();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "Fetch 失败");
    } finally {
      state.gitRemoteAction.value = "";
    }
  }

  async function doPull() {
    if (!projectOpened()) return;
    state.gitRemoteAction.value = "pull";
    state.gitError.value = "";
    try {
      const result = await gitPullRemote(projectPath());
      if (!result.ok) {
        state.gitError.value = result.error || "Pull 失败";
        return;
      }
      await refreshGitStatus();
      await refreshGitRemotes();
      await refreshGitLogIfOpen();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "Pull 失败");
    } finally {
      state.gitRemoteAction.value = "";
    }
  }

  async function doPush() {
    if (!projectOpened()) return;
    state.gitRemoteAction.value = "push";
    state.gitError.value = "";
    try {
      const needsUpstream = !state.gitTrackingBranch.value.trim();
      const remote =
        state.gitSelectedRemote.value.trim()
        || state.gitRemotes.value[0]?.name
        || "origin";
      const branch = state.gitBranch.value.trim() || undefined;
      const result = await gitPushRemote(
        projectPath(),
        needsUpstream ? remote : undefined,
        needsUpstream ? branch : undefined,
        needsUpstream,
      );
      if (!result.ok) {
        state.gitError.value = result.error || "Push 失败";
        return;
      }
      await refreshGitRemotes();
      await refreshGitLogIfOpen();
      await refreshGitAheadCommits();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "Push 失败");
    } finally {
      state.gitRemoteAction.value = "";
    }
  }

  async function refreshGitStashes() {
    if (!projectOpened()) return;
    try {
      const result = await gitStashListRemote(projectPath());
      if (result.ok) {
        state.gitStashes.value = result.stashes || [];
      }
    } catch {
      // ignore
    }
  }

  async function doStashSave() {
    if (!projectOpened()) return;
    state.gitStashAction.value = "save";
    state.gitError.value = "";
    try {
      const result = await gitStashSaveRemote(projectPath(), state.gitStashMessage.value.trim() || undefined);
      if (!result.ok) {
        state.gitError.value = result.error || "贮藏失败";
        return;
      }
      state.gitStashMessage.value = "";
      await refreshGitStashes();
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "贮藏失败");
    } finally {
      state.gitStashAction.value = "";
    }
  }

  async function doStashApply(stashIndex: string) {
    if (!projectOpened()) return;
    if (!(await confirm(`确定应用 stash@{${stashIndex}}？可能产生冲突。`))) return;
    state.gitStashAction.value = `apply-${stashIndex}`;
    state.gitError.value = "";
    try {
      const result = await gitStashApplyRemote(projectPath(), Number(stashIndex));
      if (!result.ok) {
        state.gitError.value = result.error || "应用贮藏失败";
        return;
      }
      await refreshGitStashes();
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "应用贮藏失败");
    } finally {
      state.gitStashAction.value = "";
    }
  }

  async function doStashDrop(stashIndex: string) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定要删除 stash@{${stashIndex}} 吗？此操作不可撤销。`);
    if (!ok) return;
    state.gitStashAction.value = `drop-${stashIndex}`;
    state.gitError.value = "";
    try {
      const result = await gitStashDropRemote(projectPath(), Number(stashIndex));
      if (!result.ok) {
        state.gitError.value = result.error || "删除贮藏失败";
        return;
      }
      await refreshGitStashes();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "删除贮藏失败");
    } finally {
      state.gitStashAction.value = "";
    }
  }

  async function doStashPop(stashIndex: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定弹出 stash@{${stashIndex}}？`, event);
    if (!ok) return;
    state.gitStashAction.value = `pop-${stashIndex}`;
    state.gitError.value = "";
    try {
      const result = await gitStashPopRemote(projectPath(), Number(stashIndex));
      if (!result.ok) {
        state.gitError.value = result.error || "弹出贮藏失败";
        return;
      }
      await refreshGitStashes();
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "弹出贮藏失败");
    } finally {
      state.gitStashAction.value = "";
    }
  }

  return {
    refreshGitRemotes,
    refreshGitAheadCommits,
    refreshGitBehindCommits,
    doFetch,
    doPull,
    doPush,
    refreshGitStashes,
    doStashSave,
    doStashApply,
    doStashDrop,
    doStashPop,
  };
}
