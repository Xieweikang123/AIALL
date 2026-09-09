export type AgentLogLineState = "done" | "running" | "fail" | "skipped" | "unknown";

export type AgentLogLineItem = {
  key: string;
  label: string;
  state: AgentLogLineState;
};
