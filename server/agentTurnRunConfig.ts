import type { VibeChatMode } from "../shared/agentTypes";
import type { AgentRunPolicy } from "./agentRunPolicy";

/** Session-level config that stays constant across turn iterations. */
export interface TurnRunConfig {
  projectRoot: string;
  prompt: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  mode: VibeChatMode;
  toolMode: VibeChatMode;
  nudgeMode: VibeChatMode;
  isAsk: boolean;
  isExplore: boolean;
  isReadOnlyAgent: boolean;
  isExecutePlan: boolean;
  isPlanExplore: boolean;
  runPolicy: AgentRunPolicy;
  runProfile: import("./agentExecutePlanContext").ExecutePlanContextInput;
  exploreTurnBudget: number;
  segmentBudget: number;
  maxContextChars: number;
  activeTools: { type: "function"; function: { name: string; description: string; parameters: object } }[];
  imageDataUrls: string[];
  injectedKeyFilePaths: string[];
  webProxyUrl?: string;
  visionLocateSingleTurnRun: boolean;
  signal?: AbortSignal;
}

export type TurnRunConfigInput = TurnRunConfig;

export function buildTurnRunConfig(input: TurnRunConfigInput): TurnRunConfig {
  return {
    ...input,
    injectedKeyFilePaths: input.injectedKeyFilePaths ?? [],
  };
}

export { isReadOnlyTurn } from "./agentRunPolicy";
