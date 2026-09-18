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

type ConfirmFn = (
  msg: string,
  event?: MouseEvent,
  options?: { confirmText?: string; cancelText?: string },
) => Promise<boolean>;

function parseStashIndex(raw: string | number): number | null {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function formatStashFailure(fallback: string, error?: string, output?: string): string {
  const detail = (error || output || "").trim();
  return detail ? `${fallback}：${detail}` : fallback;
}

export interface UseGitRemoteActionsOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  confirm: ConfirmFn;
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
        state.gitError.value = formatStashFailure("贮藏失败", result.error, result.output);
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

  async function doStashApply(stashIndex: string | number, event?: MouseEvent) {
    if (!projectOpened()) return;
    const index = parseStashIndex(stashIndex);
    if (index == null) {
      state.gitError.value = "应用贮藏失败：无效的贮藏编号";
      return;
    }
    if (!(await confirm(`确定应用 stash@{${index}}？可能产生冲突。`, event))) return;
    state.gitStashAction.value = `apply-${index}`;
    state.gitError.value = "";
    try {
      const result = await gitStashApplyRemote(projectPath(), index);
      if (!result.ok) {
        state.gitError.value = formatStashFailure("应用贮藏失败", result.error, result.output);
        await refreshGitStashes();
        return;
      }
      await refreshGitStashes();
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "应用贮藏失败");
      await refreshGitStashes();
    } finally {
      state.gitStashAction.value = "";
    }
  }

  async function doStashDrop(stashIndex: string | number, event?: MouseEvent) {
    if (!projectOpened()) return;
    const index = parseStashIndex(stashIndex);
    if (index == null) {
      state.gitError.value = "删除贮藏失败：无效的贮藏编号";
      return;
    }
    const ok = await confirm(`确定删除 stash@{${index}}？此操作不可撤销。`, event, {
      confirmText: "删除",
    });
    if (!ok) return;
    state.gitStashAction.value = `drop-${index}`;
    state.gitError.value = "";
    try {
      const result = await gitStashDropRemote(projectPath(), index);
      if (!result.ok) {
        state.gitError.value = formatStashFailure("删除贮藏失败", result.error, result.output);
        await refreshGitStashes();
        return;
      }
      await refreshGitStashes();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "删除贮藏失败");
      await refreshGitStashes();
    } finally {
      state.gitStashAction.value = "";
    }
  }

  async function doStashPop(stashIndex: string | number, event?: MouseEvent) {
    if (!projectOpened()) return;
    const index = parseStashIndex(stashIndex);
    if (index == null) {
      state.gitError.value = "弹出贮藏失败：无效的贮藏编号";
      return;
    }
    const ok = await confirm(`确定弹出 stash@{${index}}？（应用并删除）`, event);
    if (!ok) return;
    state.gitStashAction.value = `pop-${index}`;
    state.gitError.value = "";
    try {
      const result = await gitStashPopRemote(projectPath(), index);
      if (!result.ok) {
        state.gitError.value = formatStashFailure("弹出贮藏失败", result.error, result.output);
        await refreshGitStashes();
        return;
      }
      await refreshGitStashes();
      await refreshGitStatus({ showLoading: false });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "弹出贮藏失败");
      await refreshGitStashes();
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
