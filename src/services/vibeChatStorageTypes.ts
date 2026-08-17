export type PersistedImageRef = {
  /** Relative to `.aiall/vibe-chat-sessions/` (e.g. images/{sessionId}/{messageId}-0.png) */
  path: string;
};

export type PersistedFileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
};

export type PersistedAgentContext = {
  mode: "ask" | "build" | "plan" | "explore" | "auto";
  systemPrompt: string;
  history: Array<{ role: string; content: string }>;
  projectContext?: string;
  maxTurns?: number;
  model?: string;
  openFile?: string;
};

export type PersistedTurnTrace = {
  turn: number;
  maxTurns?: number;
  assistantText: string;
  hasToolCalls: boolean;
};

export type PersistedAgentModelStep = {
  id: string;
  text: string;
  phase: string;
};

export type PersistedAgentRoundGroup = {
  turn: number;
  maxTurns?: number;
  narrative?: string;
  modelSteps: PersistedAgentModelStep[];
  toolIds: string[];
  request?: {
    model?: string;
    contextMessages: number;
    contextChars: number;
    messages: Array<{ role: string; content: string; toolCalls?: string }>;
  };
  response?: {
    assistantText: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
    hasToolCalls: boolean;
    isFinal: boolean;
  };
};

export type PersistedChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** In-memory preview; stripped on disk after externalize. */
  imageDataUrls?: string[];
  /** On-disk image paths under `.aiall/vibe-chat-sessions/`. */
  imageRefs?: PersistedImageRef[];
  imageCount?: number;
  chatMode?: "ask" | "build" | "plan" | "explore" | "auto";
  tools?: Array<{
    id: string;
    name?: string;
    icon?: string;
    title?: string;
    detail?: string;
    label: string;
    summary: string;
    ok?: boolean;
    turn?: number;
    fullResult?: string;
    args?: Record<string, unknown>;
  }>;
  agentContext?: PersistedAgentContext;
  statusLog?: string[];
  turnTraces?: PersistedTurnTrace[];
  roundGroups?: PersistedAgentRoundGroup[];
  totalTurns?: number;
  writtenFiles?: string[];
  /** Relative path to on-disk plan document (e.g. `.aiall/plans/<messageId>.md`). */
  planFilePath?: string;
  turnFileDiffs?: Record<string, PersistedFileDiff>;
  pendingApproval?: boolean;
  agentAborted?: boolean;
  agentAbortReason?: string;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentFailureReason?: string;
  agentFailureDetail?: string;
  agentRecoveryDismissed?: boolean;
  agentContinueCount?: number;
  rejected?: boolean;
  reverted?: boolean;
  activityExpanded?: boolean;
  activityDetailed?: boolean;
  agentSuggestions?: Array<{
    label: string;
    action?: "send" | "implement" | "execute_plan";
    text?: string;
  }>;
  /** AI 提取的可点击选项按钮（用户点击后自动回复，无需打字）。 */
  suggestedOptions?: Array<{
    index: number;
    label: string;
    fullText: string;
    showIndex?: boolean;
  }>;
  /** Quote metadata for user messages that were sent with a quoted reply. */
  quotedRole?: "user" | "assistant";
  quotedText?: string;
  /** Token usage tracking */
  streamChars?: number;
  contextChars?: number;
  /** In-flight agent UI (persisted so background runs survive session switch). */
  agentPhase?: string;
  status?: string;
  streaming?: boolean;
};

export type VibeChatSessionMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  status?: "draft" | "active" | "completed" | "failed" | "interrupted";
  /** AI 供应商 id（aiLocalConfig providers[].id）；空 = 跟随全局配置。 */
  providerId?: string;
  /** 磁盘会话文件名（如 chat-<id>.json）；由 id 派生，用于索引→文件映射。 */
  file?: string;
};

export type VibeChatProjectSnapshot = {
  version: number;
  projectPath: string;
  activeSessionId: string;
  sessions: Array<VibeChatSessionMeta & { messages?: PersistedChatMessage[] }>;
  deletedSessionIds?: string[];
};

type VibeChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedChatMessage[];
  status?: "draft" | "active" | "completed" | "failed" | "interrupted";
  /** AI 供应商 id（aiLocalConfig providers[].id）；空 = 跟随全局配置。 */
  providerId?: string;
};

type ProjectChatRecord = {
  activeSessionId: string;
  sessions: VibeChatSession[];
};

type SessionIndexEntry = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** AI 供应商 id；空 = 跟随全局配置。 */
  providerId?: string;
};

type ProjectIndexRecord = {
  activeSessionId: string;
  sessions: SessionIndexEntry[];
  deletedSessionIds?: string[];
};

export type { VibeChatSession, ProjectChatRecord, SessionIndexEntry, ProjectIndexRecord };
