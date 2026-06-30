import {
  IMPLEMENT_INTENT_RE,
  isAccuracyConsultativePrompt,
  isAgentStepClarificationPrompt,
  isAutomationResumePrompt,
  isBehaviorContradictionPrompt,
  isBehaviorPurposePrompt,
  isCodeReviewPrompt,
  isConsultativeUserPrompt,
  isImplementationStatusPrompt,
  isImplementFollowUpRun,
  isLocateStatusFollowUpPrompt,
  isSessionAuditPrompt,
  isShortContextDependentFollowUp,
  isUiAppearanceQuestionPrompt,
  isUiDefectReportPrompt,
  isUserErrorQuotePrompt,
  isUltraShortOpenTaskPrompt,
  resolveConfigBindingTopic,
} from "../orchestration/generic/userIntentClassifiers";
import { isConsultativeRootAction } from "../orchestration/generic/actionClassifier";
import { isQuotedAmendPrompt } from "../orchestration/generic/quotedAmendIntent";
import { isScheduledTaskTopicPrompt } from "./agentConsultativeTopics";
import { PROJECT_OVERVIEW_TOPIC_RE } from "./agentStructuralPatterns";
import {
  isPendingPlanAmendPrompt,
  isPendingPlanClarifyPrompt,
} from "./agentContinuation";
import type { UserIntentHistoryMessage } from "../orchestration/agentIntentTypes";
import type {
  ConsultativeTopicId,
  ResolvedUserIntent,
  ResolveUserIntentInput,
  UserIntentAiPayload,
  UserIntentPrimary,
} from "./intentClassifierTypes";

function inferConsultativeTopicFromRules(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): ConsultativeTopicId {
  const text = prompt.trim();
  if (isSessionAuditPrompt(text)) return "session_audit";
  if (isScheduledTaskTopicPrompt(text)) return "scheduled_task";
  if (isBehaviorPurposePrompt(text, history)) return "behavior_purpose";
  if (isAccuracyConsultativePrompt(text)) return "accuracy";
  if (isCodeReviewPrompt(text)) return "code_review";
  if (isImplementationStatusPrompt(text)) return "implementation_status";
  if (isAgentStepClarificationPrompt(text)) return "step_clarification";
  if (isBehaviorContradictionPrompt(text, history)) return "behavior_contradiction";
  if (resolveConfigBindingTopic(text)) return "config_binding";
  if (isUiAppearanceQuestionPrompt(text)) return "ui_appearance";
  if (PROJECT_OVERVIEW_TOPIC_RE.test(text)) {
    return "project_overview";
  }
  if (isConsultativeUserPrompt(text, history)) return "general";
  return "none";
}

/** Rule-based baseline — used as fallback and for hard safety overrides. */
export function classifyUserIntentFromRules(input: ResolveUserIntentInput): ResolvedUserIntent {
  const text = input.prompt.trim();
  const history = input.history;
  const mode = input.mode;
  const automation = isAutomationResumePrompt(text);
  const uiDefect = isUiDefectReportPrompt(text, input.hasImage);
  const implementFollowUp = isImplementFollowUpRun(text, history, { isAsk: input.isAsk });
  const pendingPlanClarify =
    mode === "plan" && isPendingPlanClarifyPrompt(text, history);
  const pendingPlanAmend =
    mode === "plan" && !pendingPlanClarify && isPendingPlanAmendPrompt(text, history);
  const consultativeRootAction =
    !automation && !uiDefect && !implementFollowUp && !pendingPlanAmend && isConsultativeRootAction(text);
  const consultative =
    pendingPlanClarify ||
    consultativeRootAction ||
    (!automation && !uiDefect && !implementFollowUp && !pendingPlanAmend && isConsultativeUserPrompt(text, history));

  const topic = inferConsultativeTopicFromRules(text, history);

  const forceConsultativePrimary = pendingPlanAmend || pendingPlanClarify;
  const primary: UserIntentPrimary = automation
    ? "automation"
    : forceConsultativePrimary
      ? "consultative"
      : implementFollowUp || !consultative
        ? "implement"
        : "consultative";

  return {
    primary,
    consultative,
    consultativeTopic: topic,
    implementFollowUp,
    uiDefect,
    codeReview: isCodeReviewPrompt(text),
    behaviorContradiction: isBehaviorContradictionPrompt(text, history),
    behaviorPurpose: isBehaviorPurposePrompt(text, history),
    scheduledTask: isScheduledTaskTopicPrompt(text),
    accuracyQuestion: isAccuracyConsultativePrompt(text),
    implementationStatus: isImplementationStatusPrompt(text),
    agentStepClarification: isAgentStepClarificationPrompt(text),
    userErrorQuote: isUserErrorQuotePrompt(text, history),
    uiAppearance: isUiAppearanceQuestionPrompt(text),
    configBindingTopic: resolveConfigBindingTopic(text),
    ultraShortOpenTask: isUltraShortOpenTaskPrompt(text),
    locateStatusFollowUp: isLocateStatusFollowUpPrompt(text, history),
    pendingPlanAmend,
    pendingPlanClarify,
    classificationSource: "rules",
  };
}

