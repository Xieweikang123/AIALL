import type { ChatCompletionMessage } from "./aiForward";
import {
  isRuntimeExploreFailureTurn,
  type ToolGuardContext,
} from "./agentExploreGuard";
import { MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS } from "../shared/agentExplorationBudget";
import type { WriteStage } from "./agentToolExecutor";
import { createWriteStage } from "./agentToolExecutor";
import type { TurnRunConfig } from "./agentTurnRunConfig";
import { isReadOnlyTurn } from "./agentRunPolicy";

/**
 * Central mutable state for a running Agent turn loop.
 *
 * Replaces ~50 scattered `let` variables in runVibeAgent().
 * Each field that was previously a separate mutable binding is now
 * a property on this object, making data flow explicit across turn phases.
 */
export interface AgentTurnContext {
  /** Immutable session routing config — shared across turn phases. */
  runConfig: TurnRunConfig;

  // ── Turn lifecycle ──
  turn: number;
  segmentMaxTurns: number | undefined;
  segmentIndex: number;

  // ── Messages (the LLM conversation) ──
  messages: ChatCompletionMessage[];

  // ── Tool execution ──
  writeStage: WriteStage | null;
  readCache: Map<string, string>;
  readSliceCache: Map<string, string>;
  readSliceRepeatCounts: Map<string, number>;
  grepCache: Map<string, string>;
  toolGuard: ToolGuardContext;

  // ── Exploration tracking ──
  consecutiveExploreTurns: number;
  totalExploreTurns: number;
  /** Skipped explore turns due to runtime tool failures — capped to avoid infinite loops. */
  consecutiveRuntimeToolFailureTurns: number;
  exploreFilesRead: Set<string>;

  // ── Nudge-sent flags (each nudge fires at most once) ──
  turnsLowNudgeSent: boolean;
  interimDiagnosisNudgeSent: boolean;
  patchAnchorNudgeSent: boolean;
  englishPlanningNudgeSent: boolean;
  uiDefectForcePatchNudgeSent: boolean;
  patchAnchorForcePatchNudgeSent: boolean;
  buildExploreForcePatchNudgeSent: boolean;
  scheduledJobRegistrationNudgeSent: boolean;
  fileBreadthNudgeSent: boolean;
  planListDirOnlyNudgeSent: boolean;
  negationNudgeSent: boolean;
  postPatchVerifyNudgeSent: boolean;
  structuredAssetWriteNudgeSent: boolean;
  workspaceCleanupNudgeSent: boolean;

  // ── External probe / schema asset tracking ──
  structuredAssetAcquiredTurn: number | null;
  structuredAssetTableCount: number | null;
  consecutiveProbeTurnsAfterAsset: number;
  ephemeralProbeFilesWritten: Set<string>;
  ephemeralProbeFilesDeleted: Set<string>;

  // ── Location / anchor tracking ──
  patchAnchorLocated: boolean;
  teleportBodyConfirmed: boolean;
  patchAnchorForcePending: boolean;

  // ── Fault & retry tracking ──
  patchFailureLog: Array<{ turn: number; path: string; reason: string }>;
  consecutiveUserNegations: number;
  emptyReplyRetries: number;
  prematureCompletionRetries: number;
  patchFailureCompletionRetries: number;
  manualHandoffRetries: number;
  finishGateRetries: number;
  turnCapFinalSummaryAttempts: number;

  // ── Vision / image state ──
  visionFallbackApplied: boolean;
  visionFirstTurnPending: boolean;
  visionFirstTurnRetries: number;
  visionFirstTurnDescriptionText: string;
  visionLocateToolsUsed: boolean;
  visionLocateReadUsed: boolean;
  visionAutoGrepHadMatches: boolean;
  pregrepUniqueFiles: string[];
  visionConsultativeLocateRetries: number;
  visionConsultativeAccuracyRetries: number;
  behaviorPurposeRetries: number;
  consultativeUiBehaviorRetries: number;

  // ── Consultative mode state ──
  consultativeForceAnswerPending: boolean;
  lastConsultativeExploreSig: string;
  consultativeDuplicateExploreHits: number;
  agentStepClarifyPending: boolean;
  ambiguousTermClarificationPending: boolean;
  ambiguousTermClarificationTerms: string[];
  ambiguousTermClarificationRetries: number;
  exploreAbortGraceTurnActive: boolean;

  /** User quoted plan excerpt and asked an informational question (not revision). */
  planQuoteInformationalRun: boolean;
  /** Pending unexecuted plan — user adopted consultative suggestion; amend existing plan. */
  planPendingAmendRun: boolean;
  /** Pending plan + ambiguous short follow-up — clarify before rewriting. */
  planPendingClarifyRun: boolean;

  // ── Truncation ──
  truncationRetryCount: number;
  outputTruncated: boolean;

