export type AgentLogLineItem = {
  key: string;
  label: string;
  state: "done" | "running" | "fail";
};
