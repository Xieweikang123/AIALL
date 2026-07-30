import { toErrorMessage } from "../../utils/vibeHelpers";
import {
  fetchGitHunks,
  stageGitHunk,
  unstageGitHunk,
  type GitHunkInfo,
} from "../../services/vibeGitClient";
import type { GitPanelState } from "./createGitPanelState";
import { withGitStagingSession } from "./gitStagingSession";

export interface UseGitHunkActionsOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  refreshGitStatus: (options?: { showLoading?: boolean; force?: boolean }) => Promise<void>;
}

export function useGitHunkActions(options: UseGitHunkActionsOptions) {
  const { projectPath, projectOpened, state, refreshGitStatus } = options;

  async function loadHunksForFile(filePath: string, staged = false): Promise<GitHunkInfo[]> {
    if (!projectOpened() || !filePath) return [];
    const result = await fetchGitHunks(projectPath(), filePath, staged);
    if (!result.ok) {
      state.gitError.value = result.error || "读取变更块失败";
      return [];
    }
    return result.hunks || [];
  }

  async function reloadHunksForTarget(filePath: string) {
    const [unstaged, staged] = await Promise.all([
      loadHunksForFile(filePath, false),
      loadHunksForFile(filePath, true),
    ]);
    state.gitHunks.value = unstaged;
    state.gitStagedHunks.value = staged;
  }

  async function stageHunk(filePath: string, hunkIndex: number) {
    if (!projectOpened()) return;
    state.gitError.value = "";
    state.gitHunkStagingIndex.value = hunkIndex;
    await withGitStagingSession(state, async () => {
      try {
        const result = await stageGitHunk(projectPath(), filePath, hunkIndex);
        if (!result.ok) state.gitError.value = result.error || "暂存变更块失败";
        await refreshGitStatus({ showLoading: false, force: true });
        if (state.gitHunkTargetFile.value === filePath) {
          await reloadHunksForTarget(filePath);
        }
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "暂存变更块失败");
        await refreshGitStatus({ showLoading: false, force: true });
      } finally {
        state.gitHunkStagingIndex.value = null;
      }
    });
  }

  async function unstageHunk(filePath: string, hunkIndex: number) {
    if (!projectOpened()) return;
    state.gitError.value = "";
    state.gitHunkUnstagingIndex.value = hunkIndex;
    await withGitStagingSession(state, async () => {
      try {
        const result = await unstageGitHunk(projectPath(), filePath, hunkIndex);
        if (!result.ok) state.gitError.value = result.error || "取消暂存变更块失败";
        await refreshGitStatus({ showLoading: false, force: true });
        if (state.gitHunkTargetFile.value === filePath) {
          await reloadHunksForTarget(filePath);
        }
      } catch (e) {
        state.gitError.value = toErrorMessage(e, "取消暂存变更块失败");
        await refreshGitStatus({ showLoading: false, force: true });
      } finally {
        state.gitHunkUnstagingIndex.value = null;
      }
    });
  }

  return {
    loadHunksForFile,
    stageHunk,
    unstageHunk,
  };
}
