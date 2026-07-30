import { debugLog } from "../../utils/debugLog";
import { toErrorMessage } from "../../utils/vibeHelpers";
import {
  fetchGitBranches,
  gitCheckoutBranch as gitCheckoutBranchApi,
  gitDeleteBranch as gitDeleteBranchApi,
  gitMerge,
  gitMergeAbort,
  gitRebase,
  gitRebaseAbort,
  gitCherryPick,
  gitRevertCommit,
  gitTagCreate,
  gitTagDelete,
  gitSubmoduleUpdate,
  gitResolveConflict,
  gitResetToCommit,
  fetchGitTags,
  fetchGitSubmodules,
  type GitConflictSide,
  type GitResetMode,
} from "../../services/vibeGitClient";
import type { GitPanelState } from "./createGitPanelState";

export interface UseGitAdvancedActionsOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>;
  onRefreshTree?: () => void;
  refreshGitStatus: (options?: { showLoading?: boolean; force?: boolean }) => Promise<void>;
}

export function useGitAdvancedActions(options: UseGitAdvancedActionsOptions) {
  const {
    projectPath,
    projectOpened,
    state,
    confirm,
    onRefreshTree,
    refreshGitStatus,
  } = options;

  async function refreshGitBranches() {
    if (!projectOpened() || !state.gitIsRepo.value) return;
    try {
      const result = await fetchGitBranches(projectPath());
      if (result.ok) {
        state.gitBranches.value = result.branches;
      }
    } catch (e) {
      debugLog("refreshGitBranches exception:", e);
    }
  }

  async function checkoutBranch(branchName: string, createNew = false, startPoint?: string) {
    if (!projectOpened()) return;
    state.gitLoading.value = true;
    state.gitError.value = "";
    try {
      const result = await gitCheckoutBranchApi(projectPath(), branchName, createNew, startPoint);
      if (!result.ok) {
        state.gitError.value = result.error || "切换分支失败";
        return;
      }
      await refreshGitStatus({ force: true });
      onRefreshTree?.();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "切换分支失败");
    } finally {
      state.gitLoading.value = false;
    }
  }

  async function createBranch(branchName: string, startPoint?: string) {
    await checkoutBranch(branchName, true, startPoint);
  }

  async function deleteBranch(branchName: string, force = false) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定要删除本地分支 ${branchName} 吗？`);
    if (!ok) return;
    state.gitLoading.value = true;
    state.gitError.value = "";
    try {
      const result = await gitDeleteBranchApi(projectPath(), branchName, force);
      if (!result.ok) {
        state.gitError.value = result.error || "删除分支失败";
        return;
      }
      await refreshGitBranches();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "删除分支失败");
    } finally {
      state.gitLoading.value = false;
    }
  }

  async function resolveConflict(filePath: string, side: GitConflictSide = "ours") {
    if (!projectOpened()) return;
    state.gitError.value = "";
    try {
      const result = await gitResolveConflict(projectPath(), filePath, side);
      if (!result.ok) {
        state.gitError.value = result.error || "解决冲突失败";
        return;
      }
      await refreshGitStatus({ force: true });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "解决冲突失败");
    }
  }

  async function doMerge(source: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定合并分支 ${source} 到当前分支？`, event);
    if (!ok) return;
    state.gitError.value = "";
    state.gitMergeInProgress.value = true;
    try {
      const result = await gitMerge(projectPath(), source);
      if (!result.ok) {
        state.gitError.value = result.error || "合并失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
      onRefreshTree?.();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "合并失败");
    } finally {
      state.gitMergeInProgress.value = false;
    }
  }

  async function doMergeAbort(event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm("确定中止合并？", event);
    if (!ok) return;
    state.gitError.value = "";
    try {
      const result = await gitMergeAbort(projectPath());
      if (!result.ok) {
        state.gitError.value = result.error || "中止合并失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "中止合并失败");
    }
  }

  async function doRebase(onto: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定变基到 ${onto}？`, event);
    if (!ok) return;
    state.gitError.value = "";
    state.gitRebaseInProgress.value = true;
    try {
      const result = await gitRebase(projectPath(), onto);
      if (!result.ok) {
        state.gitError.value = result.error || "变基失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "变基失败");
    } finally {
      state.gitRebaseInProgress.value = false;
    }
  }

  async function doRebaseAbort(event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm("确定中止变基？", event);
    if (!ok) return;
    state.gitError.value = "";
    try {
      const result = await gitRebaseAbort(projectPath());
      if (!result.ok) {
        state.gitError.value = result.error || "中止变基失败";
        return;
      }
      await refreshGitStatus({ force: true });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "中止变基失败");
    }
  }

  async function doCherryPick(hash: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定拣选提交 ${hash.slice(0, 8)}？`, event);
    if (!ok) return;
    state.gitError.value = "";
    try {
      const result = await gitCherryPick(projectPath(), hash);
      if (!result.ok) {
        state.gitError.value = result.error || "拣选失败";
        return;
      }
      await refreshGitStatus({ force: true });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "拣选失败");
    }
  }

  async function doRevertCommit(hash: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定还原提交 ${hash.slice(0, 8)}？`, event);
    if (!ok) return;
    state.gitError.value = "";
    try {
      const result = await gitRevertCommit(projectPath(), hash);
      if (!result.ok) {
        state.gitError.value = result.error || "还原提交失败";
        return;
      }
      await refreshGitStatus({ force: true });
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "还原提交失败");
    }
  }

  async function doCreateTag(name?: string, hash?: string, event?: MouseEvent) {
    const tagName = name || state.gitTagNameInput.value.trim();
    if (!projectOpened() || !tagName) return;
    const ok = await confirm(`确定创建标签 ${tagName}？`, event);
    if (!ok) return;
    state.gitError.value = "";
    try {
      const result = await gitTagCreate(projectPath(), tagName, hash);
      if (!result.ok) {
        state.gitError.value = result.error || "创建标签失败";
        return;
      }
      state.gitTagNameInput.value = "";
      const tagsResult = await fetchGitTags(projectPath());
      if (tagsResult.ok) state.gitTags.value = tagsResult.tags;
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "创建标签失败");
    }
  }

  async function doDeleteTag(name: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm(`确定删除标签 ${name}？`, event);
    if (!ok) return;
    state.gitError.value = "";
    try {
      const result = await gitTagDelete(projectPath(), name);
      if (!result.ok) {
        state.gitError.value = result.error || "删除标签失败";
        return;
      }
      const tagsResult = await fetchGitTags(projectPath());
      if (tagsResult.ok) state.gitTags.value = tagsResult.tags;
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "删除标签失败");
    }
  }

  async function doSubmoduleUpdate(event?: MouseEvent) {
    if (!projectOpened()) return;
    const ok = await confirm("确定更新子模块？", event);
    if (!ok) return;
    state.gitError.value = "";
    try {
      const result = await gitSubmoduleUpdate(projectPath());
      if (!result.ok) {
        state.gitError.value = result.error || "子模块更新失败";
        return;
      }
      const subResult = await fetchGitSubmodules(projectPath());
      if (subResult.ok) state.gitSubmodules.value = subResult.submodules;
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "子模块更新失败");
    }
  }

  async function doResetCommit(hash: string, mode: GitResetMode = "mixed", shortHash?: string, event?: MouseEvent) {
    if (!projectOpened()) return;
    const label = shortHash || hash.slice(0, 8);
    const ok = await confirm(`确定重置到 ${label}（${mode} 模式）？此操作可能丢失更改。`, event);
    if (!ok) return;
    state.gitError.value = "";
    try {
      const result = await gitResetToCommit(projectPath(), hash, mode);
      if (!result.ok) {
        state.gitError.value = result.error || "重置失败";
        return;
      }
      await refreshGitStatus({ force: true });
      await refreshGitBranches();
      onRefreshTree?.();
    } catch (e) {
      state.gitError.value = toErrorMessage(e, "重置失败");
    }
  }

  return {
    refreshGitBranches,
    checkoutBranch,
    createBranch,
    deleteBranch,
    resolveConflict,
    doMerge,
    doMergeAbort,
    doRebase,
    doRebaseAbort,
    doCherryPick,
    doRevertCommit,
    doCreateTag,
    doDeleteTag,
    doSubmoduleUpdate,
    doResetCommit,
  };
}
