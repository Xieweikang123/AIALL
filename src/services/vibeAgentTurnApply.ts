import type { VibeChatMode } from "../../shared/agentTypes";
export type { VibeChatMode } from "../../shared/agentTypes";

export type AgentDoneFileAction = {
  autoApply: boolean;
  pendingApproval: boolean;
  writtenFiles: string[] | undefined;
};

/** True when delete failed only because the target path is already gone. */
export function isDeleteNotFoundError(error?: string): boolean {
  if (!error) return false;
  return /不存在|not found|enoent/i.test(error);
}

/** Resolve post-turn UI state after server immediate writes. */
export function resolveAgentDoneFileAction(params: {
  chatMode: VibeChatMode;
  wasAborted: boolean;
  serverPendingFiles: string[];
  serverWrittenFiles: string[];
  turnFileDiffPaths: string[];
}): AgentDoneFileAction {
  const written =
    params.serverWrittenFiles.length > 0
      ? [...params.serverWrittenFiles]
      : params.turnFileDiffPaths.length > 0
        ? [...params.turnFileDiffPaths]
        : undefined;

  return {
    autoApply: false,
    pendingApproval: false,
    writtenFiles: written,
  };
}

export function formatPendingApprovalLabel(
  turnFileDiffs: Record<string, { deleted?: boolean }>,
  aborted?: boolean,
): string {
  const entries = Object.values(turnFileDiffs);
  const deleteCount = entries.filter((diff) => diff.deleted).length;
  const modifyCount = entries.length - deleteCount;
  const parts: string[] = [];
  if (deleteCount) parts.push(`${deleteCount} 个文件删除`);
  if (modifyCount) parts.push(`${modifyCount} 个文件修改`);
  const prefix = aborted ? "已停止 ·" : "待确认";
  return `${prefix} ${parts.join("、")}`;
}

