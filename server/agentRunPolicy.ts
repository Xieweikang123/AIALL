import {
  MAX_TOTAL_EXPLORE_TURNS,
  MAX_TOTAL_EXPLORE_TURNS_SOFT,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT,
} from "./agentExplorationBudget";
import { classifyUserIntentFromRules, type ResolvedUserIntent } from "../src/services/intentClassifierRules";
import { isScheduledTaskConsultativePrompt } from "../src/services/agentConsultativeTopics";
import {
  detectUserFailureReport,
  historyRecentUserFailureReport,
  stripQuotedReplyPrefix,
} from "../src/services/agentContinuation";
import { resolveOriginalTaskFromResumePrompt } from "../src/services/agentRecovery";
import { isSameIssueFollowUpRun } from "../src/orchestration/generic/userIntentClassifiers";
import type { UserIntentHistoryMessage } from "../src/orchestration/agentIntentTypes";
import type { ExecutePlanContextInput } from "./agentExecutePlanContext";
import {
  expandQuotedAmendPrompt,
  resolveQuotedAmendIntent,
  type QuotedAmendIntent,
} from "../src/orchestration/generic/quotedAmendIntent";

export const MAX_AGENT_CONTEXT_CHARS = 200_000;
export const EXECUTE_PLAN_MAX_CONTEXT_CHARS = 100_000;
export const ASK_MAX_CONTEXT_CHARS = 80_000;
export const CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS = 48_000;
export const PLAN_MAX_CONTEXT_CHARS = 150_000;

/** Consolidated routing flags — single source for vibeAgent turn loop. */
export interface AgentRunPolicy {
  implementFollowUpRun: boolean;
  sameIssueFollowUpRun: boolean;
  codeReviewRun: boolean;
  userErrorQuoteRun: boolean;
  userFailureReportRun: boolean;
  sessionAuditRun: boolean;
  behaviorContradictionRun: boolean;
  consultativeResumeRun: boolean;
  locateStatusFollowUpRun: boolean;
  readOnlyBuildRun: boolean;
  behaviorPurposeRun: boolean;
  scheduledTaskConsultativeRun: boolean;
  accuracyConsultativeRun: boolean;
  consultativeVisionRun: boolean;
  consultativeUiAppearanceRun: boolean;
  uiDefectBuildRun: boolean;
  agentStepClarifyRun: boolean;
  ultraShortOpenTaskRun: boolean;
  pendingPlanAmendRun: boolean;
  pendingPlanClarifyRun: boolean;
  quotedAmendRun: boolean;
  quotedAmendIntent: QuotedAmendIntent | null;
  exploreHardCap: number;
  exploreSoftCap: number;
  maxContextChars: number;
  effectiveTaskPrompt: string;
  resumeOriginalTask: string | null;
  userRecentlyReportedFailure: boolean;
}

export interface ResolveAgentRunPolicyInput {
  prompt: string;
  mode: "ask" | "build" | "plan" | "explore";
  history?: UserIntentHistoryMessage[];
  userIntent: ResolvedUserIntent;
  runProfile: ExecutePlanContextInput;
  hasImage: boolean;
  isExecutePlan: boolean;
  isPlanExplore: boolean;
}

export function usesReadOnlyTools(
  policy: AgentRunPolicy,
  ctx: { isReadOnlyAgent: boolean; isPlanExplore: boolean },
): boolean {
  return ctx.isReadOnlyAgent || ctx.isPlanExplore || policy.readOnlyBuildRun;
}

/** Session-level read-only turn (Ask/Explore/Plan explore/consultative Build). */
export function isReadOnlyTurn(
  cfg: Pick<{ isReadOnlyAgent: boolean; isPlanExplore: boolean; runPolicy: AgentRunPolicy }, "isReadOnlyAgent" | "isPlanExplore" | "runPolicy">,
): boolean {
  return usesReadOnlyTools(cfg.runPolicy, cfg);
}

