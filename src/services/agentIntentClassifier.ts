/**
 * Backward-compatible barrel for intent classification.
 * Prefer direct imports:
 * - `./intentClassifierRules` — rule baseline + resolveUserIntent
 * - `./intentClassifierAi` — AI classifier prompt/parse
 * - `./intentClassifierTypes` — shared types
 */
export type {
  ConsultativeTopicId,
  ResolvedUserIntent,
  ResolveUserIntentInput,
  UserIntentAiPayload,
  UserIntentPrimary,
} from "./intentClassifierTypes";

export {
  classifyUserIntentFromRules,
  resolveUserIntent,
  shouldSkipAiIntentClassifier,
} from "./intentClassifierRules";

export {
  buildIntentCacheKey,
  buildIntentClassifierSystemPrompt,
  buildIntentClassifierUserMessage,
  formatIntentClassificationDetail,
  parseIntentClassifierResponse,
  resolveIntentClassifierModel,
  shouldUseAiIntentClassifier,
  summarizeIntentHistory,
} from "./intentClassifierAi";
