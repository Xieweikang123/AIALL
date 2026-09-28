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
  /** Provider reasoning/thinking channel for this turn (separate from the answer narrative). */
  reasoning?: string;
  modelSteps: PersistedAgentModelStep[];
  toolIds: string[];
  /** Narrative stream length (chars) at the moment each tool started — enables chronological interleave. */
  toolNarrativeOffsets?: Array<{ toolId: string; narrativeChars: number }>;
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
  /** 最近一轮真实 prompt token 数（供应商 usage 上报），比 contextChars 准。 */
  contextTokens?: number;
  /** 会话内真实 prompt token 峰值。 */
  peakContextTokens?: number;
  /**
   * 本轮运行供应商上报的输出 token 总量（跨 turn 累加）。
   *
   * 与 `streamChars` 的区别：`streamChars` 只数**正文**字符（推理通道不计），
   * 而供应商的 `completion_tokens` 通常**含**推理 token，所以两者不可换算。
   * 供应商不报 usage 时（部分中转忽略 `include_usage`）为 undefined，
   * 此时界面回退到 `streamChars` 字符口径。
   */
  completionTokens?: number;
  /** 最近一轮的首字延迟（ms）：请求发出 → 首个输出 delta。由 Rust 流式层测量。 */
  ttftMs?: number;
  /** 该次运行中可测得的解码窗口之和（ms）；仅在 token 与窗口配对的样本上参与输出速度。 */
  genMs?: number;
  /** Provider-reported cache usage for this run (aggregated across turns). */
  cacheUsage?: {
    promptTokens?: number;
    cachedTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    hitRatio?: number;
  };
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
  /** 会话固定的具体模型名（aiLocalConfig providers[].availableModels 之一）；空 = 用供应商默认模型。 */
  modelId?: string;
  /** Sticky one-line session goal (auto-derived from clear user demand). */
  sessionGoal?: string;
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
  /** 会话固定的具体模型名；空 = 用供应商默认模型。 */
  modelId?: string;
  /** Sticky one-line session goal (auto-derived from clear user demand). */
  sessionGoal?: string;
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
  /** 会话固定的具体模型名；空 = 用供应商默认模型。 */
  modelId?: string;
  /** Sticky one-line session goal. */
  sessionGoal?: string;
};

type ProjectIndexRecord = {
  activeSessionId: string;
  sessions: SessionIndexEntry[];
  deletedSessionIds?: string[];
};

export type { VibeChatSession, ProjectChatRecord, SessionIndexEntry, ProjectIndexRecord };
