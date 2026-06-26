import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  AGENT_AI_MAX_RETRIES,
  chatCompletionWithTools,
  resolveFirstByteTimeoutMs,
  type ChatCompletionMessage,
  type ChatToolCall,
  type ModelStreamProgress,
} from "./aiForward";
import {
  TextToolCallStreamFilter,
  stripTextToolCallMarkup,
} from "./textToolCalls";
import {
  AGENT_SAFETY_MAX_TURNS,
  buildAgentTurnsLowNudge,
  buildSegmentContinueNudge,
  buildTurnCapFinalSummaryNudge,
  buildTurnCapExhaustedMessage,
  extendSegmentMaxTurns,
  resolveAgentMaxTurns,
} from "./agentTurnBudget";
import {
  buildAskSystemPromptLines,
  buildSearchFilesEmptyHint,
} from "./agentAskPrompt";
import {
  buildExploreAbortPartialReportNudge,
  buildExploreContinueNudge,
  buildExploreFollowUpHint,
  buildExploreQuotedFollowUpHint,
  buildExploreSectionFillNudge,
  buildExploreChangesNudge,
} from "./agentExplorePrompt";
import {
  isExploreContinuePrompt,
  isExploreSectionFillPrompt,
  isExploreChangesPrompt,
  isKnowledgeQuoteFollowUpPrompt,
} from "../src/services/knowledgeExplore";
import { gitChangedFilesSince } from "./vibeGit";
import {
  ASK_EXPLORE_TURN_BUDGET,
  ASK_MAX_TOTAL_EXPLORE_HARD,
  ASK_MAX_TOTAL_EXPLORE_SOFT,
  buildAskExploreBudgetNudge,
  buildAskExploreSoftCapNudge,
  buildAskForceAnswerNudge,
  buildExploreExploreBudgetNudge,
  buildExploreExploreSoftCapNudge,
  buildExploreForceReportNudge,
  EXPLORE_EXPLORE_TURN_BUDGET,
  EXPLORE_MAX_TOTAL_EXPLORE_HARD,
  EXPLORE_MAX_TOTAL_EXPLORE_SOFT,
  buildConsultativeExploreBudgetNudge,
  buildConsultativeDuplicateExploreNudge,
  buildConsultativeSegmentCapNudge,
  buildExploreBudgetNudge,
  buildExploreInterimDiagnosisNudge,
  buildExploreSoftCapNudge,
  buildFileBreadthNudge,
  buildBuildExploreForcePatchNudge,
  buildForceOutputNudge,
  buildGrepEmptyRecoveryNudge,
  buildGrepHitVueReadNudge,
  buildPatchAnchorForcePatchNudge,
  buildPatchRequiredRetryNudge,
  buildImplementPasteBlockedNudge,
  buildUiDefectForcePatchNudge,
  buildUserNegationNudge,
  buildEmptyReplyRetryNudge,
  buildPrematureCompletionRetryNudge,
  buildSameIssueFollowUpForceSummaryNudge,
  buildPatchFailureCompletionRetryNudge,
  buildExplorationArchiveWriteBlockedMessage,
  buildAlternateUiPatchStrategyNudge,
  buildPostPatchVerifyNudge,
  isExplorationArchivePath,
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  EXPLORE_INTERIM_DIAGNOSIS_TURN,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
  CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET,
  isProductiveWritePath,
  MAX_READ_SLICE_REPEATS,
  MAX_UNIQUE_READ_FILES_BEFORE_NUDGE,
  PLAN_EXPLORE_TURN_BUDGET,
  PLAN_MAX_TOTAL_EXPLORE_HARD,
  PLAN_MAX_TOTAL_EXPLORE_SOFT,
} from "./agentExplorationBudget";
import {
  buildConsultativeTopicHints,
  shouldNudgeScheduledJobRegistration,
} from "../src/services/agentConsultativeTopics";
import { resolveUserIntent, classifyUserIntentFromRules, shouldSkipAiIntentClassifier, formatIntentClassificationDetail } from "../src/services/agentIntentClassifier";
import { classifyUserIntentWithAi } from "./agentIntentClassifier";
import { extractJobClassNamesFromReadPaths } from "../src/services/agentStructuralPatterns";
import { buildConsultativeBuildHint, buildAgentStepClarifyContinueHint, buildImplementFollowUpHint, buildLocateStatusFollowUpHint, buildUiDefectBuildHint, isUiAppearanceQuestionPrompt, historySuggestsQuotePositionFix } from "../src/services/agentUserIntent";
import { detectProjectRuntimeProfile } from "./agentRuntimeHint";
import { detectUserNegation, stripQuotedReplyPrefix } from "../src/services/agentContinuation";
import { resolveAgentRunPolicy } from "./agentRunPolicy";
import {
  buildBlockedGrepAfterLocateMessage,
  buildEnglishPlanningNudge,
  buildLowSignalVisionLocateGrepMessage,
  buildOverlyBroadVisionGrepMessage,
  buildPatchAnchorLocatedNudge,
  buildSearchFilesContentQueryMessage,
  checkOverlappingRead,
  checkPatchOldStringFromReads,
  claimsPrematureCompletion,
  claimsSuccessDespitePatchFailures,
  shouldNudgeAlternateUiPatchStrategy,
  invalidateFileReadState,
  markPatchRecoveryFile,
  consumePatchRecoveryRead,
  isEmptyOrInsufficientFinalReply,
  isToolResultFailure,
  isAnalysisOnlyReplyUnderForcePatch,
  isBlockedGrepAfterLocate,
  isBlockedGrepAfterVisionMisread,
  isLowSignalVisionLocateGrep,
  isOverlyBroadVisionGrep,
  isSearchFilesContentQuery,
  isVisionGrepLowSpread,
  readLineRangeFromArgs,
  recordReadRange,
  sanitizeAgentUserVisibleText,
  shouldForcePatchAfterAnchorLocated,
  shouldNudgeEnglishPlanning,
  textConfirmsTeleportToBody,
  textIndicatesPatchAnchor,
  type ToolGuardContext,
} from "./agentExploreGuard";
import {
  normalizeRunProfile,
  type AgentRunProfileInput,
} from "./agentRunProfile";
import {
  buildInjectedKeyFilePathSet,
  formatInjectedKeyFileReadNudge,
  invalidateProjectContextCache,
} from "./vibeProjectContext";
import {
  isProjectMemorySection,
} from "./vibeProjectMemory";
import { buildMemoryProposalToolResult } from "./projectMemoryProposal";
import { buildSkillProposalToolResult } from "./projectSkillProposal";
import {
  listProjectSkills,
  readProjectSkill,
} from "./vibeProjectSkills";
import {
  applyUniquePatch,
  grepInProject,
  listDirectory,
  readFileContent,
  resolveProjectPath,
  resolveReadablePath,
  searchFiles,
  sliceFileLines,
  writeFileContent,
  type RunExtractOutcome,
} from "./vibeFs";
import { runWebExtract, runWebSearch } from "./webExtract";
import {
  buildConsultativeUiAppearanceHint,
  buildConsultativeAppearanceAnswerAfterReadHint,
  buildConsultativeUiAppearanceRetryHint,
  buildConsultativeVisibleShellEmptyInnerHint,
  buildUnreconciledEmptyShellRetryHint,
  buildVisionConsultativeContinueHint,
  buildVisionConsultativeLocateRetryHint,
  buildVisionBuildContinueHint,
  buildVisionFirstTurnPrematureCompletionRetryHint,
  buildVisionFirstTurnRetryHint,
  buildVisionUserContent,
  extractVisibleAnchorQuotes,
  isAdequateVisionFirstTurnDescription,
  isPrematureVisionCompletionClaim,
  isVisionUnsupportedError,
  sanitizeImageDataUrls,
  shouldBlockConsultativeVisionLocateFinalize,
  shouldBypassVisionFirstTurn,
  shouldRequireVisionFirstTurn,
  shouldRunVisionAnchorPrefgrep,
  consultativeAppearanceNeedsVueRead,
  isSpeculativeStyleAnswer,
  isUnreconciledEmptyShellAnswer,
  suggestsEmbeddedLayoutMisread,
  suggestsVisibleShellEmptyInner,
} from "./visionMessage";
import {
  appendVisionAnchorPrefgrepMessages,
  buildVisionConsultativeReadAfterPrefgrepHint,
} from "./visionAnchorPrefgrep";
import {
  buildConsultativeAccuracyTraceHint,
  buildConsultativeAccuracyTraceRetryHint,
  shouldBlockConsultativeAccuracyFinalize,
} from "./consultativeAccuracyTrace";
import {
  buildBehaviorPurposeTraceRetryHint,
  shouldBlockBehaviorPurposeFinalize,
} from "./consultativeBehaviorTrace";
import { buildAgentContext, resolveOpenFileInProject } from "./agentContextBuilder";
import type { VibeAgentEvent, VibeChatMode, VibeChatHistoryMessage } from "../shared/agentTypes";
import {
  VIBE_AGENT_TOOLS,
  READ_ONLY_AGENT_TOOLS,
  READ_ONLY_AGENT_TOOL_NAMES,
  WRITE_AGENT_TOOL_NAMES,
  isSubstantiveChineseToolPreamble,
  canParallelizeToolBatch,
  callIsProductiveWrite,
  buildDoneData,
  parseToolArgs,
  resolveToolCallsFromAssistant,
  toolSummary,
} from "./agentClassifier";
import {
  compactMessagesForModel,
  buildHistoryMessages,
  historyForDisplay,
  messagesForTurnDisplay,
  formatCharCount,
  formatElapsedMs,
  emitAgentContext,
  truncateForSse,
  truncateToolResultForModel,
  messageCharSize,
  MAX_TOOL_RESULT_SSE_CHARS,
} from "./agentContext";
import {
  streamProgressDetail,
  streamProgressPhase,
  emitUserVisibleAssistantMessage,
} from "./agentStream";

