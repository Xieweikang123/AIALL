/**
 * Agent orchestration is split into tiers with different genericity rules.
 *
 * - **generic_classifier**: Shape/syntax routing only. No business nouns, no static fix recipes.
 * - **generic_mechanism**: Reusable accuracy/trace contracts. Same guard as classifiers.
 * - **product**: AIALL Vibe Agent modes, vision, session audit, mode prompts. May use product
 *   semantics (截图, Ask/Build/Plan); still must not leak internal component/feature names.
 */

export type OrchestrationTier = "generic_classifier" | "generic_mechanism" | "product";

/** Tier 1 — intent/plan/continuation classifiers and routing flags. */
export const GENERIC_CLASSIFIER_PATHS = [
  "src/orchestration/generic/userIntentClassifiers.ts",
  "src/orchestration/generic/actionClassifier.ts",
  "src/orchestration/generic/ambiguousTermTriggers.ts",
  "src/orchestration/generic/quotedAmendIntent.ts",
  "src/orchestration/agentIntentTypes.ts",
  "src/services/agentContinuation.ts",
  "src/services/agentStructuralPatterns.ts",
  "src/services/agentIntentClassifier.ts",
  "src/services/intentClassifierRules.ts",
  "src/services/intentClassifierAi.ts",
  "src/services/intentClassifierTypes.ts",
  "src/services/agentRunProfile.ts",
  "server/agentExecutePlanContext.ts",
  "server/agentRunPolicy.ts",
  "server/agentTurnBudget.ts",
  "server/consultativeBehaviorTrace.ts",
  "server/consultativeAccuracyTrace.ts",
] as const;

/** Tier 2 — shared accuracy / consultative mechanism strings (not mode-specific prompts). */
export const GENERIC_MECHANISM_PATHS = [
  "src/services/agentReplyAccuracy.ts",
  "src/services/agentConsultativeTopics.ts",
  "shared/agentProbeGuard.ts",
  "server/agentExplorationBudget.ts",
  "server/agentExploreGuard.ts",
  "server/agentFinishGate.ts",
  "server/agentTurnPreflight.ts",
  "server/agentTurnValidator.ts",
  "server/agentTurnSegment.ts",
] as const;

/** Tier 3 — product orchestration: system prompts, vision, runtime hints. */
export const PRODUCT_ORCHESTRATION_PATHS = [
  "src/orchestration/product/userIntentHints.ts",
  "server/agentAskPrompt.ts",
  "server/agentExplorePrompt.ts",
  "server/agentPlanPrompt.ts",
  "server/agentContextBuilder.ts",
  "server/agentRuntimeHint.ts",
  "server/visionMessage.ts",
  "server/vibeAgent.ts",
] as const;

/** All guarded paths (union). Used by CI guard tests. */
export const ORCHESTRATION_GUARDED_RELATIVE_PATHS = [
  ...GENERIC_CLASSIFIER_PATHS,
  ...GENERIC_MECHANISM_PATHS,
  ...PRODUCT_ORCHESTRATION_PATHS,
] as const;

export function tierForGuardedPath(rel: string): OrchestrationTier {
  if ((GENERIC_CLASSIFIER_PATHS as readonly string[]).includes(rel)) return "generic_classifier";
  if ((GENERIC_MECHANISM_PATHS as readonly string[]).includes(rel)) return "generic_mechanism";
  return "product";
}
