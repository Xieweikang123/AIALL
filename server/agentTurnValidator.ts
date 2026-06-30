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
import { buildAgentStepClarifyContinueHint } from "../src/services/agentUserIntent";
import {
  buildEmptyReplyRetryNudge,
  buildPrematureCompletionRetryNudge,
  buildPatchFailureCompletionRetryNudge,
  buildPatchAnchorForcePatchNudge,
  buildUiDefectForcePatchNudge,
  buildBuildExploreForcePatchNudge,
  buildExploreForceReportNudge,
  buildSameIssueFollowUpForceSummaryNudge,
} from "./agentExplorationBudget";
import {
  shouldBlockConsultativeVisionLocateFinalize,
  buildVisionConsultativeLocateRetryHint,
  buildConsultativeUiAppearanceRetryHint,
  buildConsultativeAppearanceAnswerAfterReadHint,
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
import { buildSearchFilesEmptyHint } from "./agentAskPrompt";
import { markAnchorLocated, markTeleportBodyConfirmed, recordPatchFailure, listUncleanedEphemeralProbeFiles } from "./agentTurnContext";
import { buildWorkspaceCleanupNudge } from "../shared/agentProbeGuard";

export interface ValidationParams {
  turn: number;
  isReadOnlyAgent: boolean;
  isPlanExplore: boolean;
  readOnlyBuildRun: boolean;
  isAsk: boolean;
  isExplore: boolean;
  implementFollowUpRun: boolean;
  sameIssueFollowUpRun: boolean;
  codeReviewRun: boolean;
  userFailureReportRun: boolean;
  userRecentlyReportedFailure: boolean;
  uiDefectBuildRun: boolean;
  agentStepClarifyRun: boolean;
  accuracyConsultativeRun: boolean;
  consultativeVisionRun: boolean;
  behaviorPurposeRun: boolean;
  consultativeUiAppearanceRun: boolean;
  visionLocateSingleTurnRun: boolean;
  model: string;
  rawContent: string;
  visibleContent: string;
  toolCalls: ChatToolCall[];
  streamedChars: number;
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
  const { turn, rawContent, visibleContent, toolCalls, streamedChars, model } = params;
  const userText = sanitizeAgentUserVisibleText(visibleContent.trim());

  const mustPatchBeforeFinish =
    ctx.writeStage !== null &&
    !params.isReadOnlyAgent &&
    !params.isPlanExplore &&
    !params.readOnlyBuildRun &&
    ctx.writeStage.writtenList.length === 0 &&
    (params.implementFollowUpRun || (ctx.patchAnchorLocated && ctx.patchAnchorForcePending));

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
    if (params.uiDefectBuildRun || ctx.patchAnchorLocated || ctx.patchAnchorForcePending) {
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
    (params.userRecentlyReportedFailure || params.codeReviewRun ||
      params.userFailureReportRun || params.sameIssueFollowUpRun)
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
  const successPatchPaths = ctx.writeStage?.writtenList.map((e) => e.key).filter(Boolean) ?? [];
  if (
    !params.isReadOnlyAgent &&
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
  if (!params.isReadOnlyAgent && ctx.writeStage && ctx.patchFailureLog.length > 0) {
    const successCount = ctx.writeStage.writtenList.length;
    const failCount = ctx.patchFailureLog.length;
    const failFiles = [...new Set(ctx.patchFailureLog.map((f) => f.path))].join("、");
    ctx.messages.push({
      role: "system",
      content:
        `【修改审计】本轮会话中：${successCount} 个文件修改成功（${ctx.writeStage.writtenList.map((w) => w.key).join("、") || "无"}），` +
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
    !params.isReadOnlyAgent &&
    !params.isPlanExplore &&
    !params.readOnlyBuildRun &&
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
  if (params.visionLocateSingleTurnRun && !ctx.visionLocateToolsUsed && params.consultativeVisionRun) {
    // Handled in agentTurnVision.ts pre-grep path
    // Falls through to natural termination only if tools were already used
  }

  // ── 12i: Vision consultative locate retry ──
  const appearanceAnswerAfterRead = consultativeAppearanceNeedsVueRead(
    rawContent,
    ctx.toolGuard.grepHitVueFiles ? [...ctx.toolGuard.grepHitVueFiles] : undefined,
    ctx.toolGuard.consultativeReadPaths ?? [],
  );
  const appearanceRetry = params.consultativeUiAppearanceRun && appearanceAnswerAfterRead;
  if (
    shouldBlockConsultativeVisionLocateFinalize({
      visionConsultative: params.consultativeVisionRun,
      visionLocateToolsUsed: ctx.visionLocateToolsUsed,
      consultativeReadPaths: ctx.toolGuard.consultativeReadPaths ?? [],
      replyText: rawContent,
      grepHitVueFiles: ctx.toolGuard.grepHitVueFiles ? [...ctx.toolGuard.grepHitVueFiles] : [],
      visionLocateSingleTurn: params.visionLocateSingleTurnRun,
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
      accuracyConsultative: params.accuracyConsultativeRun,
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

  // ── 12k: Behavior purpose trace retry ──
  if (
    params.behaviorPurposeRun &&
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

  // ── 12k-pre: Workspace probe artifact cleanup before finish ──
  if (
    !params.isReadOnlyAgent &&
    !params.isPlanExplore &&
    !params.readOnlyBuildRun &&
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
