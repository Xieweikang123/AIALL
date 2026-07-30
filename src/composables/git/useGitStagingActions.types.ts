import type { GitPanelState } from "./createGitPanelState";

export interface UseGitStagingActionsOptions {
  projectPath: () => string;
  projectOpened: () => boolean;
  state: GitPanelState;
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>;
  onRefreshTree?: () => void;
  refreshGitStatus: (options?: { showLoading?: boolean; force?: boolean }) => Promise<void>;
}
