import type { Ref } from "vue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentMessage = Record<string, any>;

export type UseAgentMessageOptions = {
  isAgentRunning: (msg: AgentMessage) => boolean;
  agentUiTick: Ref<number>;
  patchAssistantMsg: (id: string, patch: Record<string, unknown>) => void;
  schedulePersistChat: () => void;
  messageDisplayContent: (msg: AgentMessage) => string;
};
