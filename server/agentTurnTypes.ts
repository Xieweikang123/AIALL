import type { ChatCompletionMessage, ChatToolCall } from "./aiForward";
import type { VibeAgentEvent } from "../shared/agentTypes";

export type { TurnRunConfig } from "./agentTurnRunConfig";
export { buildTurnRunConfig, isReadOnlyTurn } from "./agentTurnRunConfig";

/** Control-flow directive returned by each turn phase. */
export type TurnPhaseAction = "return" | "continue" | "next";

export interface TurnPhaseResult {
  action: TurnPhaseAction;
}

// ── Preflight ──

export interface TurnPreflightResult extends TurnPhaseResult {
  action: "return" | "next";
  /** Tools available to the model this turn (may be restricted by exploration caps). */
  toolsForTurn: { type: "function"; function: { name: string; description: string; parameters: object } }[];
}

// ── Model call ──

export interface TurnModelCallInput {
  turn: number;
  toolsForTurn: TurnPreflightResult["toolsForTurn"];
  systemPrompt: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  signal?: AbortSignal;
  maxContextChars: number;
}

export interface TurnModelCallResult {
  action: "return" | "continue" | "next";
  /** The raw assistant message from the model (undefined if action !== "next"). */
  rawContent?: string;
  /** User-visible sanitized content (excluding tool-call markup). */
  visibleContent?: string;
  /** Resolved tool calls. */
  toolCalls?: ChatToolCall[];
  /** Number of content characters streamed to the client. */
  streamedChars?: number;
}

// ── Vision first turn ──

export interface TurnVisionResult extends TurnPhaseResult {
  action: "continue" | "next";
}

// ── Response validation ──

export interface TurnValidationResult extends TurnPhaseResult {
  action: "return" | "continue" | "final";
  /** User-visible text for the turn_response event (when action === "final" or "continue"). */
  userText?: string;
  /** Whether this turn has tool calls (for turn_response metadata). */
  hasToolCalls?: boolean;
  /** True when this is the natural terminal turn of the run. */
  isFinal?: boolean;
}

// ── Segment management ──

export interface TurnSegmentResult extends TurnPhaseResult {
  action: "return" | "continue" | "next";
}

// ── Shared helper types ──

export type OnEventFn = (event: VibeAgentEvent) => void;