export type { VibeAgentEvent, VibeChatMode, VibeChatHistoryMessage } from "../shared/agentTypes";

export interface RunVibeAgentParams {
  projectRoot: string;
  prompt: string;
  history?: VibeChatHistoryMessage[];
  openFilePath?: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  mode?: VibeChatMode;
  maxTurns?: number;
  imageDataUrls?: string[];
  /** HTTP 代理，用于 Agent 联网搜索/抓取（与 AI 配置「网页抓取代理」一致） */
  webProxyUrl?: string;
  /** Run orchestration profile (interactive vs plan execution). */
  runProfile?: AgentRunProfileInput;
  /** @deprecated Use runProfile.kind === "execute_plan" */
  executionMode?: boolean;
  onEvent: (event: VibeAgentEvent) => void;
  signal?: AbortSignal;
}

export {
  MAX_AGENT_CONTEXT_CHARS,
  EXECUTE_PLAN_MAX_CONTEXT_CHARS,
  ASK_MAX_CONTEXT_CHARS,
  CONSULTATIVE_UI_APPEARANCE_MAX_CONTEXT_CHARS,
  PLAN_MAX_CONTEXT_CHARS,
} from "./agentRunPolicy";

export { createWriteStage, executeTool, trackWrittenFile, readStagedFileContent, isAgentsGuideOnlyPath, recordGrepHitVueFiles, requirePriorRead, type WriteStage } from "./agentToolExecutor";
import { createWriteStage, executeTool, trackWrittenFile, readStagedFileContent, isAgentsGuideOnlyPath, recordGrepHitVueFiles, requirePriorRead, type WriteStage } from "./agentToolExecutor";

