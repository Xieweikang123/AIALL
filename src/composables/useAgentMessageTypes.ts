import type { Ref } from "vue";
import type { LiveAgentAnswerSource } from "../services/agentMessageDisplay";
import type { AgentRoundGroup } from "../services/agentRoundGroups";
import type { VibeChatMessageItem } from "./vibeChatMessageContext";
import type { AgentToolStep } from "../utils/toolHelpers";

/** Assistant message shape used by Agent UI — extends chat list item with agent fields. */
export type AgentMessage = VibeChatMessageItem & {
  roundGroups?: AgentRoundGroup[];
  turnTraces?: Array<{ turn?: number; assistantText?: string }>;
  tools?: AgentToolStep[];
  agentTurn?: number;
  agentPhase?: string;
  agentDetail?: string;
  activityExpanded?: boolean;
  activityDetailed?: boolean;
  totalTurns?: number;
};

export type UseAgentMessageOptions = {
  isAgentRunning: (msg: AgentMessage) => boolean;
  /** Bumped when ephemeral run.live or streaming answer changes — drives display refresh. */
  agentLiveRevision: Ref<number>;
  patchAssistantMsg: (id: string, patch: Record<string, unknown>) => void;
  schedulePersistChat: () => void;
  messageDisplayContent: (msg: AgentMessage) => string;
  /** Ephemeral run.live fields — keeps answer preview aligned with useAgentRun. */
  resolveLiveAgentSource?: (msg: AgentMessage) => LiveAgentAnswerSource;
};
