import type { InjectionKey, Reactive, Ref } from "vue";

export interface VibeChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: string;
  agentPhase?: string;
  chatMode?: "ask" | "build" | "plan" | "explore" | "auto";
  streamChars?: number;
  contextChars?: number;
  writtenFiles?: string[];
  planFilePath?: string;
  reverted?: boolean;
  rejected?: boolean;
  turnFileDiffs?: Record<string, { before?: string; after?: string; deleted?: boolean }>;
  imageCount?: number;
  agentAborted?: boolean;
  agentAbortReason?: string;
  agentFailureReason?: string;
  agentFailureDetail?: string;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentMaxTurns?: number;
  agentContext?: import("../services/vibeChatStorage").PersistedAgentContext;
}

export interface VibeChatMessageContext {
  chatMessages: Ref<VibeChatMessageItem[]>;
  chatSending: Ref<boolean>;
  agentLiveRevision: Ref<number>;
  configReady: Ref<boolean>;
  projectOpened: Ref<boolean>;
  chainJumpVisible: Reactive<Record<string, boolean>>;
  expandedDiffs: Reactive<Record<string, Record<string, boolean>>>;
  onMessageSelect: (event: MouseEvent, msg: VibeChatMessageItem) => void;
  onMessageDoubleClick: (event: MouseEvent, msg: VibeChatMessageItem) => void;
  copyText: (text: string) => void | Promise<boolean>;
  editUserMessage: (messageId: string) => void;
  undoExchange: (messageId: string, event?: MouseEvent) => void;
  resendFromMessage: (messageId: string) => void;
  canResumeAgentRun: (msg: VibeChatMessageItem) => boolean;
  isPartialWrittenRunInterrupt: (msg: VibeChatMessageItem) => boolean;
  resumeAgentRun: (messageId: string) => void;
  resolveAgentResumeButtonLabel: (msg: VibeChatMessageItem) => string;
  isAssistantStalled: (msg: VibeChatMessageItem) => boolean;
  stopAgent: () => void;
  forceRecoverStalledRun: (messageId: string) => void;
  recoverableAgentErrorHint: (msg: VibeChatMessageItem, reason: string) => string;
  agentAbortDisplayReason: (msg: VibeChatMessageItem) => string;
  agentStatusDisplay: (msg: VibeChatMessageItem) => string;
  buildAgentRunningStatusText: (msg: VibeChatMessageItem) => string;
  hasAgentActivity: (msg: VibeChatMessageItem) => boolean;
  isAgentRunning: (msg: VibeChatMessageItem) => boolean;
  patchAssistantMsg: (id: string, patch: Record<string, unknown>) => void;
  schedulePersistChat: () => void;
  messageDisplayContent: (msg: VibeChatMessageItem) => string;
  resolveLiveAgentSource?: (msg: VibeChatMessageItem) => import("../services/agentMessageDisplay").LiveAgentAnswerSource;
  jumpChainToLatest: (messageId: string) => void;
  bindStatusLogScroll: (el: HTMLElement | null, messageId: string) => void;
  onStatusLogScroll: (messageId: string) => void;
  userMessageImages: (msg: VibeChatMessageItem) => string[];
  shouldShowMessageBubble: (msg: VibeChatMessageItem, hasActivity: boolean) => boolean;
  handleAiOptionSelect: (
    option: { index: number; label: string; fullText: string; action?: "implement" },
    msg?: VibeChatMessageItem,
  ) => void;
  previewAgentFile: (messageId: string, relPath: string) => void;
  truncateDiffPreview: (text: string) => string;
  toggleExpandedDiff: (messageId: string, relPath: string) => void;
  isDiffExpanded: (messageId: string, relPath: string) => boolean;
  canExecutePlanMessage: (msg: VibeChatMessageItem) => boolean;
  executePlanFromMessage: (messageId: string) => void | Promise<void>;
  openPlanFileInEditor: (relPath?: string) => void | Promise<void>;
  planExecutionActive: Ref<boolean>;
  planPanelActive: Ref<boolean>;
  planPanelMessageId: Ref<string>;
  planWorkspaceOpen: Ref<boolean>;
  focusPlanPanel: (messageId?: string) => void;
}

export const vibeChatMessageContextKey: InjectionKey<VibeChatMessageContext> = Symbol("vibeChatMessageContext");
