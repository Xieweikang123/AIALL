import type { AgentRoundGroup } from "../services/agentRoundGroups";
import type { AgentToolStep } from "../utils/toolHelpers";
export type { AgentToolStep };
import type { PersistedChatMessage } from "../services/vibeChatStorage";
import type { VibeAgentSseEvent } from "../services/vibeAgentClient";
import type { PersistedFileDiff } from "../services/vibeChatStorageTypes";

export type VibeChatMessage = Omit<PersistedChatMessage, "tools" | "roundGroups"> & {
  tools?: AgentToolStep[];
  roundGroups?: AgentRoundGroup[];
  intentTrace?: {
    aiRawResponse?: string;
    aiMessages?: Array<{ role: string; content: string }>;
    finalResult?: string;
    skippedAi?: boolean;
    aiModel?: string;
    elapsedMs?: number;
    aiPrimary?: string;
    aiFailed?: boolean;
    aiError?: string;
    aiStage?: string;
  };
  status?: string;
  agentPhase?: string;
  agentTurn?: number;
  agentMaxTurns?: number;
  agentModel?: string;
  agentDetail?: string;
  streamChars?: number;
  contextChars?: number;
  contextTokens?: number;
  peakContextTokens?: number;
  /** 供应商上报的输出 token 总量（跨 turn 累加）；缺省时回退字符口径 streamChars。 */
  completionTokens?: number;
  agentWaitStartedAt?: number;
  streaming?: boolean;
  reverting?: boolean;
  applying?: boolean;
  agentAborted?: boolean;
  agentAbortReason?: string;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentFailureReason?: string;
  agentFailureDetail?: string;
  agentRecoveryDismissed?: boolean;
  agentContinueCount?: number;
  _expandedDiffs?: Record<string, boolean>;
};

export type TurnFileDiff = PersistedFileDiff;

export type AgentStatusData = Extract<VibeAgentSseEvent, { type: "status" }>["data"] & {
  toolTitle?: string;
  toolDetail?: string;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryError?: string;
};
