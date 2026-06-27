/**
 * Backward-compatible barrel. Prefer explicit tier imports:
 * - `src/orchestration/generic/userIntentClassifiers` — Tier 1 classifiers
 * - `src/orchestration/product/userIntentHints` — Tier 3 product hints
 */
export * from "../orchestration/generic/userIntentClassifiers";
export * from "../orchestration/product/userIntentHints";
