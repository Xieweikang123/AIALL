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
import { executeTool, trackWrittenFile, readStagedFileContent, isAgentsGuideOnlyPath, recordGrepHitVueFiles, requirePriorRead, type WriteStage } from "./agentToolExecutor";
import {
  createAgentTurnContext,
  syncToolGuard,
  markAnchorLocated,
  markTeleportBodyConfirmed,
  recordPatchFailure,
  resetExploreOnProductiveWrite,
  type AgentTurnContext,
} from "./agentTurnContext";
import { runTurnPreflight } from "./agentTurnPreflight";
import { runTurnModelCall } from "./agentTurnModelCall";
import { runTurnVision } from "./agentTurnVision";
import { validateAgentResponse } from "./agentTurnValidator";
import { runTurnExecution } from "./agentTurnExecution";
import { handleTurnSegment } from "./agentTurnSegment";

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
      ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
      model,
      ...(openFileRel ? { openFile: openFileRel } : {}),
    },
  });

  const builtCtx = await buildAgentContext({
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
  } = builtCtx;

  const ctx = createAgentTurnContext({
    isReadOnlyAgent,
    isPlanExplore,
    readOnlyBuildRun,
    segmentBudget,
    initialMaxTurns: params.maxTurns,
    implementFollowUpRun,
    agentStepClarifyRun,
    sameIssueFollowUpRun,
    userRecentlyReportedFailure,
    userFailureReportRun,
    locateStatusFollowUpRun,
  });
  const MAX_EMPTY_REPLY_RETRIES = 2;
  const MAX_PREMATURE_COMPLETION_RETRIES = 1;
  const MAX_PATCH_FAILURE_COMPLETION_RETRIES = 1;
  const MAX_BEHAVIOR_PURPOSE_RETRIES = 2;
  const MAX_VISION_FIRST_TURN_RETRIES = 2;
  const MAX_VISION_CONSULTATIVE_LOCATE_RETRIES = 2;
  const MAX_VISION_CONSULTATIVE_ACCURACY_RETRIES = 2;
  const MAX_TRUNCATION_RETRIES = 5;

  const activeTools = isReadOnlyAgent || isPlanExplore || readOnlyBuildRun ? READ_ONLY_AGENT_TOOLS : VIBE_AGENT_TOOLS;
  const userContent = buildVisionUserContent(prompt, imageDataUrls);
  ctx.messages = [
    { role: "system", content: systemPrompt },
    ...buildHistoryMessages(params.history),
    { role: "user", content: userContent },
  ];
  if (isExplore) {
    if (isExploreContinuePrompt(prompt)) {
      ctx.messages.push({ role: "system", content: buildExploreContinueNudge() });
    } else if (isExploreSectionFillPrompt(prompt)) {
      ctx.messages.push({ role: "system", content: buildExploreSectionFillNudge() });
    } else if (isExploreChangesPrompt(prompt)) {
      ctx.messages.push({ role: "system", content: buildExploreChangesNudge() });
    } else if (exploreKnowledgeIntent === "followup") {
      ctx.messages.push({
        role: "system",
        content: isKnowledgeQuoteFollowUpPrompt(prompt)
          ? buildExploreQuotedFollowUpHint()
          : buildExploreFollowUpHint(),
      });
    }
  }
  if (readOnlyBuildRun && consultativeVisionRun && ctx.segmentMaxTurns !== undefined) {
    ctx.segmentMaxTurns = Math.min(ctx.segmentMaxTurns, 6);
  }
  const visionLocateSingleTurnRun = shouldBypassVisionFirstTurn({
    imageCount: imageDataUrls.length,
    consultativeVisionRun,
    prompt,
  });
  if (visionLocateSingleTurnRun) {
    ctx.toolGuard.visionLocateActive = true;
  }
  if (visionLocateSingleTurnRun && accuracyConsultativeRun) {
    ctx.messages.push({ role: "system", content: buildConsultativeAccuracyTraceHint() });
  }
  if (visionLocateSingleTurnRun && isUiAppearanceQuestionPrompt(prompt)) {
    ctx.messages.push({ role: "system", content: buildConsultativeUiAppearanceHint() });
  }
  ctx.visionFirstTurnPending = shouldRequireVisionFirstTurn(
    imageDataUrls.length,
    false,
    visionLocateSingleTurnRun,
  );

  emitAgentContext(onEvent, {
    mode,
    systemPrompt,
    history: historyForDisplay(params.history),
    projectContext: [projectContextBlock, agentsGuideBlock, projectSkillsBlock, projectMemoryBlock]
      .filter(Boolean)
      .join("") || undefined,
    ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
    model,
    ...(openFileRel ? { openFile: openFileRel } : {}),
  });

  if (signal?.aborted) {
    if (!isExplore) {
      onEvent({ type: "status", data: { phase: "aborted" } });
      onEvent({ type: "done", data: buildDoneData(ctx.writeStage, 0) });
      return;
    }
    onEvent({
      type: "status",
      data: { phase: "aborted", detail: "正在整理不完整知识库…", model },
    });
  }

  onEvent({ type: "status", data: { phase: "building_context", model, detail: "上下文就绪，开始运行" } });

  for (let turn = 1; ; turn += 1) {
    ctx.turn = turn;

    const preflight = runTurnPreflight(ctx, turn, {
      isReadOnlyAgent, isPlanExplore, readOnlyBuildRun, isExecutePlan, isAsk, isExplore,
      mode, nudgeMode, exploreHardCap, exploreSoftCap, implementFollowUpRun,
      sameIssueFollowUpRun, uiDefectBuildRun, model, prompt,
    }, activeTools, onEvent, signal);
    if (preflight.action === "return") return;

    const mc = await runTurnModelCall(ctx, {
      turn, endpoint, apiKey, model, maxContextChars, toolsForTurn: preflight.toolsForTurn,
      readOnlyBuildRun, isReadOnlyAgent, imageDataUrls, prompt,
    }, onEvent, signal);
    if (mc.action === "return") return;
    if (mc.action === "continue") { turn -= 1; continue; }

    if (ctx.visionFirstTurnPending || visionLocateSingleTurnRun) {
      const vis = await runTurnVision(ctx, mc.visibleContent, mc.toolCalls, mc.streamedChars, {
        turn, consultativeVisionRun, accuracyConsultativeRun, behaviorPurposeRun,
        consultativeUiAppearanceRun, isReadOnlyAgent, isPlanExplore, readOnlyBuildRun,
        uiDefectBuildRun, projectRoot, prompt, imageDataUrls, model, visionLocateSingleTurnRun,
      }, onEvent);
      if (vis.action === "continue") continue;
    }

    if (!mc.toolCalls.length) {
      const val = await validateAgentResponse(ctx, {
        turn, isReadOnlyAgent, isPlanExplore, readOnlyBuildRun, isAsk, isExplore,
        implementFollowUpRun, sameIssueFollowUpRun, codeReviewRun, userFailureReportRun,
        userRecentlyReportedFailure, uiDefectBuildRun, agentStepClarifyRun,
        accuracyConsultativeRun, consultativeVisionRun, behaviorPurposeRun,
        consultativeUiAppearanceRun, visionLocateSingleTurnRun,
        model, rawContent: mc.rawContent, visibleContent: mc.visibleContent,
        toolCalls: mc.toolCalls, streamedChars: mc.streamedChars,
      }, onEvent);
      if (val.action === "return") return;
      if (val.action === "continue") continue;
    }

    await runTurnExecution(ctx, {
      turn, projectRoot, toolMode, webProxyUrl, injectedKeyFilePaths, signal,
      isReadOnlyAgent, isPlanExplore, readOnlyBuildRun, isExplore, isAsk,
      implementFollowUpRun, sameIssueFollowUpRun, consultativeVisionRun,
      scheduledTaskConsultativeRun, exploreTurnBudget, mode, model,
      visibleContent: mc.visibleContent, toolCalls: mc.toolCalls, streamedChars: mc.streamedChars,
    }, onEvent);

    const seg = handleTurnSegment(ctx, {
      turn, isReadOnlyAgent, isExplore, readOnlyBuildRun, isExecutePlan,
      mode, nudgeMode, segmentBudget, model, outputTruncated: ctx.outputTruncated,
    }, onEvent);
    if (seg.action === "return") return;
    if (seg.action === "continue") continue;
  }
}