export async function runVibeAgent(params: RunVibeAgentParams): Promise<void> {
  const mode = params.mode || "build";
  const isAsk = mode === "ask";
  const isExplore = mode === "explore";
  const isReadOnlyAgent = isAsk || isExplore;
  const runProfile = normalizeRunProfile(
    params.runProfile ||
      (params.executionMode
        ? { kind: "execute_plan", targetFiles: params.runProfile?.targetFiles }
        : undefined),
  );
  const isExecutePlan = !isReadOnlyAgent && runProfile.kind === "execute_plan";
  const isPlanExplore = mode === "plan" && !isExecutePlan;
  const toolMode: VibeChatMode = isExecutePlan ? "build" : mode;
  const nudgeMode = isExecutePlan && mode === "plan" ? "build" : mode;
  const {
    projectRoot,
    prompt,
    openFilePath,
    endpoint,
    apiKey,
    model,
    onEvent,
    signal,
    webProxyUrl,
  } = params;
  const imageDataUrls = sanitizeImageDataUrls(params.imageDataUrls);
  const rulesIntent = classifyUserIntentFromRules({
    prompt,
    history: params.history,
    mode,
    hasImage: imageDataUrls.length > 0,
    isAsk: isAsk || isExplore,
  });
  const skipAiClassifier = shouldSkipAiIntentClassifier(rulesIntent, prompt, { isAsk: isReadOnlyAgent });

  onEvent({
    type: "status",
    data: {
      phase: "classifying_intent",
      model,
      detail: skipAiClassifier ? "规则高置信，跳过 AI 分类" : "正在识别用户意图…",
    },
  });
  const aiIntentPayload = skipAiClassifier
    ? null
    : await classifyUserIntentWithAi({
        prompt,
        history: params.history,
        mode,
        hasImage: imageDataUrls.length > 0,
        endpoint,
        apiKey,
        model,
        projectRoot,
        signal,
      });
  const userIntent = resolveUserIntent({
    prompt,
    history: params.history,
    mode,
    hasImage: imageDataUrls.length > 0,
    isAsk: isAsk || isExplore,
    ai: aiIntentPayload,
  });
  if (skipAiClassifier) {
    userIntent.skippedAiClassifier = true;
  }
  onEvent({
    type: "status",
    data: {
      phase: "intent_classified",
      model,
      detail: formatIntentClassificationDetail(userIntent),
    },
  });

  const runPolicy = resolveAgentRunPolicy({
    prompt,
    mode,
    history: params.history,
    userIntent,
    runProfile,
    hasImage: imageDataUrls.length > 0,
    isExecutePlan,
    isPlanExplore,
  });
  const {
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
    exploreHardCap,
    exploreSoftCap,
    maxContextChars,
    effectiveTaskPrompt,
    resumeOriginalTask,
    userRecentlyReportedFailure,
  } = runPolicy;

  const segmentBudget = resolveAgentMaxTurns(
    mode,
    runProfile,
    isExplore ? params.maxTurns : undefined,
  );
  let segmentMaxTurns = params.maxTurns ?? segmentBudget;
  let segmentIndex = 1;
  const exploreTurnBudget = isExplore
    ? EXPLORE_EXPLORE_TURN_BUDGET
    : isExecutePlan
      ? EXECUTE_PLAN_EXPLORE_TURN_BUDGET
      : isPlanExplore
        ? PLAN_EXPLORE_TURN_BUDGET
        : INTERACTIVE_EXPLORE_TURN_BUDGET;

  const openFile = resolveOpenFileInProject(projectRoot, openFilePath);
  const openFileRel = openFile?.relative;

  onEvent({
    type: "status",
    data: {
      phase: "preparing",
      ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
      model,
      ...(openFileRel ? { openFile: openFileRel } : {}),
    },
  });

  const ctx = await buildAgentContext({
    projectRoot,
    openFilePath,
    prompt,
    model,
    mode,
    history: params.history,
    isAsk,
    isExplore,
    isExecutePlan,
    isPlanExplore,
    readOnlyBuildRun,
    consultativeUiAppearanceRun,
    codeReviewRun,
    userErrorQuoteRun,
    userFailureReportRun,
    uiDefectBuildRun,
    implementFollowUpRun,
    sameIssueFollowUpRun,
    locateStatusFollowUpRun,
    ultraShortOpenTaskRun,
    effectiveTaskPrompt,
    userRecentlyReportedFailure,
    runProfile,
  }, onEvent);

  const {
    systemPrompt,
    projectContextBlock,
    agentsGuideBlock,
    projectSkillsBlock,
    projectMemoryBlock,
    projectKnowledgeBlock,
    exploreKnowledgeContextBlock,
    explorationArchiveBlock,
    openFileSnippet,
    injectedKeyFilePaths,
    exploreKnowledgeIntent,
    exploreUsesManifest,
  } = ctx;

  const writeStage = isReadOnlyAgent || isPlanExplore || readOnlyBuildRun ? null : createWriteStage();
  const readCache = new Map<string, string>();
  const readSliceCache = new Map<string, string>();
  const readSliceRepeatCounts = new Map<string, number>();
  const grepCache = new Map<string, string>();
  const toolGuard: ToolGuardContext = {
    readFileRanges: new Map(),
    patchRecoveryFiles: new Set(),
    visionMisreadActive: false,
    patchAnchorLocated: false,
    teleportBodyConfirmed: false,
    visionAnchorQuotes: [],
    visionLocateActive: false,
    consultativeReadPaths: [],
    blockExplorationArchiveWrite:
      sameIssueFollowUpRun && (userFailureReportRun || userRecentlyReportedFailure),
  };
  let consecutiveExploreTurns = 0;
  let totalExploreTurns = 0;
  let turnsLowNudgeSent = false;
  let interimDiagnosisNudgeSent = false;
  let patchAnchorLocated = false;
  let teleportBodyConfirmed = false;
  let patchAnchorNudgeSent = false;
  let patchAnchorForcePending = implementFollowUpRun;
  let englishPlanningNudgeSent = false;
  let uiDefectForcePatchNudgeSent = false;
  let patchAnchorForcePatchNudgeSent = false;
  let buildExploreForcePatchNudgeSent = false;
  let scheduledJobRegistrationNudgeSent = false;
  let agentStepClarifyPending = agentStepClarifyRun;
  /** Track patch_file failures per turn for corrective nudges and final summary audit. */
  const patchFailureLog: Array<{ turn: number; path: string; reason: string }> = [];
  /** Track unique files read in explore-only turns to detect breadth sprawl. */
  const exploreFilesRead = new Set<string>();
  let exploreAbortGraceTurnActive = false;
  let fileBreadthNudgeSent = false;
  /** Track consecutive user negations to detect dissatisfaction patterns. */
  let consecutiveUserNegations = 0;
  let emptyReplyRetries = 0;
  let prematureCompletionRetries = 0;
  let patchFailureCompletionRetries = 0;
  const MAX_EMPTY_REPLY_RETRIES = 2;
  const MAX_PREMATURE_COMPLETION_RETRIES = 1;
  const MAX_PATCH_FAILURE_COMPLETION_RETRIES = 1;
  let negationNudgeSent = false;
  let postPatchVerifyNudgeSent = false;
  let turnCapFinalSummaryAttempts = 0;
  const activeTools = isReadOnlyAgent || isPlanExplore || readOnlyBuildRun ? READ_ONLY_AGENT_TOOLS : VIBE_AGENT_TOOLS;
  const userContent = buildVisionUserContent(prompt, imageDataUrls);
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: systemPrompt },
    ...buildHistoryMessages(params.history),
    { role: "user", content: userContent },
  ];
  if (isExplore) {
    if (isExploreContinuePrompt(prompt)) {
      messages.push({ role: "system", content: buildExploreContinueNudge() });
    } else if (isExploreSectionFillPrompt(prompt)) {
      messages.push({ role: "system", content: buildExploreSectionFillNudge() });
    } else if (isExploreChangesPrompt(prompt)) {
      messages.push({ role: "system", content: buildExploreChangesNudge() });
    } else if (exploreKnowledgeIntent === "followup") {
      messages.push({
        role: "system",
        content: isKnowledgeQuoteFollowUpPrompt(prompt)
          ? buildExploreQuotedFollowUpHint()
          : buildExploreFollowUpHint(),
      });
    }
  }
  let visionFallbackApplied = false;
  let consultativeForceAnswerPending = locateStatusFollowUpRun;
  let lastConsultativeExploreSig = "";
  let consultativeDuplicateExploreHits = 0;
  if (readOnlyBuildRun && consultativeVisionRun && segmentMaxTurns !== undefined) {
    segmentMaxTurns = Math.min(segmentMaxTurns, 6);
  }
  const visionLocateSingleTurnRun = shouldBypassVisionFirstTurn({
    imageCount: imageDataUrls.length,
    consultativeVisionRun,
    prompt,
  });
  if (visionLocateSingleTurnRun) {
    toolGuard.visionLocateActive = true;
  }
  if (visionLocateSingleTurnRun && accuracyConsultativeRun) {
    messages.push({ role: "system", content: buildConsultativeAccuracyTraceHint() });
  }
  if (visionLocateSingleTurnRun && isUiAppearanceQuestionPrompt(prompt)) {
    messages.push({ role: "system", content: buildConsultativeUiAppearanceHint() });
  }
  let visionFirstTurnPending = shouldRequireVisionFirstTurn(
    imageDataUrls.length,
    false,
    visionLocateSingleTurnRun,
  );
  let visionFirstTurnRetries = 0;
  let visionFirstTurnDescriptionText = "";
  let visionLocateToolsUsed = false;
  let visionLocateReadUsed = false;
  let visionAutoGrepHadMatches = false;
  let pregrepUniqueFiles: string[] = [];
  let visionConsultativeLocateRetries = 0;
  let visionConsultativeAccuracyRetries = 0;
  let behaviorPurposeRetries = 0;
  const MAX_BEHAVIOR_PURPOSE_RETRIES = 2;
  const MAX_VISION_FIRST_TURN_RETRIES = 2;
  const MAX_VISION_CONSULTATIVE_LOCATE_RETRIES = 2;
  const MAX_VISION_CONSULTATIVE_ACCURACY_RETRIES = 2;
  const MAX_TRUNCATION_RETRIES = 5;
  let truncationRetryCount = 0;
  let outputTruncated = false;

  emitAgentContext(onEvent, {
    mode,
    systemPrompt,
    history: historyForDisplay(params.history),
    projectContext: [projectContextBlock, agentsGuideBlock, projectSkillsBlock, projectMemoryBlock]
      .filter(Boolean)
      .join("") || undefined,
    ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
    model,
    ...(openFileRel ? { openFile: openFileRel } : {}),
  });

  if (signal?.aborted) {
    if (!isExplore) {
      onEvent({ type: "status", data: { phase: "aborted" } });
      onEvent({ type: "done", data: buildDoneData(writeStage, 0) });
      return;
    }
    onEvent({
      type: "status",
      data: { phase: "aborted", detail: "正在整理不完整知识库…", model },
    });
  }

  onEvent({ type: "status", data: { phase: "building_context", model, detail: "上下文就绪，开始运行" } });

  for (let turn = 1; ; turn += 1) {
    if (turn > AGENT_SAFETY_MAX_TURNS) {
      onEvent({
        type: "status",
        data: { phase: "finished", turn: AGENT_SAFETY_MAX_TURNS, maxTurns: AGENT_SAFETY_MAX_TURNS },
      });
      onEvent({
        type: "error",
        data: { message: `已达安全上限（${AGENT_SAFETY_MAX_TURNS} 轮），任务可能未完成。` },
      });
      onEvent({ type: "done", data: buildDoneData(writeStage, AGENT_SAFETY_MAX_TURNS) });
      return;
    }

    if (signal?.aborted) {
      if (isExplore && !exploreAbortGraceTurnActive) {
        exploreAbortGraceTurnActive = true;
        onEvent({
          type: "status",
          data: {
            phase: "aborted",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "正在整理不完整知识库…",
          },
        });
        segmentMaxTurns = Math.max(segmentMaxTurns ?? 0, turn + 1);
      } else {
        onEvent({
          type: "status",
          data: {
            phase: "aborted",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          },
        });
        onEvent({ type: "done", data: buildDoneData(writeStage, turn - 1) });
        return;
      }
    }

    if (
      !isReadOnlyAgent &&
      !readOnlyBuildRun &&
      segmentMaxTurns !== undefined &&
      !turnsLowNudgeSent &&
      turn >= segmentMaxTurns - 3
    ) {
      messages.push({
        role: "system",
        content: buildAgentTurnsLowNudge(turn, segmentMaxTurns, nudgeMode, isExecutePlan && mode === "plan"),
      });
      turnsLowNudgeSent = true;
    }

    // User negation detection: track consecutive dissatisfaction and inject direction-switch nudge.
    if (!isReadOnlyAgent && !isPlanExplore && prompt && detectUserNegation(prompt)) {
      consecutiveUserNegations += 1;
    } else if (prompt) {
      // Reset negation count when user sends a non-negation message (e.g., confirming a direction).
      consecutiveUserNegations = 0;
      negationNudgeSent = false;
    }
    if (
      !negationNudgeSent &&
      consecutiveUserNegations >= 2 &&
      !isReadOnlyAgent &&
      !isPlanExplore &&
      !readOnlyBuildRun
    ) {
      messages.push({
        role: "system",
        content: buildUserNegationNudge(consecutiveUserNegations),
      });
      negationNudgeSent = true;
    }

    toolGuard.patchAnchorLocated = patchAnchorLocated;
    toolGuard.teleportBodyConfirmed = teleportBodyConfirmed;

    // Progressive exploration restriction:
    //   Soft cap: strip grep/search_files — model can still read_file
    //   Hard cap: strip ALL tools — model must output text only
    //   UI defect + located anchor: hard cap keeps write tools (avoid analysis-only stall)
    const buildExploreHardCapReached =
      !isReadOnlyAgent && !isPlanExplore && !readOnlyBuildRun && totalExploreTurns >= exploreHardCap;
    const sameIssueFollowUpNeedsSummary =
      sameIssueFollowUpRun &&
      buildExploreHardCapReached &&
      writeStage !== null &&
      !writeStage.writtenList.some((p) => isProductiveWritePath(p));
    const forcePatchOutput =
      !sameIssueFollowUpNeedsSummary &&
      !isReadOnlyAgent &&
      !isPlanExplore &&
      !readOnlyBuildRun &&
      writeStage !== null &&
      (buildExploreHardCapReached ||
        shouldForcePatchAfterAnchorLocated(
          patchAnchorLocated,
          patchAnchorForcePending,
          buildExploreHardCapReached,
          implementFollowUpRun,
        ));
    const forceTextOutput =
      !forcePatchOutput &&
      (sameIssueFollowUpNeedsSummary ||
        (isExplore && exploreAbortGraceTurnActive) ||
        (isExplore && totalExploreTurns >= EXPLORE_MAX_TOTAL_EXPLORE_HARD) ||
        (isAsk && totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_HARD) ||
        (isPlanExplore && totalExploreTurns >= PLAN_MAX_TOTAL_EXPLORE_HARD) ||
        (readOnlyBuildRun && totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_HARD));
    const stripWideSearch =
      !forceTextOutput &&
      !forcePatchOutput &&
      ((isExplore && totalExploreTurns >= EXPLORE_MAX_TOTAL_EXPLORE_SOFT) ||
        (isAsk && totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_SOFT) ||
        (isPlanExplore && totalExploreTurns >= PLAN_MAX_TOTAL_EXPLORE_SOFT) ||
        (readOnlyBuildRun && totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_SOFT) ||
        (!isReadOnlyAgent && !isPlanExplore && !readOnlyBuildRun && totalExploreTurns >= exploreSoftCap));

    if (forcePatchOutput && !uiDefectForcePatchNudgeSent && buildExploreHardCapReached && uiDefectBuildRun) {
      messages.push({
        role: "system",
        content: buildUiDefectForcePatchNudge(totalExploreTurns),
      });
      uiDefectForcePatchNudgeSent = true;
    } else if (
      forcePatchOutput &&
      buildExploreHardCapReached &&
      !buildExploreForcePatchNudgeSent &&
      !uiDefectBuildRun &&
      !patchAnchorForcePending
    ) {
      messages.push({
        role: "system",
        content: buildBuildExploreForcePatchNudge(totalExploreTurns),
      });
      buildExploreForcePatchNudgeSent = true;
    } else if (forcePatchOutput && patchAnchorForcePending && !patchAnchorForcePatchNudgeSent) {
      messages.push({
        role: "system",
        content: buildPatchAnchorForcePatchNudge(),
      });
      patchAnchorForcePatchNudgeSent = true;
    } else if (forceTextOutput) {
      messages.push({
        role: "system",
        content: sameIssueFollowUpNeedsSummary
          ? buildSameIssueFollowUpForceSummaryNudge(totalExploreTurns)
          : isExplore
            ? exploreAbortGraceTurnActive
              ? buildExploreAbortPartialReportNudge(exploreFilesRead.size)
              : buildExploreForceReportNudge(totalExploreTurns)
            : isReadOnlyAgent || readOnlyBuildRun
              ? buildAskForceAnswerNudge(totalExploreTurns)
              : buildForceOutputNudge(totalExploreTurns, mode),
      });
    } else if (stripWideSearch) {
      messages.push({
        role: "system",
        content:
          isExplore
            ? buildExploreExploreSoftCapNudge(totalExploreTurns)
            : isReadOnlyAgent || readOnlyBuildRun
              ? buildAskExploreSoftCapNudge(totalExploreTurns)
              : buildExploreSoftCapNudge(totalExploreTurns, mode),
      });
    }

    if (!fileBreadthNudgeSent && exploreFilesRead.size >= MAX_UNIQUE_READ_FILES_BEFORE_NUDGE) {
      const files = Array.from(exploreFilesRead);
      messages.push({ role: "system", content: buildFileBreadthNudge(files, mode) });
      fileBreadthNudgeSent = true;
    }

    if (
      !interimDiagnosisNudgeSent &&
      !isReadOnlyAgent &&
      !isPlanExplore &&
      writeStage !== null &&
      totalExploreTurns >= EXPLORE_INTERIM_DIAGNOSIS_TURN
    ) {
      messages.push({ role: "system", content: buildExploreInterimDiagnosisNudge(totalExploreTurns) });
      interimDiagnosisNudgeSent = true;
    }

    onEvent({
      type: "status",
      data: {
        phase: visionFirstTurnPending ? "vision_first_turn" : "waiting_model",
        turn,
        ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        model,
        ...(visionFirstTurnPending
          ? { detail: "先查看附图并描述所见（本轮不调用工具）" }
          : {}),
      },
    });

    const toolsForTurn = (() => {
      if (visionFirstTurnPending || forceTextOutput || consultativeForceAnswerPending) return [];
      if (agentStepClarifyPending) return [];
      if (forcePatchOutput) {
        return activeTools.filter((t) => WRITE_AGENT_TOOL_NAMES.has(t.function.name));
      }
      if (stripWideSearch) {
        // Keep only read_file (and list_dir); remove grep / search_files / run_command / web_*
        return activeTools.filter(
          (t) => !["grep", "search_files", "run_command", "web_search", "web_extract"].includes(t.function.name),
        );
      }
      return activeTools;
    })();

    let streamedChars = 0;
    const streamFilter = new TextToolCallStreamFilter();
    let modelStatusPhase: "waiting_model" | "retrying_model" | "sending_request" | "streaming_model" | "planning_tools" =
      "waiting_model";
    const modelWaitStartedAt = Date.now();
    const heartbeat = setInterval(() => {
      if (signal?.aborted) return;
      if (modelStatusPhase === "streaming_model" || modelStatusPhase === "planning_tools") return;
      onEvent({
        type: "status",
        data: {
          phase: modelStatusPhase,
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          model,
          detail: `已等待 ${formatElapsedMs(Date.now() - modelWaitStartedAt)}`,
          elapsedMs: Date.now() - modelWaitStartedAt,
        },
      });
    }, 2000);
    const compactedMessages = compactMessagesForModel(messages, maxContextChars);
    const contextChars = compactedMessages.reduce((sum, message) => sum + messageCharSize(message), 0);
    onEvent({
      type: "status",
      data: {
        phase: "compacting_context",
        turn,
        ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        model,
        detail: `${compactedMessages.length} 条消息 · ${formatCharCount(contextChars)} 上下文`,
        contextMessages: compactedMessages.length,
        contextChars,
      },
    });
    onEvent({
      type: "turn_request",
      data: {
        turn,
        ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        model,
        contextMessages: compactedMessages.length,
        contextChars,
        messages: messagesForTurnDisplay(compactedMessages),
      },
    });
    let completion: Awaited<ReturnType<typeof chatCompletionWithTools>>;
    onEvent({ type: "status", data: { phase: "waiting_model", turn, model, detail: `第 ${turn} 轮：等待模型响应` } });
    try {
      completion = await chatCompletionWithTools({
        endpoint,
        apiKey,
        model,
        messages: compactedMessages,
        tools: toolsForTurn,
        signal,
        maxRetries: AGENT_AI_MAX_RETRIES,
        firstByteTimeoutMs: resolveFirstByteTimeoutMs(contextChars),
        onStreamProgress: (progress) => {
          modelStatusPhase = streamProgressPhase(progress) as typeof modelStatusPhase;
          onEvent({
            type: "status",
            data: {
              phase: modelStatusPhase,
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
              detail: streamProgressDetail(progress),
              streamChars: progress.streamChars,
              streamChunks: progress.streamChunks,
              toolCallCount: progress.toolCallCount,
              elapsedMs: progress.elapsedMs,
              contextMessages: compactedMessages.length,
              contextChars,
            },
          });
        },
        onContentDelta: (delta) => {
          const userDelta = streamFilter.push(delta);
          if (userDelta) {
            streamedChars += userDelta.length;
            onEvent({ type: "message_delta", data: { delta: userDelta } });
          }
        },
        onAttemptStart: () => {
          modelStatusPhase = "waiting_model";
          onEvent({
            type: "status",
            data: {
              phase: "waiting_model",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
            },
          });
        },
        onRetry: ({ attempt, maxAttempts, error }) => {
          modelStatusPhase = "retrying_model";
          onEvent({
            type: "status",
            data: {
              phase: "retrying_model",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
              retryAttempt: attempt,
              retryMaxAttempts: maxAttempts,
              retryError: error,
            },
          });
        },
      });
    } finally {
      clearInterval(heartbeat);
    }

    if (!completion.ok || !completion.message) {
      if (
        !visionFallbackApplied &&
        imageDataUrls.length > 0 &&
        isVisionUnsupportedError(completion.error)
      ) {
        visionFallbackApplied = true;
        visionFirstTurnPending = false;
        const userIndex = messages.findIndex((message) => message.role === "user");
        if (userIndex >= 0) {
          messages[userIndex] = {
            role: "user",
            content: `${prompt}\n\n（注：当前模型不支持图片输入，已忽略 ${imageDataUrls.length} 张附带图片，请仅根据文字继续。）`,
          };
        }
        onEvent({
          type: "status",
          data: {
            phase: "vision_fallback",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "当前模型不支持视觉输入，已降级为纯文本请求",
          },
        });
        turn -= 1;
        continue;
      }
      onEvent({ type: "error", data: { message: completion.error || "模型请求失败" } });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn) });
      return;
    }

    // --- 检测模型输出被截断（finish_reason === "length"）---
    if (
      completion.finish_reason === "length" &&
      !completion.message.tool_calls?.length
    ) {
      if (truncationRetryCount < MAX_TRUNCATION_RETRIES) {
        truncationRetryCount += 1;
        onEvent({
          type: "status",
          data: {
            phase: "streaming_model",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: `内容较长，正在自动补充完成（第 ${truncationRetryCount}/${MAX_TRUNCATION_RETRIES} 次）…`,
          },
        });
        // 将已截断的内容作为 assistant 消息推入上下文，让模型继续
        const truncatedText = String(completion.message.content || "");
        if (truncatedText.trim()) {
          messages.push({ role: "assistant", content: truncatedText });
          // 根据截断内容的上下文给出更精准的续跑提示
          const hasToolCalls = truncatedText.includes("patch_file") || truncatedText.includes("write_file") || truncatedText.includes("read_file") || truncatedText.includes("grep") || truncatedText.includes("search_files");
          const hasPartialCode = truncatedText.includes("```") && !truncatedText.match(/```\s*$/m);
          let continueHint: string;
          if (hasToolCalls && !hasPartialCode) {
            // 工具调用已完成，但文本总结被截断 → 提示总结剩余部分
            continueHint = readOnlyBuildRun
              ? "你的上一次回复因内容较多被截断。只读工具结果已有，请勿重复 grep/read 或调用写工具；直接完成剩余分析与结论。"
              : "你的上一次回复因内容较多被截断，之前的工具调用已成功执行，无需重复。" +
                "请继续完成剩余的分析和总结；如果任务已完成，直接输出简短结论即可。";
          } else if (hasPartialCode) {
            // 代码块写到一半被截断 → 提示补完代码块
            continueHint =
              "你的上一次回复因内容较多被截断，你正在写入代码/内容。" +
              "请从截断处继续完成当前代码块，不要重新开始。";
          } else {
            // 纯文本回复被截断
            continueHint =
              "你的上一次回复因内容较多被截断。" +
              "请从被截断的地方继续，不要重复已输出的内容。" +
              "如果任务已完成，直接输出简短结论即可。";
          }
          messages.push({
            role: "user",
            content: continueHint,
          });
        }
        continue;
      }
      // 达到最大重试次数 → 标记输出截断，交由客户端续跑
      outputTruncated = true;
      // 不再将截断提示追加到消息上下文（避免浪费 token / 混淆模型）；
      // 客户端会通过 done 事件的 truncated 标志自行处理续跑和 UI 展示
    }

    const assistant = completion.message;
    const rawContent = String(assistant.content || "");
    const toolCalls = resolveToolCallsFromAssistant(rawContent, assistant.tool_calls || []);
    const visibleContent = stripTextToolCallMarkup(rawContent);

    const completeVisionFirstTurn = (text: string, isFinalTurn: boolean) => {
      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          assistantText: text,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: isFinalTurn,
        },
      });
      if (text && !streamedChars) {
        emitUserVisibleAssistantMessage(onEvent, text, streamedChars);
      }
      messages.push({ role: "assistant", content: text });
    };

    if (visionFirstTurnPending) {
      const text = visibleContent.trim();
      if (toolCalls.length) {
        onEvent({
          type: "turn_trace",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: text || "（模型试图在附图首轮调用工具，已忽略）",
            hasToolCalls: false,
          },
        });
      }
      if (!isAdequateVisionFirstTurnDescription(text)) {
        visionFirstTurnRetries += 1;
        if (text) {
          messages.push({ role: "assistant", content: text });
        }
        if (visionFirstTurnRetries > MAX_VISION_FIRST_TURN_RETRIES) {
          visionFirstTurnPending = false;
          messages.push({
            role: "system",
            content:
              "【读图轮次结束】模型未能充分描述附图，已跳过强制读图轮次。请结合用户文字与附图继续完成任务。",
          });
          onEvent({
            type: "status",
            data: {
              phase: "vision_first_turn_skipped",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
            },
          });
          continue;
        }
        messages.push({
          role: "system",
          content: isPrematureVisionCompletionClaim(text)
            ? buildVisionFirstTurnPrematureCompletionRetryHint()
            : buildVisionFirstTurnRetryHint(),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: text,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        if (text && !streamedChars) {
          emitUserVisibleAssistantMessage(onEvent, text, streamedChars);
        }
        continue;
      }

      visionFirstTurnPending = false;
      visionFirstTurnDescriptionText = text;
      completeVisionFirstTurn(text, false);
      toolGuard.visionMisreadActive = suggestsEmbeddedLayoutMisread(text);
      toolGuard.visionAnchorQuotes = extractVisibleAnchorQuotes(text);
      toolGuard.visionNarrativeText = text;
      toolGuard.visionLocateActive = toolGuard.visionAnchorQuotes.length > 0 || imageDataUrls.length > 0;
      if (consultativeVisionRun) {
        if (isUiAppearanceQuestionPrompt(prompt)) {
          messages.push({ role: "system", content: buildConsultativeUiAppearanceHint() });
        }
        if (
          shouldRunVisionAnchorPrefgrep({
            consultativeVisionRun,
            prompt,
            anchorQuotes: toolGuard.visionAnchorQuotes,
          })
        ) {
          onEvent({
            type: "status",
            data: {
              phase: "vision_anchor_prefgrep",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
              detail: "读图完成，正在按锚点搜索源码…",
            },
          });
          const pregrep = await appendVisionAnchorPrefgrepMessages(
            projectRoot,
            toolGuard.visionAnchorQuotes,
            messages,
          );
          pregrepUniqueFiles = pregrep.uniqueFiles;
          if (pregrep.hadMatches) {
            visionAutoGrepHadMatches = true;
            visionLocateToolsUsed = true;
          }
        } else {
          messages.push({ role: "system", content: buildVisionConsultativeContinueHint() });
        }
        if (suggestsVisibleShellEmptyInner(text)) {
          messages.push({ role: "system", content: buildConsultativeVisibleShellEmptyInnerHint() });
        }
        if (accuracyConsultativeRun) {
          messages.push({ role: "system", content: buildConsultativeAccuracyTraceHint() });
        }
        if (segmentMaxTurns !== undefined && !accuracyConsultativeRun) {
          segmentMaxTurns = Math.min(segmentMaxTurns, turn + 4);
        }
      } else {
        messages.push({ role: "system", content: buildVisionBuildContinueHint(text, prompt) });
      }
      onEvent({
        type: "status",
        data: {
          phase: "vision_first_turn_done",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          model,
          detail: consultativeVisionRun ? "读图描述完成，准备简要核对后回答" : "读图描述完成，开始定位与修改",
        },
      });
      continue;
    }

    if (!toolCalls.length) {
      const rawText = visibleContent.trim();
      const userText = sanitizeAgentUserVisibleText(rawText);
      const mustPatchBeforeFinish =
        writeStage !== null &&
        !isReadOnlyAgent &&
        !isPlanExplore &&
        !readOnlyBuildRun &&
        writeStage.writtenList.length === 0 &&
        (implementFollowUpRun || (patchAnchorLocated && patchAnchorForcePending));

      if (agentStepClarifyPending) {
        agentStepClarifyPending = false;
        messages.push({ role: "assistant", content: rawText });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        emitUserVisibleAssistantMessage(onEvent, rawText, streamedChars);
        if (uiDefectBuildRun || patchAnchorLocated || patchAnchorForcePending) {
          messages.push({ role: "system", content: buildAgentStepClarifyContinueHint() });
          onEvent({
            type: "status",
            data: {
              phase: "clarify_continue",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
              detail: "已向用户解释，继续修复",
            },
          });
          continue;
        }
      }

      if (mustPatchBeforeFinish && isAnalysisOnlyReplyUnderForcePatch(rawText)) {
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content: implementFollowUpRun ? buildImplementPasteBlockedNudge() : buildPatchRequiredRetryNudge(),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        patchAnchorForcePending = true;
        patchAnchorForcePatchNudgeSent = false;
        onEvent({
          type: "status",
          data: {
            phase: "patch_required_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "须先提交代码修改，已要求重试",
          },
        });
        continue;
      }

      if (
        isEmptyOrInsufficientFinalReply(rawText) &&
        emptyReplyRetries < MAX_EMPTY_REPLY_RETRIES
      ) {
        emptyReplyRetries += 1;
        messages.push({ role: "assistant", content: rawText || "(empty)" });
        messages.push({ role: "system", content: buildEmptyReplyRetryNudge() });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "empty_reply_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "空回复，已要求输出有效正文",
          },
        });
        continue;
      }

      if (
        claimsPrematureCompletion(rawText) &&
        prematureCompletionRetries < MAX_PREMATURE_COMPLETION_RETRIES &&
        (userRecentlyReportedFailure ||
          codeReviewRun ||
          userFailureReportRun ||
          sameIssueFollowUpRun)
      ) {
        prematureCompletionRetries += 1;
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content: buildPrematureCompletionRetryNudge(userRecentlyReportedFailure || userFailureReportRun),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "premature_completion_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "过早宣称完成，已要求证据式核对",
          },
        });
        continue;
      }

      const failedPatchPaths = [...new Set(patchFailureLog.map((entry) => entry.path).filter(Boolean))];
      const successPatchPaths = writeStage?.writtenList.map((entry) => entry.key).filter(Boolean) ?? [];
      if (
        !isReadOnlyAgent &&
        writeStage &&
        patchFailureLog.length > 0 &&
        claimsSuccessDespitePatchFailures(rawText, patchFailureLog.length) &&
        patchFailureCompletionRetries < MAX_PATCH_FAILURE_COMPLETION_RETRIES
      ) {
        patchFailureCompletionRetries += 1;
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content: buildPatchFailureCompletionRetryNudge(failedPatchPaths, successPatchPaths),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "patch_failure_completion_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "存在 patch 失败却宣称完成，已要求如实审计",
          },
        });
        continue;
      }

      // Inject modification audit before final reply to prevent false claims of success.
      if (!isReadOnlyAgent && writeStage && patchFailureLog.length > 0) {
        const successCount = writeStage.writtenList.length;
        const failCount = patchFailureLog.length;
        const failFiles = [...new Set(patchFailureLog.map((f) => f.path))].join("、");
        messages.push({
          role: "system",
          content:
            `【修改审计】本轮会话中：${successCount} 个文件修改成功（${writeStage.writtenList.map((w) => w.key).join("、") || "无"}），` +
            `${failCount} 个 patch_file 调用失败（${failFiles}）。` +
            "在最终回复的总结中，只可声称上述成功修改的文件已完成；失败的修改必须如实标注'未生效'或'失败'，禁止虚假声称已完成。",
        });
      }

      // Ghost reply detection: model claims to have made changes but called no tools.
      const claimsModification =
        /(?:已完成修改|已更新|已修复|已添加|已删除|已改为|已改成|改动如下|优化完成|修改如下|刷新查看)/i.test(rawText) &&
        !/以上是|仅供参考|建议|方案|思路/.test(rawText);
      const noWriteToolsThisTurn =
        writeStage !== null &&
        !isReadOnlyAgent &&
        !isPlanExplore &&
        !readOnlyBuildRun &&
        writeStage.writtenList.length === 0;
      if (claimsModification && noWriteToolsThisTurn && turn > 1) {
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content:
            "【系统强制】你声称已完成修改，但本轮未调用任何 patch_file / write_file 工具，代码实际未被修改。" +
            "请立即调用 patch_file 或 write_file 提交真实的代码修改；禁止只输出文字描述。",
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "ghost_reply_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "检测到幻觉回复（声称修改但未执行工具），已要求重试",
          },
        });
        continue;
      }

      if (
        visionLocateSingleTurnRun &&
        !visionLocateToolsUsed &&
        consultativeVisionRun
      ) {
        const anchorQuotes = extractVisibleAnchorQuotes(rawText);
        if (
          anchorQuotes.length > 0 &&
          shouldRunVisionAnchorPrefgrep({
            consultativeVisionRun,
            prompt,
            anchorQuotes,
          })
        ) {
          messages.push({ role: "assistant", content: rawText });
          toolGuard.visionAnchorQuotes = anchorQuotes;
          visionFirstTurnDescriptionText = rawText;
          onEvent({
            type: "status",
            data: {
              phase: "vision_anchor_prefgrep",
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              model,
              detail: "已摘录可见文案，正在按锚点搜索源码…",
            },
          });
          const pregrep = await appendVisionAnchorPrefgrepMessages(projectRoot, anchorQuotes, messages);
          pregrepUniqueFiles = pregrep.uniqueFiles;
          if (pregrep.hadMatches) {
            visionAutoGrepHadMatches = true;
            visionLocateToolsUsed = true;
          }
          onEvent({
            type: "turn_response",
            data: {
              turn,
              ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
              assistantText: userText,
              toolCalls: [],
              hasToolCalls: false,
              isFinal: false,
            },
          });
          if (rawText && !streamedChars) {
            emitUserVisibleAssistantMessage(onEvent, rawText, streamedChars);
          }
          continue;
        }
      }

      const blockConsultativeFinalize =
        !consultativeForceAnswerPending &&
        shouldBlockConsultativeVisionLocateFinalize({
          consultativeVisionRun,
          visionLocateActive: toolGuard.visionLocateActive,
          visionLocateToolsUsed,
          visionAutoGrepHadMatches: visionAutoGrepHadMatches,
          visionLocateReadUsed,
          prompt,
          replyText: rawText,
          visionFirstTurnText: visionFirstTurnDescriptionText,
          grepHitVueFiles: toolGuard.grepHitVueFiles
            ? [...toolGuard.grepHitVueFiles]
            : undefined,
          consultativeReadPaths: toolGuard.consultativeReadPaths,
        });
      if (
        blockConsultativeFinalize &&
        visionConsultativeLocateRetries < MAX_VISION_CONSULTATIVE_LOCATE_RETRIES
      ) {
        visionConsultativeLocateRetries += 1;
        messages.push({ role: "assistant", content: rawText });
        const unreconciledEmptyShell =
          visionFirstTurnDescriptionText &&
          isUnreconciledEmptyShellAnswer(visionFirstTurnDescriptionText, rawText);
        const grepHitVueList = toolGuard.grepHitVueFiles ? [...toolGuard.grepHitVueFiles] : [];
        const appearanceRetry =
          isUiAppearanceQuestionPrompt(prompt) &&
          consultativeAppearanceNeedsVueRead(
            grepHitVueList,
            toolGuard.consultativeReadPaths,
            visionLocateReadUsed,
          ) &&
          (isSpeculativeStyleAnswer(rawText) || grepHitVueList.length > 0);
        const appearanceAnswerAfterRead =
          isUiAppearanceQuestionPrompt(prompt) &&
          visionLocateReadUsed &&
          !appearanceRetry;
        messages.push({
          role: "system",
          content: unreconciledEmptyShell
            ? buildUnreconciledEmptyShellRetryHint()
            : appearanceAnswerAfterRead
              ? buildConsultativeAppearanceAnswerAfterReadHint()
              : appearanceRetry
                ? buildConsultativeUiAppearanceRetryHint(
                    pregrepUniqueFiles.length ? pregrepUniqueFiles : grepHitVueList,
                  )
                : visionAutoGrepHadMatches && !visionLocateReadUsed
                  ? buildVisionConsultativeReadAfterPrefgrepHint(
                      pregrepUniqueFiles.length ? pregrepUniqueFiles : grepHitVueList,
                    )
                  : buildVisionConsultativeLocateRetryHint(toolGuard.visionAnchorQuotes ?? []),
        });
        if (appearanceAnswerAfterRead || visionConsultativeLocateRetries >= MAX_VISION_CONSULTATIVE_LOCATE_RETRIES) {
          consultativeForceAnswerPending = true;
        }
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "vision_consultative_locate_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "读图后须 grep/read 定位，已要求重试",
          },
        });
        continue;
      }

      if (
        !consultativeForceAnswerPending &&
        shouldBlockConsultativeAccuracyFinalize({
          accuracyConsultative: accuracyConsultativeRun,
          visionLocateToolsUsed,
          consultativeReadPaths: toolGuard.consultativeReadPaths ?? [],
          replyText: rawText,
        }) &&
        visionConsultativeAccuracyRetries < MAX_VISION_CONSULTATIVE_ACCURACY_RETRIES
      ) {
        visionConsultativeAccuracyRetries += 1;
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content: buildConsultativeAccuracyTraceRetryHint(toolGuard.consultativeReadPaths ?? []),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "vision_consultative_accuracy_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "准确度题须 trace 到 backend prompt 构造，已要求重试",
          },
        });
        continue;
      }

      if (
        behaviorPurposeRun &&
        shouldBlockBehaviorPurposeFinalize({
          behaviorPurpose: true,
          consultativeReadPaths: toolGuard.consultativeReadPaths ?? [],
          replyText: rawText,
        }) &&
        behaviorPurposeRetries < MAX_BEHAVIOR_PURPOSE_RETRIES
      ) {
        behaviorPurposeRetries += 1;
        consultativeForceAnswerPending = false;
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "system",
          content: buildBehaviorPurposeTraceRetryHint(toolGuard.consultativeReadPaths ?? []),
        });
        onEvent({
          type: "turn_response",
          data: {
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            assistantText: userText,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        });
        onEvent({
          type: "status",
          data: {
            phase: "behavior_purpose_trace_retry",
            turn,
            ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
            model,
            detail: "用途/作用题须 trace 分支逻辑，已要求重试",
          },
        });
        continue;
      }

      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          assistantText: userText,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: true,
        },
      });
      emitUserVisibleAssistantMessage(onEvent, rawText, streamedChars, { force: true });
      consultativeForceAnswerPending = false;
      onEvent({
        type: "status",
        data: {
          phase: "finished",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        },
      });
      onEvent({ type: "done", data: buildDoneData(writeStage, turn, outputTruncated) });
      return;
    }

    if (visibleContent.trim()) {
      const preamble = visibleContent.trim();
      if (shouldNudgeEnglishPlanning(preamble) && !englishPlanningNudgeSent) {
        messages.push({ role: "system", content: buildEnglishPlanningNudge() });
        englishPlanningNudgeSent = true;
      }
      if (isSubstantiveChineseToolPreamble(preamble) && !streamedChars && (isReadOnlyAgent || readOnlyBuildRun)) {
        emitUserVisibleAssistantMessage(onEvent, preamble, streamedChars);
        streamedChars = sanitizeAgentUserVisibleText(preamble).length;
      }
      onEvent({
        type: "turn_trace",
        data: {
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          assistantText: preamble,
          hasToolCalls: true,
        },
      });
    }

    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
        assistantText: visibleContent.trim(),
        toolCalls: toolCalls.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments || "{}",
        })),
        hasToolCalls: true,
        isFinal: false,
      },
    });

    messages.push({
      role: "assistant",
      content: visibleContent || "",
      tool_calls: toolCalls,
    });

    type ToolOutcome = {
      call: ChatToolCall;
      result: string;
      pendingDiff: Extract<VibeAgentEvent, { type: "file_diff" }> | null;
    };

    const runToolCall = async (call: ChatToolCall): Promise<ToolOutcome> => {
      const toolName = call.function.name;
      const toolArgs = parseToolArgs(call.function.arguments || "{}");

      let pendingDiff: Extract<VibeAgentEvent, { type: "file_diff" }> | null = null;
      if (writeStage && WRITE_AGENT_TOOL_NAMES.has(toolName)) {
        const filePath = String(toolArgs.path || "").trim();
        if (filePath) {
          const resolved = resolveProjectPath(projectRoot, filePath);
          if (resolved.ok) {
            const staged = await readStagedFileContent(
              { path: resolved.path, key: resolved.relative, outsideProject: false },
              writeStage,
            );
            const before = staged ?? "";
            let after = before;
            if (toolName === "delete_file") {
              after = "";
            } else if (toolName === "write_file") {
              after = String(toolArgs.content ?? "");
            } else if (toolName === "patch_file") {
              const oldString = String(toolArgs.old_string ?? "");
              const newString = String(toolArgs.new_string ?? "");
              if (oldString) {
                const patchPreview = applyUniquePatch(before, oldString, newString);
                if (patchPreview.ok) after = patchPreview.patched;
              }
            }
            pendingDiff = {
              type: "file_diff",
              data: {
                path: resolved.relative,
                before,
                after,
                deleted: toolName === "delete_file",
                created: toolName === "write_file" && staged === null,
              },
            };
          }
        }
      }

      let result = "";
      try {
        result = await executeTool(
          projectRoot,
          toolName,
          toolArgs,
          writeStage,
          toolMode,
          readCache,
          readSliceCache,
          grepCache,
          readSliceRepeatCounts,
          toolGuard,
          webProxyUrl,
          injectedKeyFilePaths,
        );
      } catch (error) {
        result = `错误：${error instanceof Error ? error.message : String(error)}`;
      }

      return { call, result, pendingDiff };
    };

    const emitToolOutcome = (outcome: ToolOutcome) => {
      const toolName = outcome.call.function.name;
      if (outcome.pendingDiff && !isToolResultFailure(outcome.result)) {
        onEvent(outcome.pendingDiff);
      }
      onEvent({
        type: "tool_end",
        data: {
          id: outcome.call.id,
          name: toolName,
          ok: !isToolResultFailure(outcome.result),
          summary: toolSummary(toolName, outcome.result),
          result: truncateForSse(outcome.result, MAX_TOOL_RESULT_SSE_CHARS),
        },
      });
      messages.push({
        role: "tool",
        tool_call_id: outcome.call.id,
        content: truncateToolResultForModel(outcome.result),
      });
      if (!isToolResultFailure(outcome.result) && textIndicatesPatchAnchor(outcome.result)) {
        patchAnchorLocated = true;
        if (writeStage !== null && !isReadOnlyAgent && !isPlanExplore && !readOnlyBuildRun) {
          patchAnchorForcePending = true;
        }
      }
      if (!isToolResultFailure(outcome.result) && textConfirmsTeleportToBody(outcome.result)) {
        teleportBodyConfirmed = true;
      }
      // Track patch_file failures for corrective nudges.
      if (toolName === "patch_file" && isToolResultFailure(outcome.result)) {
        try {
          const args = JSON.parse(outcome.call.function.arguments || "{}");
          patchFailureLog.push({
            turn,
            path: String(args.path || ""),
            reason: outcome.result.slice(0, 200),
          });
        } catch { /* ignore */ }
      }
    };

    const toolExecutionHeartbeat = setInterval(() => {
      if (signal?.aborted) return;
      onEvent({
        type: "status",
        data: {
          phase: "executing_tool",
          turn,
          ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
          model,
          detail: "正在执行工具...",
        },
      });
    }, 5000);

    const turnGrepEmptyPatterns: string[] = [];
    const recordGrepEmpty = (call: ChatToolCall, result: string) => {
      if (call.function.name !== "grep" || result !== "（无匹配）") return;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const pattern = String(args.pattern ?? "").trim();
        if (pattern) turnGrepEmptyPatterns.push(pattern);
      } catch {
        /* ignore parse errors */
      }
    };

    try {
      for (let index = 0; index < toolCalls.length; ) {
        if (signal?.aborted) break;

        let end = index + 1;
        while (end < toolCalls.length && canParallelizeToolBatch(toolCalls.slice(index, end + 1))) {
          end += 1;
        }

        const batch = toolCalls.slice(index, end);
        const canParallel = canParallelizeToolBatch(batch);
        for (const call of batch) {
          onEvent({
            type: "tool_start",
            data: { id: call.id, name: call.function.name, args: parseToolArgs(call.function.arguments || "{}") },
          });
        }

        if (canParallel && batch.length > 1) {
          const outcomes = await Promise.all(batch.map((call) => runToolCall(call)));
          for (const outcome of outcomes) {
            recordGrepEmpty(outcome.call, outcome.result);
            emitToolOutcome(outcome);
          }
        } else {
          for (const call of batch) {
            const outcome = await runToolCall(call);
            recordGrepEmpty(outcome.call, outcome.result);
            emitToolOutcome(outcome);
          }
        }

        index = end;
      }
    } finally {
      clearInterval(toolExecutionHeartbeat);
    }

    if (turnGrepEmptyPatterns.length > 0) {
      messages.push({
        role: "system",
        content: buildGrepEmptyRecoveryNudge(turnGrepEmptyPatterns),
      });
    }

    if (consultativeVisionRun && toolGuard.visionLocateActive) {
      for (const call of toolCalls) {
        if (call.function.name === "grep") {
          visionLocateToolsUsed = true;
        }
        if (call.function.name === "read_file") {
          visionLocateToolsUsed = true;
          visionLocateReadUsed = true;
        }
      }
    }

    // Inject corrective prompt if patch_file calls failed this turn.
    const thisTurnPatchFailures = patchFailureLog.filter((f) => f.turn === turn);
    if (thisTurnPatchFailures.length > 0 && turn > 1) {
      const failedFiles = [...new Set(thisTurnPatchFailures.map((f) => f.path))].join("、");
      messages.push({
        role: "system",
        content:
          `【系统纠正】本轮 ${thisTurnPatchFailures.length} 个 patch_file 调用失败（文件：${failedFiles}）。` +
          "请 read_file 重新读取（patch 失败后已解除重叠/缓存限制）；从返回原文复制更短且唯一的 old_string 再 patch。" +
          "禁止凭记忆构造 old_string。",
      });
      for (const path of new Set(thisTurnPatchFailures.map((f) => f.path).filter(Boolean))) {
        if (shouldNudgeAlternateUiPatchStrategy(patchFailureLog, path)) {
          messages.push({ role: "system", content: buildAlternateUiPatchStrategyNudge(path) });
        }
      }
    }

    const turnHadProductiveWrite = toolCalls.some((call) => callIsProductiveWrite(call));
    const turnExploreOnly =
      toolCalls.length > 0 && toolCalls.every((call) => READ_ONLY_AGENT_TOOL_NAMES.has(call.function.name));
    if (
      readOnlyBuildRun &&
      consultativeVisionRun &&
      turnExploreOnly &&
      toolGuard.grepHitVueFiles?.size &&
      toolCalls.some((c) => c.function.name === "grep")
    ) {
      const grepVueList = [...toolGuard.grepHitVueFiles];
      const reads = toolGuard.consultativeReadPaths ?? [];
      const unreadVue = grepVueList.filter(
        (vue) =>
          !reads.some(
            (read) =>
              read.replace(/\\/g, "/").endsWith(vue.replace(/\\/g, "/")) ||
              read.includes(vue.replace(/\\/g, "/")),
          ),
      );
      if (unreadVue.length > 0) {
        messages.push({ role: "system", content: buildGrepHitVueReadNudge(unreadVue) });
      }
    }
    if (
      (isReadOnlyAgent || readOnlyBuildRun) &&
      scheduledTaskConsultativeRun &&
      turnExploreOnly &&
      !scheduledJobRegistrationNudgeSent &&
      toolGuard.consultativeReadPaths?.length
    ) {
      const readPaths = toolGuard.consultativeReadPaths;
      const grepPatterns = toolGuard.grepPatterns ?? [];
      if (shouldNudgeScheduledJobRegistration(readPaths, grepPatterns)) {
        const jobNames = extractJobClassNamesFromReadPaths(readPaths);
        if (jobNames.length > 0) {
          messages.push({
            role: "system",
            content: buildScheduledJobRegistrationNudge([...new Set(jobNames)]),
          });
          scheduledJobRegistrationNudgeSent = true;
        }
      }
    }
    if (readOnlyBuildRun && turnExploreOnly && toolCalls.length > 0) {
      const exploreSig = toolCalls
        .map((call) => `${call.function.name}:${call.function.arguments || "{}"}`)
        .sort()
        .join("|");
      if (exploreSig && exploreSig === lastConsultativeExploreSig) {
        consultativeDuplicateExploreHits += 1;
        if (consultativeDuplicateExploreHits >= 1) {
          messages.push({ role: "system", content: buildConsultativeDuplicateExploreNudge() });
          consultativeForceAnswerPending = true;
        }
      } else {
        lastConsultativeExploreSig = exploreSig;
        consultativeDuplicateExploreHits = 0;
      }
    }
    if (
      patchAnchorLocated &&
      writeStage !== null &&
      !isReadOnlyAgent &&
      !isPlanExplore &&
      !readOnlyBuildRun &&
      !patchAnchorNudgeSent &&
      turnExploreOnly
    ) {
      messages.push({ role: "system", content: buildPatchAnchorLocatedNudge() });
      patchAnchorNudgeSent = true;
    }
    if (turnHadProductiveWrite) {
      consecutiveExploreTurns = 0;
      interimDiagnosisNudgeSent = false;
      patchAnchorForcePending = false;
      // Reset file-breadth tracking when the model finally writes (it found the target).
      exploreFilesRead.clear();
      fileBreadthNudgeSent = false;
      if (
        !postPatchVerifyNudgeSent &&
        runtimeProfile.verifyScript &&
        !isReadOnlyAgent &&
        !isPlanExplore &&
        !readOnlyBuildRun
      ) {
        messages.push({
          role: "system",
          content: buildPostPatchVerifyNudge(runtimeProfile.verifyScript),
        });
        postPatchVerifyNudgeSent = true;
      }
    } else if (turnExploreOnly) {
      consecutiveExploreTurns += 1;
      totalExploreTurns += 1;
      if (
        (implementFollowUpRun || sameIssueFollowUpRun) &&
        totalExploreTurns >= 1 &&
        writeStage &&
        !writeStage.writtenList.some((p) => isProductiveWritePath(p))
      ) {
        patchAnchorForcePending = true;
        patchAnchorLocated = true;
      }
      // Track which files were read this turn for breadth monitoring.
      for (const call of toolCalls) {
        if (call.function.name === "read_file") {
          try {
            const args = JSON.parse(call.function.arguments || "{}");
            if (args.path) {
              const readPath = String(args.path);
              exploreFilesRead.add(readPath);
              if (readOnlyBuildRun || isReadOnlyAgent) {
                if (!toolGuard.consultativeReadPaths) toolGuard.consultativeReadPaths = [];
                if (!toolGuard.consultativeReadPaths.includes(readPath)) {
                  toolGuard.consultativeReadPaths.push(readPath);
                }
              }
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }
    if (isExplore && consecutiveExploreTurns >= EXPLORE_EXPLORE_TURN_BUDGET) {
      messages.push({ role: "system", content: buildExploreExploreBudgetNudge(consecutiveExploreTurns) });
      consecutiveExploreTurns = 0;
    } else if (isAsk && consecutiveExploreTurns >= ASK_EXPLORE_TURN_BUDGET) {
      messages.push({ role: "system", content: buildAskExploreBudgetNudge(consecutiveExploreTurns) });
      consecutiveExploreTurns = 0;
    } else if (readOnlyBuildRun && consecutiveExploreTurns >= CONSULTATIVE_BUILD_EXPLORE_TURN_BUDGET) {
      messages.push({ role: "system", content: buildConsultativeExploreBudgetNudge(consecutiveExploreTurns) });
      consecutiveExploreTurns = 0;
    } else if (!isReadOnlyAgent && !readOnlyBuildRun && consecutiveExploreTurns >= exploreTurnBudget) {
      messages.push({ role: "system", content: buildExploreBudgetNudge(consecutiveExploreTurns, mode) });
      consecutiveExploreTurns = 0;
    }

    // 轮次接近上限时，注入强制完成提示，避免 Agent 继续重试失败操作
    if (!readOnlyBuildRun && !isExplore && segmentMaxTurns !== undefined && turn >= segmentMaxTurns - 3 && turn < segmentMaxTurns) {
      const remaining = segmentMaxTurns - turn;
      messages.push({
        role: "system",
        content: `【紧急提示】剩余 ${remaining} 轮。请优先 patch_file 完成必要修改，然后输出中文总结；若任务已完成，直接写总结（已改文件、验证方式、剩余问题）。`,
      });
    }

    if (segmentMaxTurns !== undefined && turn >= segmentMaxTurns) {
      if (turn >= AGENT_SAFETY_MAX_TURNS) {
        onEvent({
          type: "status",
          data: { phase: "finished", turn, maxTurns: AGENT_SAFETY_MAX_TURNS },
        });
        if (!isReadOnlyAgent) {
          onEvent({
            type: "error",
            data: { message: `已达安全上限（${AGENT_SAFETY_MAX_TURNS} 轮），任务可能未完成。` },
          });
        }
        onEvent({ type: "done", data: buildDoneData(writeStage, turn, outputTruncated) });
        return;
      }

      if (readOnlyBuildRun || isExplore) {
        messages.push({
          role: "system",
          content: isExplore
            ? buildExploreForceReportNudge(Math.max(totalExploreTurns, EXPLORE_MAX_TOTAL_EXPLORE_SOFT))
            : buildConsultativeSegmentCapNudge(turn, totalExploreTurns),
        });
        if (!isExplore) {
          messages.push({
            role: "system",
            content: buildAskForceAnswerNudge(Math.max(totalExploreTurns, ASK_MAX_TOTAL_EXPLORE_SOFT)),
          });
        }
        segmentMaxTurns = turn + 1;
        consultativeForceAnswerPending = true;
        onEvent({
          type: "status",
          data: {
            phase: isExplore ? "explore_segment_cap" : "consultative_segment_cap",
            turn,
            maxTurns: segmentMaxTurns,
            model,
            detail: isExplore ? "探索已达段内轮次上限，须输出项目报告" : "咨询只读已达段内轮次上限，须输出结论",
          },
        });
        continue;
      }

      if (!isReadOnlyAgent && turnCapFinalSummaryAttempts < 2) {
        turnCapFinalSummaryAttempts += 1;
        messages.push({
          role: "system",
          content: buildTurnCapFinalSummaryNudge(
            turn,
            writeStage?.writtenList.map((entry) => entry.key).filter(Boolean),
            turnCapFinalSummaryAttempts,
          ),
        });
        segmentMaxTurns = turn + 1;
        consultativeForceAnswerPending = true;
        onEvent({
          type: "status",
          data: {
            phase: "turn_cap_final_summary",
            turn,
            maxTurns: segmentMaxTurns,
            model,
            detail:
              turnCapFinalSummaryAttempts >= 2
                ? "段内轮次将尽，最后机会须输出总结"
                : "段内轮次将尽，须输出中文总结",
          },
        });
        continue;
      }

      if (!isReadOnlyAgent && turnCapFinalSummaryAttempts >= 2) {
        onEvent({
          type: "status",
          data: { phase: "finished", turn, maxTurns: segmentMaxTurns },
        });
        onEvent({
          type: "error",
          data: { message: buildTurnCapExhaustedMessage(turn) },
        });
        onEvent({ type: "done", data: buildDoneData(writeStage, turn, outputTruncated) });
        return;
      }

      segmentIndex += 1;
      segmentMaxTurns = extendSegmentMaxTurns(turn, segmentBudget);
      turnsLowNudgeSent = false;
      if (!readOnlyBuildRun && !isExplore) {
        messages.push({
          role: "system",
          content: buildSegmentContinueNudge(turn, segmentIndex, nudgeMode, isExecutePlan && mode === "plan"),
        });
      }
      onEvent({
        type: "status",
        data: {
          phase: "continuing",
          turn,
          maxTurns: segmentMaxTurns,
          detail: `自动续跑第 ${segmentIndex} 段（累计 ${turn} 轮）…`,
        },
      });
    }
  }
}
