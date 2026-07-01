import { resolveFirstByteTimeoutMs } from "./aiForward";
import { resolveAgentMaxTurns, AUTO_BUG_FIX_WALL_CLOCK_MS } from "./agentTurnBudget";
import {
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
import {
  EXECUTE_PLAN_EXPLORE_TURN_BUDGET,
  EXPLORE_EXPLORE_TURN_BUDGET,
  INTERACTIVE_EXPLORE_TURN_BUDGET,
  PLAN_EXPLORE_TURN_BUDGET,
  buildAmbiguousTermClarificationHint,
  buildPendingPlanAmendHint,
  buildPendingPlanClarificationHint,
  buildPlanNoTargetPathHint,
  buildPlanQuoteInformationalHint,
  buildPlanRevisionFollowUpHint,
} from "./agentExplorationBudget";
import { resolveAmbiguousClarificationTerms } from "../src/orchestration/generic/ambiguousTermTriggers";
import { classifyUserIntentFromRules, resolveUserIntent, shouldSkipAiIntentClassifier } from "../src/services/intentClassifierRules";
import { formatIntentClassificationDetail } from "../src/services/intentClassifierAi";
import { classifyUserIntentWithAi } from "./agentIntentClassifier";
import { isUiAppearanceQuestionPrompt } from "../src/orchestration/generic/userIntentClassifiers";
import {
  extractPlanFilePaths,
  isPlanQuoteInformationalPrompt,
  isPlanQuoteRevisionPrompt,
  resolvePendingPlanState,
  stripQuotedReplyPrefix,
} from "../src/services/agentContinuation";
import { resolveAgentRunPolicy, usesReadOnlyTools } from "./agentRunPolicy";
import { buildConsultativeAccuracyTraceHint } from "./consultativeAccuracyTrace";
import { buildAgentContext, resolveOpenFileInProject } from "./agentContextBuilder";
import type { VibeAgentEvent, VibeChatHistoryMessage, VibeChatMode } from "../shared/agentTypes";
import { VIBE_AGENT_TOOLS, READ_ONLY_AGENT_TOOLS, buildDoneData } from "./agentClassifier";
import { buildHistoryMessages, emitAgentContext, historyForDisplay } from "./agentContext";
import {
  buildConsultativeUiAppearanceHint,
  buildVisionUserContent,
  sanitizeImageDataUrls,
  shouldBypassVisionFirstTurn,
  shouldRequireVisionFirstTurn,
} from "./visionMessage";
import { createAgentTurnContext } from "./agentTurnContext";
import { runTurnPreflight } from "./agentTurnPreflight";
import { runTurnModelCall } from "./agentTurnModelCall";
import { runTurnVision } from "./agentTurnVision";
import { validateAgentResponse } from "./agentTurnValidator";
import { runTurnExecution } from "./agentTurnExecution";
import { handleTurnSegment } from "./agentTurnSegment";
import { buildTurnRunConfig } from "./agentTurnRunConfig";
import { normalizeExecutePlanContext, type ExecutePlanContextInput } from "./agentExecutePlanContext";
import { hydrateWriteStageFromPriorPaths } from "./agentToolExecutor";

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
  runProfile?: ExecutePlanContextInput;
  /** @deprecated Use runProfile.kind === "execute_plan" */
  executionMode?: boolean;
  /** Productive paths already written in earlier segments of the same assistant turn. */
  taskWrittenFiles?: string[];
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

export {
  createWriteStage,
  executeTool,
  trackWrittenFile,
  hydrateWriteStageFromPriorPaths,
  readStagedFileContent,
  isAgentsGuideOnlyPath,
  recordGrepHitVueFiles,
  requirePriorRead,
  type WriteStage,
} from "./agentToolExecutor";

export async function runVibeAgent(params: RunVibeAgentParams): Promise<void> {
  const mode = params.mode || "build";
  const isAsk = mode === "ask";
  const isExplore = mode === "explore";
  const isReadOnlyAgent = isAsk || isExplore;
  const runProfile = normalizeExecutePlanContext(
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
    isAsk: isReadOnlyAgent,
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
    isAsk: isReadOnlyAgent,
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

  const openFileRel = resolveOpenFileInProject(projectRoot, openFilePath)?.relative;
  const segmentMaxTurns = params.maxTurns ?? segmentBudget;

  onEvent({
    type: "status",
    data: {
      phase: "preparing",
      ...(segmentMaxTurns !== undefined ? { maxTurns: segmentMaxTurns } : {}),
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
    runPolicy,
    effectiveTaskPrompt: runPolicy.effectiveTaskPrompt,
    userRecentlyReportedFailure: runPolicy.userRecentlyReportedFailure,
    runProfile,
  }, onEvent);

  const {
    systemPrompt,
    projectContextBlock,
    agentsGuideBlock,
    projectSkillsBlock,
    projectMemoryBlock,
    injectedKeyFilePaths,
    exploreKnowledgeIntent,
    projectContextSnapshot,
  } = builtCtx;

  const ambiguousClarificationTerms = resolveAmbiguousClarificationTerms({
    prompt,
    history: params.history,
    projectContext: projectContextSnapshot,
    mode,
    isExecutePlan,
    isPlanExplore,
    readOnlyBuildRun: runPolicy.readOnlyBuildRun,
    implementFollowUpRun: runPolicy.implementFollowUpRun,
  });
  const ambiguousTermClarificationRun = ambiguousClarificationTerms.length > 0;

  const planQuoteInformationalRun = isPlanExplore && isPlanQuoteInformationalPrompt(prompt);
  const pendingPlanState = resolvePendingPlanState(params.history);

  const visionLocateSingleTurnRun = shouldBypassVisionFirstTurn({
    imageCount: imageDataUrls.length,
    consultativeVisionRun: runPolicy.consultativeVisionRun,
    prompt,
  });

  const activeTools = usesReadOnlyTools(runPolicy, { isReadOnlyAgent, isPlanExplore })
    ? READ_ONLY_AGENT_TOOLS
    : VIBE_AGENT_TOOLS;

  const runConfig = buildTurnRunConfig({
    projectRoot,
    prompt,
    endpoint,
    apiKey,
    model,
    mode,
    toolMode,
    nudgeMode,
    isAsk,
    isExplore,
    isReadOnlyAgent,
    isExecutePlan,
    isPlanExplore,
    runPolicy,
    runProfile,
    exploreTurnBudget,
    segmentBudget,
    maxContextChars: runPolicy.maxContextChars,
    activeTools,
    imageDataUrls,
    injectedKeyFilePaths: injectedKeyFilePaths ?? new Set(),
    webProxyUrl,
    visionLocateSingleTurnRun,
    signal,
  });

  const ctx = createAgentTurnContext({
    runConfig,
    segmentBudget,
    initialMaxTurns: params.maxTurns,
    ambiguousTermClarificationRun,
    ambiguousTermClarificationTerms: ambiguousClarificationTerms,
    planQuoteInformationalRun,
    planPendingAmendRun: runPolicy.pendingPlanAmendRun,
    planPendingClarifyRun: runPolicy.pendingPlanClarifyRun,
  });
  if (params.taskWrittenFiles?.length) {
    hydrateWriteStageFromPriorPaths(ctx.writeStage, params.taskWrittenFiles);
  }

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
  if (ambiguousTermClarificationRun) {
    ctx.messages.push({
      role: "system",
      content: buildAmbiguousTermClarificationHint(ambiguousClarificationTerms),
    });
    onEvent({
      type: "status",
      data: {
        phase: "ambiguous_term_clarification",
        model,
        detail: `歧义词澄清：${ambiguousClarificationTerms.join("、")}`,
      },
    });
  } else if (isPlanExplore && runPolicy.pendingPlanClarifyRun) {
    ctx.messages.push({ role: "system", content: buildPendingPlanClarificationHint() });
  } else if (isPlanExplore && runPolicy.pendingPlanAmendRun) {
    ctx.messages.push({
      role: "system",
      content: buildPendingPlanAmendHint(pendingPlanState.planFilePath),
    });
  } else if (isPlanExplore && isPlanQuoteInformationalPrompt(prompt)) {
    ctx.messages.push({ role: "system", content: buildPlanQuoteInformationalHint() });
  } else if (isPlanExplore && isPlanQuoteRevisionPrompt(prompt)) {
    ctx.messages.push({ role: "system", content: buildPlanRevisionFollowUpHint() });
  } else if (
    isPlanExplore &&
    !extractPlanFilePaths(stripQuotedReplyPrefix(prompt)).length &&
    !pendingPlanState.hasPendingPlan
  ) {
    ctx.messages.push({ role: "system", content: buildPlanNoTargetPathHint() });
  }
  if (runPolicy.readOnlyBuildRun && runPolicy.consultativeVisionRun && ctx.segmentMaxTurns !== undefined) {
    ctx.segmentMaxTurns = Math.min(ctx.segmentMaxTurns, 6);
  }
  if (visionLocateSingleTurnRun) {
    ctx.toolGuard.visionLocateActive = true;
  }
  if (visionLocateSingleTurnRun && runPolicy.accuracyConsultativeRun) {
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

    if (
      runPolicy.automatedBugFixRun &&
      Date.now() - ctx.runStartedAt > AUTO_BUG_FIX_WALL_CLOCK_MS
    ) {
      onEvent({
        type: "status",
        data: { phase: "finished", turn, maxTurns: ctx.segmentMaxTurns },
      });
      onEvent({
        type: "error",
        data: { message: "一键修复已达时间上限（10 分钟），任务可能未完成。" },
      });
      onEvent({ type: "done", data: buildDoneData(ctx.writeStage, turn, ctx.outputTruncated) });
      return;
    }

    const preflight = runTurnPreflight(ctx, turn, activeTools, onEvent, signal);
    if (preflight.action === "return") {
      return;
    }

    const mc = await runTurnModelCall(ctx, {
      turn,
      toolsForTurn: preflight.toolsForTurn,
      resolveFirstByteTimeoutMs,
    }, onEvent, signal);
    if (mc.action === "return") {
      return;
    }
    if (mc.action === "continue") { turn -= 1; continue; }

    if (ctx.visionFirstTurnPending || visionLocateSingleTurnRun) {
      const vis = await runTurnVision(ctx, {
        visibleContent: mc.visibleContent,
        toolCalls: mc.toolCalls,
        streamedChars: mc.streamedChars,
      }, onEvent);
      if (vis.action === "continue") continue;
    }

    if (!mc.toolCalls.length) {
      const val = await validateAgentResponse(ctx, {
        rawContent: mc.rawContent,
        visibleContent: mc.visibleContent,
        toolCalls: mc.toolCalls,
        streamedChars: mc.streamedChars,
        targetFiles: runProfile.targetFiles,
        taskPrompt: runPolicy.quotedAmendRun
          ? runPolicy.effectiveTaskPrompt
          : (runProfile.userIntent ?? runPolicy.effectiveTaskPrompt),
      }, onEvent);
      if (val.action === "return") {
        return;
      }
      if (val.action === "continue") continue;
    }

    await runTurnExecution(ctx, {
      turn,
      visibleContent: mc.visibleContent,
      toolCalls: mc.toolCalls,
      streamedChars: mc.streamedChars,
    }, onEvent);

    const seg = handleTurnSegment(ctx, onEvent);
    if (seg.action === "return") {
      return;
    }
    if (seg.action === "continue") continue;
  }
}