  /** One-click auto bug fix tracking */
  autoBugFixWrittenFiles: Set<string>;
  lastVerifyRunSucceeded: boolean | null;
  runStartedAt: number;
}

export function createAgentTurnContext(params: {
  runConfig: TurnRunConfig;
  segmentBudget: number;
  initialMaxTurns: number | undefined;
  ambiguousTermClarificationRun: boolean;
  ambiguousTermClarificationTerms: string[];
  planQuoteInformationalRun: boolean;
  planPendingAmendRun: boolean;
  planPendingClarifyRun: boolean;
}): AgentTurnContext {
  const { runConfig } = params;
  const p = runConfig.runPolicy;
  const isReadOnly = isReadOnlyTurn(runConfig);
  return {
    runConfig,
    turn: 0,
    segmentMaxTurns: params.initialMaxTurns ?? params.segmentBudget,
    segmentIndex: 1,

    messages: [],

    writeStage: isReadOnly ? null : createWriteStage(),
    readCache: new Map(),
    readSliceCache: new Map(),
    readSliceRepeatCounts: new Map(),
    grepCache: new Map(),
    toolGuard: {
      readFileRanges: new Map(),
      patchRecoveryFiles: new Set(),
      visionMisreadActive: false,
      patchAnchorLocated: false,
      teleportBodyConfirmed: false,
      visionAnchorQuotes: [],
      visionLocateActive: false,
      consultativeReadPaths: [],
      consultativeReadFailedPaths: [],
      blockExplorationArchiveWrite:
        p.sameIssueFollowUpRun &&
        (p.userFailureReportRun || p.userRecentlyReportedFailure),
    },

    consecutiveExploreTurns: 0,
    totalExploreTurns: 0,
    consecutiveRuntimeToolFailureTurns: 0,
    exploreFilesRead: new Set(),

    turnsLowNudgeSent: false,
    interimDiagnosisNudgeSent: false,
    patchAnchorNudgeSent: false,
    englishPlanningNudgeSent: false,
    uiDefectForcePatchNudgeSent: false,
    patchAnchorForcePatchNudgeSent: false,
    buildExploreForcePatchNudgeSent: false,
    scheduledJobRegistrationNudgeSent: false,
    fileBreadthNudgeSent: false,
    planListDirOnlyNudgeSent: false,
    negationNudgeSent: false,
    postPatchVerifyNudgeSent: false,
    structuredAssetWriteNudgeSent: false,
    workspaceCleanupNudgeSent: false,

    structuredAssetAcquiredTurn: null,
    structuredAssetTableCount: null,
    consecutiveProbeTurnsAfterAsset: 0,
    ephemeralProbeFilesWritten: new Set(),
    ephemeralProbeFilesDeleted: new Set(),

    patchAnchorLocated: false,
    teleportBodyConfirmed: false,
    patchAnchorForcePending: p.implementFollowUpRun,

    patchFailureLog: [],
    consecutiveUserNegations: 0,
    emptyReplyRetries: 0,
    prematureCompletionRetries: 0,
    patchFailureCompletionRetries: 0,
    manualHandoffRetries: 0,
    finishGateRetries: 0,
    turnCapFinalSummaryAttempts: 0,

    visionFallbackApplied: false,
    visionFirstTurnPending: false,
    visionFirstTurnRetries: 0,
    visionFirstTurnDescriptionText: "",
    visionLocateToolsUsed: false,
    visionLocateReadUsed: false,
    visionAutoGrepHadMatches: false,
    pregrepUniqueFiles: [],
    visionConsultativeLocateRetries: 0,
    visionConsultativeAccuracyRetries: 0,
    behaviorPurposeRetries: 0,
    consultativeUiBehaviorRetries: 0,

    consultativeForceAnswerPending: p.locateStatusFollowUpRun,
    lastConsultativeExploreSig: "",
    consultativeDuplicateExploreHits: 0,
    agentStepClarifyPending: p.agentStepClarifyRun,
    ambiguousTermClarificationPending: params.ambiguousTermClarificationRun,
    ambiguousTermClarificationTerms: params.ambiguousTermClarificationTerms,
    ambiguousTermClarificationRetries: 0,
    exploreAbortGraceTurnActive: false,
    planQuoteInformationalRun: params.planQuoteInformationalRun,
    planPendingAmendRun: params.planPendingAmendRun,
    planPendingClarifyRun: params.planPendingClarifyRun,

    truncationRetryCount: 0,
    outputTruncated: false,

    autoBugFixWrittenFiles: new Set(),
    lastVerifyRunSucceeded: null,
    runStartedAt: Date.now(),
  };
}

/** Plan follow-up that must answer in chat only — no new `[PLAN]`. */
export function isPlanTextOnlyFollowUpRun(ctx: AgentTurnContext): boolean {
  return ctx.planQuoteInformationalRun || ctx.planPendingClarifyRun;
}

