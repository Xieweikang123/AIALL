/**
 * Backward-compatible barrel. Prefer explicit tier imports:
 * - `src/orchestration/generic/userIntentClassifiers` — Tier 1 classifiers
 * - `src/orchestration/product/userIntentHints` — Tier 3 product hints
 * - `src/orchestration/agentIntentTypes` — shared types
 */
export * from "../orchestration/generic/userIntentClassifiers";
export * from "../orchestration/product/userIntentHints";
export type { UserIntentHistoryMessage, ConfigBindingTopic } from "../orchestration/agentIntentTypes";
