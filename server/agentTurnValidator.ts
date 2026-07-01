import type { ChatToolCall } from "./aiForward";
import type { VibeAgentEvent } from "../shared/agentTypes";
import type { AgentTurnContext } from "./agentTurnContext";
import { emitUserVisibleAssistantMessage } from "./agentStream";
import { buildDoneData } from "./agentClassifier";
import {
  isEmptyOrInsufficientFinalReply,
  claimsPrematureCompletion,
  claimsSuccessDespitePatchFailures,
  isAnalysisOnlyReplyUnderForcePatch,
  sanitizeAgentUserVisibleText,
  textIndicatesPatchAnchor,
  textConfirmsTeleportToBody,
} from "./agentExploreGuard";
import { buildAgentStepClarifyContinueHint } from "../src/orchestration/product/userIntentHints";
import {
  buildEmptyReplyRetryNudge,
  buildPrematureCompletionRetryNudge,
  buildPatchFailureCompletionRetryNudge,
  buildPatchAnchorForcePatchNudge,
  buildUiDefectForcePatchNudge,
  buildBuildExploreForcePatchNudge,
  buildExploreForceReportNudge,
  buildSameIssueFollowUpForceSummaryNudge,
  buildAmbiguousTermClarificationRetryNudge,
} from "./agentExplorationBudget";
import {
  looksLikeClarificationQuestion,
  looksLikePrematurePlanOrScaffold,
} from "../src/orchestration/generic/ambiguousTermTriggers";
import {
  shouldBlockConsultativeVisionLocateFinalize,
  buildVisionConsultativeLocateRetryHint,
  buildConsultativeUiAppearanceRetryHint,
  buildConsultativeAppearanceAnswerAfterReadHint,
  consultativeAppearanceNeedsVueRead,
} from "./visionMessage";
import { buildVisionConsultativeReadAfterPrefgrepHint } from "./visionAnchorPrefgrep";
import {
  buildConsultativeAccuracyTraceRetryHint,
  shouldBlockConsultativeAccuracyFinalize,
} from "./consultativeAccuracyTrace";
import {
  buildBehaviorPurposeTraceRetryHint,
  shouldBlockBehaviorPurposeFinalize,
} from "./consultativeBehaviorTrace";
import {
  buildConsultativeUiBehaviorTraceRetryHint,
  shouldBlockConsultativeUiBehaviorFinalize,
} from "./consultativeUiBehaviorTrace";
import { buildSearchFilesEmptyHint } from "./agentAskPrompt";
import { markAnchorLocated, markTeleportBodyConfirmed, recordPatchFailure, listUncleanedEphemeralProbeFiles } from "./agentTurnContext";
import { buildWorkspaceCleanupNudge } from "../shared/agentProbeGuard";
import { detectProjectRuntimeProfile } from "./agentRuntimeHint";
import {
  buildFinishGateRetryNudge,
  evaluateFinishGate,
  writtenStagePaths,
} from "./agentFinishGate";

export interface ValidationParams {
  rawContent: string;
  visibleContent: string;
  toolCalls: ChatToolCall[];
  streamedChars: number;
  targetFiles?: string[];
  taskPrompt?: string;
}

export type ValidationAction = "return" | "continue" | "final";

/**
 * Validate a no-tool-call assistant response and apply retries if needed (Block 12).
 */
