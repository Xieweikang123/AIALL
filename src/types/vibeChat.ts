import type { AgentRoundGroup } from "../services/agentRoundGroups";
import type { AgentToolStep } from "../utils/toolHelpers";
export type { AgentToolStep };
import type { PersistedChatMessage } from "../services/vibeChatStorage";
import type { VibeAgentSseEvent } from "../services/vibeAgentClient";
import type { PersistedFileDiff } from "../services/vibeChatStorageTypes";

export type VibeChatMessage = Omit<PersistedChatMessage, "tools" | "roundGroups"> & {
  tools?: AgentToolStep[];
  roundGroups?: AgentRoundGroup[];
  status?: string;
  agentPhase?: string;
  agentTurn?: number;
  agentMaxTurns?: number;
  agentModel?: string;
  agentDetail?: string;
  streamChars?: number;
  contextChars?: number;
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
