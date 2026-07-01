import type { Ref } from "vue";
import type { VibeChatMessage, TurnFileDiff } from "../types/vibeChat";
import { parseMemoryProposalToolResult } from "../services/projectMemoryProposal";
import { parseSkillProposalToolResult } from "../services/projectSkillProposal";
import { resolveAgentDoneFileAction } from "../services/vibeAgentTurnApply";

export type ChatMessage = VibeChatMessage;

export interface UseAgentToolDispatchDeps {
  handleAgentWrittenFiles: (files: string[]) => Promise<void>;
  clearTurnFileDiffsFromStore: (diffs: Record<string, TurnFileDiff>) => void;
  storeFileDiff: (relPath: string, before: string, after: string, deleted?: boolean, created?: boolean) => void;
  syncEditorAfterAgentFileChange: (relPath: string, diff: TurnFileDiff) => void;
  onMemoryProposal?: (msgId: string, proposal: any) => void;
  onSkillProposal?: (msgId: string, proposal: any) => void;
}

export function useAgentToolDispatch(deps: UseAgentToolDispatchDeps) {
  const {
    handleAgentWrittenFiles,
    clearTurnFileDiffsFromStore,
    storeFileDiff,
    syncEditorAfterAgentFileChange,
    onMemoryProposal,
    onSkillProposal,
  } = deps;

  function parseAndDispatchProposals(msgId: string, toolResultText: string) {
    const proposal = parseMemoryProposalToolResult(toolResultText);
    if (proposal) {
      onMemoryProposal?.(msgId, proposal);
    }
    const skillProposal = parseSkillProposalToolResult(toolResultText);
    if (skillProposal) {
      onSkillProposal?.(msgId, skillProposal);
    }
  }

  function resolveTurnImageSources(
    options?: { imageDataUrls?: string[] },
  ): string[] {
    if (options && "imageDataUrls" in options) {
      return options.imageDataUrls ?? [];
    }
    return [];
  }

  function applyFileChanges(
    assistantMsg: ChatMessage,
    wasAborted: boolean,
    serverPendingFiles: string[],
    serverWrittenFiles: string[],
  ) {
    const turnFileDiffPaths = assistantMsg.turnFileDiffs
      ? Object.keys(assistantMsg.turnFileDiffs)
      : [];
    const fileAction = resolveAgentDoneFileAction({
      chatMode: assistantMsg.chatMode ?? "build",
      wasAborted,
      serverPendingFiles: serverPendingFiles || [],
      serverWrittenFiles: serverWrittenFiles || [],
      turnFileDiffPaths,
      tools: assistantMsg.tools,
      priorWrittenFiles: assistantMsg.writtenFiles,
    });

    assistantMsg.pendingApproval = fileAction.pendingApproval;
    assistantMsg.writtenFiles = fileAction.writtenFiles;

    return fileAction;
  }

  return {
    parseAndDispatchProposals,
    resolveTurnImageSources,
    applyFileChanges,
    handleAgentWrittenFiles,
    clearTurnFileDiffsFromStore,
    storeFileDiff,
    syncEditorAfterAgentFileChange,
  };
}