export function resolveAgentRunPolicy(input: ResolveAgentRunPolicyInput): AgentRunPolicy {
  const { prompt, mode, history, userIntent, hasImage, isExecutePlan, isPlanExplore } = input;
  const isAsk = mode === "ask";
  const isExplore = mode === "explore";
  const isReadOnlyAgent = isAsk || isExplore;

  const implementFollowUpRun =
    !isReadOnlyAgent && !isPlanExplore && !isExecutePlan && userIntent.implementFollowUp;

  const sameIssueFollowUpRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    !implementFollowUpRun &&
    isSameIssueFollowUpRun(prompt, history);

  const exploreHardCap = sameIssueFollowUpRun
    ? SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE
    : MAX_TOTAL_EXPLORE_TURNS;
  const exploreSoftCap = sameIssueFollowUpRun
    ? SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT
    : MAX_TOTAL_EXPLORE_TURNS_SOFT;

  const codeReviewRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    userIntent.codeReview &&
    !implementFollowUpRun;

  const userErrorQuoteRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    userIntent.userErrorQuote &&
    !implementFollowUpRun;

  const userFailureReportRun =
    !isReadOnlyAgent && !isPlanExplore && !isExecutePlan && detectUserFailureReport(prompt);

  const userRecentlyReportedFailure = historyRecentUserFailureReport(history);

  const sessionAuditRun =
    !isReadOnlyAgent && !isPlanExplore && !isExecutePlan && userIntent.consultativeTopic === "session_audit";

  const behaviorContradictionRun =
    !isPlanExplore && !isExecutePlan && !implementFollowUpRun && userIntent.behaviorContradiction;

  const resumeOriginalTask = resolveOriginalTaskFromResumePrompt(prompt);
  const quotedAmendIntent = resumeOriginalTask ? null : resolveQuotedAmendIntent(prompt);
  const quotedAmendRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    quotedAmendIntent !== null &&
    quotedAmendIntent.kind !== "ambiguous";
  const effectiveTaskPrompt =
    resumeOriginalTask ??
    (quotedAmendRun && quotedAmendIntent
      ? expandQuotedAmendPrompt(prompt, quotedAmendIntent)
      : prompt);

  const consultativeResumeRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    Boolean(
      resumeOriginalTask &&
        classifyUserIntentFromRules({
          prompt: resumeOriginalTask,
          history,
          mode,
          hasImage,
          isAsk: isAsk || isExplore,
        }).consultative,
    );

  const locateStatusFollowUpRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    !implementFollowUpRun &&
    userIntent.locateStatusFollowUp;

  const readOnlyBuildRun =
    !isAsk &&
    !isExplore &&
    !isPlanExplore &&
    !isExecutePlan &&
    (userIntent.consultative ||
      consultativeResumeRun ||
      codeReviewRun ||
      sessionAuditRun ||
      locateStatusFollowUpRun) &&
    !implementFollowUpRun;

  const behaviorPurposeRun =
    !isPlanExplore && !isExecutePlan && !implementFollowUpRun && userIntent.behaviorPurpose;

  const scheduledTaskConsultativeRun =
    !isPlanExplore &&
    !isExecutePlan &&
    !implementFollowUpRun &&
    isScheduledTaskConsultativePrompt(
      stripQuotedReplyPrefix(effectiveTaskPrompt.trim()),
      history,
      userIntent.consultativeTopic,
    );

  const accuracyConsultativeRun = readOnlyBuildRun && userIntent.accuracyQuestion;

  const consultativeVisionRun = hasImage && (isReadOnlyAgent || readOnlyBuildRun);

  const consultativeUiAppearanceRun =
    readOnlyBuildRun && consultativeVisionRun && userIntent.uiAppearance;

  const uiDefectBuildRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    hasImage &&
    userIntent.uiDefect;

  const agentStepClarifyRun = !isReadOnlyAgent && !isPlanExplore && userIntent.agentStepClarification;

  const ultraShortOpenTaskRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    !readOnlyBuildRun &&
    !resumeOriginalTask &&
    userIntent.ultraShortOpenTask;

  const pendingPlanAmendRun = isPlanExplore && userIntent.pendingPlanAmend;
  const pendingPlanClarifyRun = isPlanExplore && userIntent.pendingPlanClarify;

  const maxContextChars = isExecutePlan
    ? EXECUTE_PLAN_MAX_CONTEXT_CHARS
    : isPlanExplore
      ? PLAN_MAX_CONTEXT_CHARS
      : consultativeUiAppearanceRun
        ? CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS
        : isReadOnlyAgent
          ? ASK_MAX_CONTEXT_CHARS
          : MAX_AGENT_CONTEXT_CHARS;

  return {
    implementFollowUpRun,
    sameIssueFollowUpRun,
    codeReviewRun,
    userErrorQuoteRun,
    userFailureReportRun,
    sessionAuditRun,
    behaviorContradictionRun,
    consultativeResumeRun,
    locateStatusFollowUpRun,
    readOnlyBuildRun,
    behaviorPurposeRun,
    scheduledTaskConsultativeRun,
    accuracyConsultativeRun,
    consultativeVisionRun,
    consultativeUiAppearanceRun,
    uiDefectBuildRun,
    agentStepClarifyRun,
    ultraShortOpenTaskRun,
    pendingPlanAmendRun,
    pendingPlanClarifyRun,
    quotedAmendRun,
    quotedAmendIntent,
    exploreHardCap,
    exploreSoftCap,
    maxContextChars,
    effectiveTaskPrompt,
    resumeOriginalTask,
    userRecentlyReportedFailure,
  };
}
