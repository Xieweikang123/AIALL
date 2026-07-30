import type { UseGitStagingActionsOptions } from "./useGitStagingActions.types";
import { useGitFileStagingActions } from "./useGitFileStagingActions";
import { useGitHunkActions } from "./useGitHunkActions";
import { useGitSelectionActions } from "./useGitSelectionActions";

export type { UseGitStagingActionsOptions } from "./useGitStagingActions.types";

export function useGitStagingActions(options: UseGitStagingActionsOptions) {
  const fileStaging = useGitFileStagingActions(options);
  const hunkActions = useGitHunkActions(options);
  const selectionActions = useGitSelectionActions({
    ...options,
    runStageGitFiles: fileStaging.runStageGitFiles,
  });

  return {
    ...fileStaging,
    ...hunkActions,
    ...selectionActions,
  };
}