/** Plan follow-up that must revise the pending plan document. */
export function isPlanRevisionFollowUpRun(ctx: AgentTurnContext): boolean {
  return ctx.planPendingAmendRun;
}

// ── Semantic state transitions (replace scattered multi-field mutations) ──

/** Sync turn-level flags into the toolGuard that tool executor reads. */
export function syncToolGuard(ctx: AgentTurnContext): void {
  ctx.toolGuard.patchAnchorLocated = ctx.patchAnchorLocated;
  ctx.toolGuard.teleportBodyConfirmed = ctx.teleportBodyConfirmed;
}

/** Called when a tool result indicates a patch anchor was located. */
export function markAnchorLocated(ctx: AgentTurnContext, hasWritableStage: boolean): void {
  ctx.patchAnchorLocated = true;
  if (hasWritableStage) {
    ctx.patchAnchorForcePending = true;
  }
}

/** Called when teleport-to-body is confirmed from a tool result. */
export function markTeleportBodyConfirmed(ctx: AgentTurnContext): void {
  ctx.teleportBodyConfirmed = true;
}

/** Record a failed patch_file call for this turn. */
export function recordPatchFailure(
  ctx: AgentTurnContext,
  turn: number,
  path: string,
  reason: string,
): void {
  ctx.patchFailureLog.push({ turn, path, reason });
}

/** Called after a turn where the model made productive writes — resets explore tracking. */
export function resetExploreOnProductiveWrite(ctx: AgentTurnContext): void {
  ctx.consecutiveExploreTurns = 0;
  ctx.consecutiveRuntimeToolFailureTurns = 0;
  ctx.interimDiagnosisNudgeSent = false;
  ctx.patchAnchorForcePending = false;
  ctx.exploreFilesRead.clear();
  ctx.fileBreadthNudgeSent = false;
}

/** Whether to skip explore-budget increment for a runtime tool failure turn. */
export function shouldSkipExploreTurnForRuntimeFailures(
  ctx: AgentTurnContext,
  outcomes: Array<{ result: string }>,
): boolean {
  if (!isRuntimeExploreFailureTurn(outcomes)) return false;
  return ctx.consecutiveRuntimeToolFailureTurns < MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS;
}

export function markStructuredAssetAcquired(
  ctx: AgentTurnContext,
  turn: number,
  tableCount: number | null,
): void {
  ctx.structuredAssetAcquiredTurn = turn;
  ctx.structuredAssetTableCount = tableCount;
  ctx.consecutiveProbeTurnsAfterAsset = 0;
  ctx.structuredAssetWriteNudgeSent = false;
}

export function resetStructuredAssetTracking(ctx: AgentTurnContext): void {
  ctx.structuredAssetAcquiredTurn = null;
  ctx.structuredAssetTableCount = null;
  ctx.consecutiveProbeTurnsAfterAsset = 0;
  ctx.structuredAssetWriteNudgeSent = false;
}

export function trackEphemeralProbeWrite(ctx: AgentTurnContext, relativePath: string): void {
  const key = relativePath.replace(/\\/g, "/").trim();
  if (!key) return;
  ctx.ephemeralProbeFilesWritten.add(key);
  ctx.ephemeralProbeFilesDeleted.delete(key);
}

export function trackEphemeralProbeDelete(ctx: AgentTurnContext, relativePath: string): void {
  const key = relativePath.replace(/\\/g, "/").trim();
  if (!key) return;
  ctx.ephemeralProbeFilesDeleted.add(key);
}

export function listUncleanedEphemeralProbeFiles(ctx: AgentTurnContext): string[] {
  return [...ctx.ephemeralProbeFilesWritten].filter((p) => !ctx.ephemeralProbeFilesDeleted.has(p));
}

/** Called after an explore-only turn — increments counters and optionally tracks read files. */
export function markExploreOnlyTurn(
  ctx: AgentTurnContext,
  readArgsList: string[],
  trackConsultativeReads: boolean,
): void {
  ctx.consecutiveExploreTurns += 1;
  ctx.totalExploreTurns += 1;
  for (const path of readArgsList) {
    ctx.exploreFilesRead.add(path);
    if (trackConsultativeReads) {
      if (!ctx.toolGuard.consultativeReadPaths) ctx.toolGuard.consultativeReadPaths = [];
      if (!ctx.toolGuard.consultativeReadPaths.includes(path)) {
        ctx.toolGuard.consultativeReadPaths.push(path);
      }
    }
  }
}

/** Force-advance anchor tracking for same-issue follow-ups with no productive writes. */
export function forceAnchorOnNoProductiveWrite(ctx: AgentTurnContext): void {
  ctx.patchAnchorForcePending = true;
  ctx.patchAnchorLocated = true;
}