function buildResolvedFromAi(ai: UserIntentAiPayload, rules: ResolvedUserIntent): ResolvedUserIntent {
  const implementFollowUp = rules.implementFollowUp || ai.implementFollowUp;
  const primary: UserIntentPrimary = implementFollowUp
    ? "implement"
    : ai.primary === "automation"
      ? "automation"
      : ai.primary;
  const consultative = primary === "consultative";

  return {
    primary,
    consultative,
    consultativeTopic: ai.consultativeTopic,
    implementFollowUp,
    uiDefect: ai.uiDefect,
    codeReview: ai.codeReview,
    behaviorContradiction: ai.behaviorContradiction,
    behaviorPurpose: ai.behaviorPurpose,
    scheduledTask: ai.scheduledTask,
    accuracyQuestion: ai.accuracyQuestion,
    implementationStatus: ai.implementationStatus,
    agentStepClarification: ai.agentStepClarification,
    userErrorQuote: ai.userErrorQuote,
    uiAppearance: ai.uiAppearance,
    configBindingTopic: ai.configBindingTopic,
    ultraShortOpenTask: rules.ultraShortOpenTask,
    locateStatusFollowUp: rules.locateStatusFollowUp,
    pendingPlanAmend: rules.pendingPlanAmend,
    pendingPlanClarify: rules.pendingPlanClarify,
    classificationSource: "ai",
  };
}

function applyConsultativeActionOverride(
  resolved: ResolvedUserIntent,
  prompt: string,
  rules: ResolvedUserIntent,
): ResolvedUserIntent {
  if (
    resolved.implementFollowUp ||
    resolved.uiDefect ||
    resolved.pendingPlanAmend ||
    resolved.pendingPlanClarify ||
    isAutomationResumePrompt(prompt) ||
    !rules.consultative
  ) {
    return resolved;
  }
  if (resolved.primary === "consultative" && resolved.consultative) return resolved;
  return { ...resolved, primary: "consultative", consultative: true };
}

/** Merge AI classification with rule baseline; hard overrides win over AI. */
export function resolveUserIntent(input: ResolveUserIntentInput): ResolvedUserIntent {
  const rules = classifyUserIntentFromRules(input);

  if (isAutomationResumePrompt(input.prompt) || rules.uiDefect) {
    return {
      ...rules,
      primary: rules.uiDefect ? "implement" : rules.primary,
      consultative: false,
      consultativeTopic: rules.uiDefect ? "none" : rules.consultativeTopic,
      classificationSource: "rules",
    };
  }

  const ai = input.ai;
  let resolved = ai ? buildResolvedFromAi(ai, rules) : rules;
  resolved = applyConsultativeActionOverride(resolved, input.prompt, rules);
  return resolved;
}

/** High-confidence rule outcome — skip extra classifier model call. */
export function shouldSkipAiIntentClassifier(
  rules: ResolvedUserIntent,
  prompt: string,
  opts?: { isAsk?: boolean },
): boolean {
  const text = prompt.trim();
  if (!text) return true;
  if (isShortContextDependentFollowUp(text)) return true;
  if (rules.pendingPlanAmend || rules.pendingPlanClarify) return true;
  if (isQuotedAmendPrompt(text)) return true;
  if (rules.primary === "automation" || rules.uiDefect || rules.implementFollowUp) return true;
  if (rules.primary === "implement" && IMPLEMENT_INTENT_RE.test(text)) return true;
  if (rules.consultativeTopic !== "none" && rules.consultativeTopic !== "general") return true;
  if (opts?.isAsk && rules.consultative) return true;
  return false;
}
