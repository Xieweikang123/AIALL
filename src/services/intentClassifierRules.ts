import {
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
  isTargetAmbiguousImplementPrompt,
  isUiAppearanceQuestionPrompt,
  isUiDefectReportPrompt,
  isUserErrorQuotePrompt,
  isUltraShortOpenTaskPrompt,
  resolveConfigBindingTopic,
} from "../orchestration/generic/userIntentClassifiers";
import { isConsultativeRootAction } from "../orchestration/generic/actionClassifier";
import { isQuotedAmendPrompt } from "../orchestration/generic/quotedAmendIntent";
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
    needsClarification:
      primary === "implement" && isTargetAmbiguousImplementPrompt(text),
    implementFollowUp,
    uiDefect,
    codeReview: isCodeReviewPrompt(text),
    behaviorContradiction: isBehaviorContradictionPrompt(text, history),
    behaviorPurpose: isBehaviorPurposePrompt(text, history),
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
  const primary: UserIntentPrimary =
    ai.primary === "automation" ? "automation" : ai.primary;
  const consultative = primary === "consultative";

  return {
    primary,
    consultative,
    consultativeTopic: ai.consultativeTopic,
    needsClarification: Boolean(rules.needsClarification || ai.needsClarification),
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
    ultraShortOpenTask: rules.ultraShortOpenTask,
    locateStatusFollowUp: rules.locateStatusFollowUp,
    pendingPlanAmend: rules.pendingPlanAmend,
    pendingPlanClarify: rules.pendingPlanClarify,
    classificationSource: "ai",
  };
}

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
  if (resolved.primary !== "implement") {
    resolved = { ...resolved, needsClarification: false };
  }
  return resolved;
}

/** Protocol-signal only — content/topic classification is delegated to the AI classifier. */
export function shouldSkipAiIntentClassifier(
  rules: ResolvedUserIntent,
  prompt: string,
  opts?: { isAsk?: boolean; mode?: ResolveUserIntentInput["mode"] },
): boolean {
  const text = prompt.trim();
  if (!text) return true;
  // Auto：模式由意图决定，始终交给 AI 分类，不用规则短路。
  if (opts?.mode === "auto") return false;
  if (rules.pendingPlanAmend || rules.pendingPlanClarify) return true;
  if (isQuotedAmendPrompt(text)) return true;
  if (rules.primary === "automation" || rules.uiDefect) return true;
  return false;
}
