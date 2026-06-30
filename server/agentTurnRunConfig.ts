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
  injectedKeyFilePaths: Set<string>;
  webProxyUrl?: string;
  visionLocateSingleTurnRun: boolean;
  signal?: AbortSignal;
}

export type TurnRunConfigInput = Omit<TurnRunConfig, "injectedKeyFilePaths"> & {
  injectedKeyFilePaths?: Set<string> | string[];
};

export function buildTurnRunConfig(input: TurnRunConfigInput): TurnRunConfig {
  const raw = input.injectedKeyFilePaths;
  const injectedKeyFilePaths =
    raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
  return {
    ...input,
    injectedKeyFilePaths,
  };
}

export { isReadOnlyTurn } from "./agentRunPolicy";
