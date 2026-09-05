import type {
  ResolvedUserIntent,
  ResolveUserIntentInput,
  UserIntentAiPayload,
  UserIntentPrimary,
} from "./intentClassifierTypes";

function buildResolvedFromAi(ai: UserIntentAiPayload): ResolvedUserIntent {
  const primary: UserIntentPrimary =
    ai.primary === "automation" ? "automation" : ai.primary;
  const consultative = primary === "consultative";

  return {
    primary,
    consultative,
    consultativeTopic: ai.consultativeTopic,
    needsClarification: Boolean(ai.needsClarification),
    implementFollowUp: ai.implementFollowUp,
    uiDefect: ai.uiDefect,
    codeReview: ai.codeReview,
    behaviorContradiction: ai.behaviorContradiction,
    behaviorPurpose: ai.behaviorPurpose,
    accuracyQuestion: ai.accuracyQuestion,
    implementationStatus: ai.implementationStatus,
    agentStepClarification: ai.agentStepClarification,
    userErrorQuote: ai.userErrorQuote,
    uiAppearance: ai.uiAppearance,
    configBindingTopic: ai.configBindingTopic,
    ultraShortOpenTask: false,
    locateStatusFollowUp: false,
    pendingPlanAmend: false,
    pendingPlanClarify: false,
    classificationSource: "ai",
  };
}

/** Minimal fallback when the AI classifier produced no payload. */
function defaultIntent(input: ResolveUserIntentInput): ResolvedUserIntent {
  const primary: UserIntentPrimary = input.isAsk ? "consultative" : "implement";
  return {
    primary,
    consultative: primary === "consultative",
    consultativeTopic: "none",
    needsClarification: false,
    implementFollowUp: false,
    uiDefect: false,
    codeReview: false,
    behaviorContradiction: false,
    behaviorPurpose: false,
    accuracyQuestion: false,
    implementationStatus: false,
    agentStepClarification: false,
    userErrorQuote: false,
    uiAppearance: false,
    configBindingTopic: null,
    ultraShortOpenTask: false,
    locateStatusFollowUp: false,
    pendingPlanAmend: false,
    pendingPlanClarify: false,
    classificationSource: "ai",
  };
}

export function resolveUserIntent(input: ResolveUserIntentInput): ResolvedUserIntent {
  const ai = input.ai;
  if (!ai) return defaultIntent(input);
  return buildResolvedFromAi(ai);
}