export async function validateAgentResponse(
  ctx: AgentTurnContext,
  params: ValidationParams,
  onEvent: (event: VibeAgentEvent) => void,
): Promise<{ action: ValidationAction }> {
  const cfg = ctx.runConfig;
  const p = cfg.runPolicy;
  const turn = ctx.turn;
  const { model, isReadOnlyAgent, isPlanExplore, isAsk, isExplore, isExecutePlan, visionLocateSingleTurnRun } = cfg;
  const {
    readOnlyBuildRun,
    implementFollowUpRun,
    sameIssueFollowUpRun,
    codeReviewRun,
    userFailureReportRun,
    userRecentlyReportedFailure,
    uiDefectBuildRun,
    agentStepClarifyRun,
    accuracyConsultativeRun,
    consultativeVisionRun,
    behaviorPurposeRun,
    consultativeUiAppearanceRun,
    automatedBugFixRun,
  } = p;
  const { rawContent, visibleContent, toolCalls, streamedChars, targetFiles, taskPrompt } = params;
  const userText = sanitizeAgentUserVisibleText(visibleContent.trim());

  const mustPatchBeforeFinish =
    ctx.writeStage !== null &&
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    ctx.writeStage.writtenList.length === 0 &&
    (implementFollowUpRun || (ctx.patchAnchorLocated && ctx.patchAnchorForcePending));

  // ── 12a-pre: Ambiguous term clarification — block premature plan/scaffold ──
  if (ctx.ambiguousTermClarificationPending) {
    if (looksLikePrematurePlanOrScaffold(rawContent)) {
      ctx.ambiguousTermClarificationRetries += 1;
      ctx.messages.push({ role: "assistant", content: rawContent });
      ctx.messages.push({
        role: "system",
        content: buildAmbiguousTermClarificationRetryNudge(ctx.ambiguousTermClarificationTerms),
      });
      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          assistantText: userText,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: false,
        },
      });
      onEvent({
        type: "status",
        data: {
          phase: "ambiguous_term_clarify_retry",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          model,
          detail: `歧义词未澄清即输出方案，第 ${ctx.ambiguousTermClarificationRetries} 次要求改为提问`,
        },
      });
      if (ctx.ambiguousTermClarificationRetries <= 2) {
        return { action: "continue" };
      }
    }
    if (
      looksLikeClarificationQuestion(rawContent) ||
      !looksLikePrematurePlanOrScaffold(rawContent)
    ) {
      ctx.ambiguousTermClarificationPending = false;
    }
  }

  // ── 12a: Agent step clarify ──
  if (ctx.agentStepClarifyPending) {
    ctx.agentStepClarifyPending = false;
    ctx.messages.push({ role: "assistant", content: rawContent });
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        assistantText: userText,
        toolCalls: [],
        hasToolCalls: false,
        isFinal: false,
      },
    });
    emitUserVisibleAssistantMessage(onEvent, rawContent, streamedChars);
    if (uiDefectBuildRun || ctx.patchAnchorLocated || ctx.patchAnchorForcePending) {
      ctx.messages.push({ role: "system", content: buildAgentStepClarifyContinueHint() });
      onEvent({
        type: "status",
        data: {
          phase: "clarify_continue",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          model,
          detail: "步骤澄清后继续完成修改",
        },
      });
    }
    return { action: "continue" };
  }

  // ── 12b: Must-patch-before-finish analysis-only reply ──
  if (mustPatchBeforeFinish && isAnalysisOnlyReplyUnderForcePatch(rawContent)) {
    ctx.messages.push({ role: "assistant", content: rawContent });
    ctx.messages.push({
      role: "system",
      content: isAnalysisOnlyReplyUnderForcePatch(rawContent)
        ? buildPatchAnchorForcePatchNudge()
        : "",
    });
    ctx.patchAnchorForcePatchNudgeSent = true;
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        assistantText: userText,
        toolCalls: [],
        hasToolCalls: false,
        isFinal: false,
      },
    });
    onEvent({
      type: "status",
      data: {
        phase: "patch_anchor_analysis_retry",
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "锚点已定位，须调用 patch_file，禁止仅分析",
      },
    });
    return { action: "continue" };
  }

  // ── 12c: Empty reply retry ──
  if (isEmptyOrInsufficientFinalReply(rawContent) && ctx.emptyReplyRetries < 2) {
    ctx.emptyReplyRetries += 1;
    ctx.messages.push({ role: "assistant", content: rawContent });
    ctx.messages.push({ role: "system", content: buildEmptyReplyRetryNudge(ctx.emptyReplyRetries) });
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
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
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: `回复为空或过短，第 ${ctx.emptyReplyRetries} 次要求重试`,
      },
    });
    return { action: "continue" };
  }

  // ── 12d: Premature completion retry ──
  if (
    claimsPrematureCompletion(rawContent) &&
    ctx.prematureCompletionRetries < 1 &&
    (userRecentlyReportedFailure || codeReviewRun ||
      userFailureReportRun || sameIssueFollowUpRun)
  ) {
    ctx.prematureCompletionRetries += 1;
    ctx.messages.push({ role: "assistant", content: rawContent });
    ctx.messages.push({ role: "system", content: buildPrematureCompletionRetryNudge() });
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
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
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "过早宣称完成，已要求证据式核对",
      },
    });
    return { action: "continue" };
  }

  // ── 12e: Patch failure completion retry ──
  const failedPatchPaths = [...new Set(ctx.patchFailureLog.map((e) => e.path).filter(Boolean))];
  const successPatchPaths = ctx.writeStage ? writtenStagePaths(ctx.writeStage) : [];
  if (
    !isReadOnlyAgent &&
    ctx.writeStage &&
    ctx.patchFailureLog.length > 0 &&
    claimsSuccessDespitePatchFailures(rawContent, ctx.patchFailureLog.length) &&
    ctx.patchFailureCompletionRetries < 1
  ) {
    ctx.patchFailureCompletionRetries += 1;
    ctx.messages.push({ role: "assistant", content: rawContent });
    ctx.messages.push({
      role: "system",
      content: buildPatchFailureCompletionRetryNudge(failedPatchPaths, successPatchPaths),
    });
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
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
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "存在 patch 失败却宣称完成，已要求如实审计",
      },
    });
    return { action: "continue" };
  }

  // ── 12f: Inject modification audit ──
  if (!isReadOnlyAgent && ctx.writeStage && ctx.patchFailureLog.length > 0) {
    const successCount = ctx.writeStage.writtenList.length;
    const failCount = ctx.patchFailureLog.length;
    const failFiles = [...new Set(ctx.patchFailureLog.map((f) => f.path))].join("、");
    ctx.messages.push({
      role: "system",
      content:
        `【修改审计】本轮会话中：${successCount} 个文件修改成功（${writtenStagePaths(ctx.writeStage).join("、") || "无"}），` +
        `${failCount} 个 patch_file 调用失败（${failFiles}）。` +
        "在最终回复的总结中，只可声称上述成功修改的文件已完成；失败的修改必须如实标注'未生效'或'失败'，禁止虚假声称已完成。",
    });
  }

  // ── 12g: Ghost reply detection ──
  const claimsModification =
    /(?:已完成修改|已更新|已修复|已添加|已删除|已改为|已改成|改动如下|优化完成|修改如下|刷新查看)/i.test(rawContent) &&
    !/以上是|仅供参考|建议|方案|思路/.test(rawContent);
  const noWriteToolsThisTurn =
    ctx.writeStage !== null &&
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    ctx.writeStage.writtenList.length === 0;
  if (claimsModification && noWriteToolsThisTurn && turn > 1) {
    ctx.messages.push({ role: "assistant", content: rawContent });
    ctx.messages.push({
      role: "system",
      content:
        "【系统强制】你声称已完成修改，但本轮未调用任何 patch_file / write_file 工具，代码实际未被修改。" +
        "请立即调用 patch_file 或 write_file 提交真实的代码修改；禁止只输出文字描述。",
    });
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
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
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "检测到幻觉回复（声称修改但未执行工具），已要求重试",
      },
    });
    return { action: "continue" };
  }

  // ── 12h: Vision consultative locate single-turn ──
  if (visionLocateSingleTurnRun && !ctx.visionLocateToolsUsed && consultativeVisionRun) {
    // Handled in agentTurnVision.ts pre-grep path
    // Falls through to natural termination only if tools were already used
  }

  // ── 12i: Vision consultative locate retry ──
  const appearanceAnswerAfterRead = consultativeAppearanceNeedsVueRead(
    rawContent,
    ctx.toolGuard.grepHitVueFiles ? [...ctx.toolGuard.grepHitVueFiles] : undefined,
    ctx.toolGuard.consultativeReadPaths ?? [],
  );
  const appearanceRetry = consultativeUiAppearanceRun && appearanceAnswerAfterRead;
  if (
    shouldBlockConsultativeVisionLocateFinalize({
      visionConsultative: consultativeVisionRun,
      visionLocateToolsUsed: ctx.visionLocateToolsUsed,
      consultativeReadPaths: ctx.toolGuard.consultativeReadPaths ?? [],
      replyText: rawContent,
      grepHitVueFiles: ctx.toolGuard.grepHitVueFiles ? [...ctx.toolGuard.grepHitVueFiles] : [],
      visionLocateSingleTurn: visionLocateSingleTurnRun,
    }) &&
    ctx.visionConsultativeLocateRetries < 2
  ) {
    ctx.visionConsultativeLocateRetries += 1;
    ctx.messages.push({ role: "assistant", content: rawContent });
    const grepHitVueList = ctx.toolGuard.grepHitVueFiles ? [...ctx.toolGuard.grepHitVueFiles] : [];
    ctx.messages.push({
      role: "system",
      content: appearanceRetry
        ? buildConsultativeUiAppearanceRetryHint(
            ctx.pregrepUniqueFiles.length ? ctx.pregrepUniqueFiles : grepHitVueList,
          )
        : ctx.visionAutoGrepHadMatches && !ctx.visionLocateReadUsed
          ? buildVisionConsultativeReadAfterPrefgrepHint(
              ctx.pregrepUniqueFiles.length ? ctx.pregrepUniqueFiles : grepHitVueList,
            )
          : buildVisionConsultativeLocateRetryHint(ctx.toolGuard.visionAnchorQuotes ?? []),
    });
    if (appearanceAnswerAfterRead || ctx.visionConsultativeLocateRetries >= 2) {
      ctx.consultativeForceAnswerPending = true;
    }
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
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
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "读图后须 grep/read 定位，已要求重试",
      },
    });
    return { action: "continue" };
  }

  // ── 12j: Vision consultative accuracy retry ──
  if (
    !ctx.consultativeForceAnswerPending &&
    shouldBlockConsultativeAccuracyFinalize({
      accuracyConsultative: accuracyConsultativeRun,
      visionLocateToolsUsed: ctx.visionLocateToolsUsed,
      consultativeReadPaths: ctx.toolGuard.consultativeReadPaths ?? [],
      replyText: rawContent,
    }) &&
    ctx.visionConsultativeAccuracyRetries < 2
  ) {
    ctx.visionConsultativeAccuracyRetries += 1;
    ctx.messages.push({ role: "assistant", content: rawContent });
    ctx.messages.push({
      role: "system",
      content: buildConsultativeAccuracyTraceRetryHint(ctx.toolGuard.consultativeReadPaths ?? []),
    });
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
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
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "准确度题须 trace 到 backend prompt 构造，已要求重试",
      },
    });
    return { action: "continue" };
  }

  // ── 12k-pre: Workspace probe artifact cleanup before finish ──
  if (
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    ctx.writeStage
  ) {
    const uncleaned = listUncleanedEphemeralProbeFiles(ctx);
    if (uncleaned.length > 0 && !ctx.workspaceCleanupNudgeSent) {
      ctx.workspaceCleanupNudgeSent = true;
      ctx.messages.push({ role: "assistant", content: rawContent });
      ctx.messages.push({
        role: "system",
        content: buildWorkspaceCleanupNudge(uncleaned),
      });
      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          assistantText: userText,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: false,
        },
      });
      onEvent({
        type: "status",
        data: {
          phase: "workspace_cleanup_retry",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          model,
          detail: "仍有探测临时文件未清理，已要求删除后再完成",
        },
      });
      return { action: "continue" };
    }
  }

  // ── 12k: Behavior purpose trace retry ──
  if (
    behaviorPurposeRun &&
    shouldBlockBehaviorPurposeFinalize({
      behaviorPurpose: true,
      consultativeReadPaths: ctx.toolGuard.consultativeReadPaths ?? [],
      replyText: rawContent,
    }) &&
    ctx.behaviorPurposeRetries < 2
  ) {
    ctx.behaviorPurposeRetries += 1;
    ctx.consultativeForceAnswerPending = false;
    ctx.messages.push({ role: "assistant", content: rawContent });
    ctx.messages.push({
      role: "system",
      content: buildBehaviorPurposeTraceRetryHint(ctx.toolGuard.consultativeReadPaths ?? []),
    });
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        assistantText: userText,
        toolCalls: [],
        hasToolCalls: false,
        isFinal: false,
      },
    });
    onEvent({
      type: "status",
      data: {
        phase: "behavior_purpose_retry",
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "行为目的题须 trace 到事件触发点，已要求重试",
      },
    });
    return { action: "continue" };
  }

  // ── 12k-ui: Consultative UI state / unverified code citation retry ──
  if (
    readOnlyBuildRun &&
    !ctx.consultativeForceAnswerPending &&
    shouldBlockConsultativeUiBehaviorFinalize({
      readOnlyBuildRun: true,
      prompt: cfg.prompt,
      replyText: rawContent,
      consultativeReadPaths: ctx.toolGuard.consultativeReadPaths ?? [],
      consultativeReadFailedPaths: ctx.toolGuard.consultativeReadFailedPaths ?? [],
      visionLocateToolsUsed: ctx.visionLocateToolsUsed,
      grepPatterns: ctx.toolGuard.grepPatterns ?? [],
    }) &&
    ctx.consultativeUiBehaviorRetries < 2
  ) {
    ctx.consultativeUiBehaviorRetries += 1;
    ctx.messages.push({ role: "assistant", content: rawContent });
    ctx.messages.push({
      role: "system",
      content: buildConsultativeUiBehaviorTraceRetryHint(
        ctx.toolGuard.consultativeReadPaths ?? [],
        ctx.toolGuard.consultativeReadFailedPaths ?? [],
      ),
    });
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        assistantText: userText,
        toolCalls: [],
        hasToolCalls: false,
        isFinal: false,
      },
    });
    onEvent({
      type: "status",
      data: {
        phase: "consultative_ui_behavior_retry",
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "UI 状态/代码引用未验证，已要求 trace 后重答",
      },
    });
    return { action: "continue" };
  }

  // ── 12k-pre: Workspace probe artifact cleanup before finish ──
  if (
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    ctx.writeStage
  ) {
    const uncleaned = listUncleanedEphemeralProbeFiles(ctx);
    if (uncleaned.length > 0 && !ctx.workspaceCleanupNudgeSent) {
      ctx.workspaceCleanupNudgeSent = true;
      ctx.messages.push({ role: "assistant", content: rawContent });
      ctx.messages.push({
        role: "system",
        content: buildWorkspaceCleanupNudge(uncleaned),
      });
      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          assistantText: userText,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: false,
        },
      });
      onEvent({
        type: "status",
        data: {
          phase: "workspace_cleanup_retry",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          model,
          detail: "仍有探测临时文件未清理，已要求删除后再完成",
        },
      });
      return { action: "continue" };
    }
  }

  // ── 12m: Finish gate (deterministic critic before delivery) ──
  if (ctx.finishGateRetries < 2) {
    const runtimeProfile = automatedBugFixRun
      ? detectProjectRuntimeProfile(cfg.projectRoot)
      : null;
    const finishGate = evaluateFinishGate({
      rawContent,
      writeStage: ctx.writeStage,
      isReadOnlyAgent,
      isPlanExplore,
      readOnlyBuildRun,
      isExecutePlan,
      implementFollowUpRun,
      targetFiles,
      taskPrompt,
      automatedBugFixRun,
      verifyScriptAvailable: Boolean(runtimeProfile?.verifyScript),
      lastVerifyRunSucceeded: ctx.lastVerifyRunSucceeded,
    });
    if (finishGate.blocked) {
      ctx.finishGateRetries += 1;
      ctx.messages.push({ role: "assistant", content: rawContent });
      ctx.messages.push({
        role: "system",
        content: buildFinishGateRetryNudge(finishGate),
      });
      onEvent({
        type: "turn_response",
        data: {
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          assistantText: userText,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: false,
        },
      });
      onEvent({
        type: "status",
        data: {
          phase: "finish_gate_retry",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          model,
          detail: finishGate.violations.map((v) => v.detail).join("；"),
        },
      });
      return { action: "continue" };
    }
  }

  // ── 12l: Natural termination ──
  onEvent({
    type: "turn_response",
    data: {
      turn,
      ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
      assistantText: userText,
      toolCalls: [],
      hasToolCalls: false,
      isFinal: true,
    },
  });
  ctx.messages.push({ role: "assistant", content: rawContent });
  emitUserVisibleAssistantMessage(onEvent, rawContent, streamedChars);
  onEvent({
    type: "status",
    data: { phase: "finished", turn },
  });
  onEvent({ type: "done", data: buildDoneData(ctx.writeStage, turn, ctx.outputTruncated) });
  return { action: "return" };
}
