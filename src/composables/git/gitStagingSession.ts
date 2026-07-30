import { formatGitStageSkippedHint } from "../../../shared/gitStageGuard";
import type { GitPanelState } from "./createGitPanelState";

/** Shared optimistic-update guard for stage/unstage/discard operations. */
export async function withGitStagingSession(
  state: GitPanelState,
  fn: () => Promise<void>,
): Promise<void> {
  state.gitStagingInProgress.value = true;
  state.gitStatusRefreshToken.value += 1;
  state.gitLastStagingAt.value = Date.now();
  try {
    await fn();
  } finally {
    state.gitLastStagingAt.value = Date.now();
    state.gitStagingInProgress.value = false;
  }
}

export function mergeStageWarnings(blocked: string[], apiWarning?: string): string {
  return [blocked.length ? formatGitStageSkippedHint(blocked) : "", apiWarning || ""]
    .filter(Boolean)
    .join(" ");
}
