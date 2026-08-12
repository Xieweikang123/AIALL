import {
  MAX_TOTAL_EXPLORE_TURNS,
  MAX_TOTAL_EXPLORE_TURNS_SOFT,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE,
  SAME_ISSUE_FOLLOWUP_MAX_TOTAL_EXPLORE_SOFT,
  AUTO_BUG_FIX_EXPLORE_HARD_CAP,
} from "../../shared/agentExplorationBudget";
import { classifyUserIntentFromRules } from "./intentClassifierRules";
import type { ResolvedUserIntent } from "./intentClassifierTypes";
import {
  detectUserFailureReport,
  historyRecentUserFailureReport,
  stripQuotedReplyPrefix,
} from "./agentContinuation";
import { resolveOriginalTaskFromResumePrompt } from "./agentRecovery";
import { isSameIssueFollowUpRun } from "../orchestration/generic/userIntentClassifiers";
import type { UserIntentHistoryMessage } from "../orchestration/agentIntentTypes";
import type { ExecutePlanContextInput } from "./agentExecutePlanContext";
import {
  expandQuotedAmendPrompt,
  resolveQuotedAmendIntent,
  type QuotedAmendIntent,
} from "../orchestration/generic/quotedAmendIntent";

import {
  ASK_MAX_CONTEXT_CHARS,
  CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS,
  EXECUTE_PLAN_MAX_CONTEXT_CHARS,
  MAX_AGENT_CONTEXT_CHARS,
  PLAN_MAX_CONTEXT_CHARS,
} from "../../shared/agentContextLimits";

export {
  ASK_MAX_CONTEXT_CHARS,
  CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS,
  EXECUTE_PLAN_MAX_CONTEXT_CHARS,
  MAX_AGENT_CONTEXT_CHARS,
  PLAN_MAX_CONTEXT_CHARS,
};

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
  accuracyConsultativeRun: boolean;
  consultativeVisionRun: boolean;
  consultativeUiAppearanceRun: boolean;
  uiDefectBuildRun: boolean;
  agentStepClarifyRun: boolean;
  ultraShortOpenTaskRun: boolean;
  pendingPlanAmendRun: boolean;
  pendingPlanClarifyRun: boolean;
  needsClarificationRun: boolean;
  quotedAmendRun: boolean;
  quotedAmendIntent: QuotedAmendIntent | null;
  automatedBugFixRun: boolean;
  disableSegmentAutoExtend: boolean;
  exploreHardCap: number;
  exploreSoftCap: number;
  maxContextChars: number;
  effectiveTaskPrompt: string;
  resumeOriginalTask: string | null;
  userRecentlyReportedFailure: boolean;
}

export interface ResolveAgentRunPolicyInput {
  prompt: string;
  mode: "ask" | "build" | "plan" | "explore" | "auto";
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
  const { prompt, mode, history, userIntent, hasImage, isExecutePlan, isPlanExplore, runProfile } = input;
  const isAsk = mode === "ask";
  const isExplore = mode === "explore";
  const isReadOnlyAgent = isAsk || isExplore;

  const automatedBugFixRun =
    isExecutePlan && runProfile.triggerSource === "auto_bug_fix";

  const implementFollowUpRun =
    !isReadOnlyAgent && !isPlanExplore && !isExecutePlan && userIntent.implementFollowUp;

  const sameIssueFollowUpRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    !implementFollowUpRun &&
    isSameIssueFollowUpRun(prompt, history);

  const exploreHardCap = automatedBugFixRun
    ? AUTO_BUG_FIX_EXPLORE_HARD_CAP
    : sameIssueFollowUpRun
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

  const needsClarificationRun =
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !isExecutePlan &&
    !readOnlyBuildRun &&
    !implementFollowUpRun &&
    Boolean(userIntent.needsClarification);

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
    accuracyConsultativeRun,
    consultativeVisionRun,
    consultativeUiAppearanceRun,
    uiDefectBuildRun,
    agentStepClarifyRun,
    ultraShortOpenTaskRun,
    pendingPlanAmendRun,
    pendingPlanClarifyRun,
    needsClarificationRun,
    quotedAmendRun,
    quotedAmendIntent,
    automatedBugFixRun,
    disableSegmentAutoExtend: automatedBugFixRun,
    exploreHardCap,
    exploreSoftCap,
    maxContextChars,
    effectiveTaskPrompt,
    resumeOriginalTask,
    userRecentlyReportedFailure,
  };
}
