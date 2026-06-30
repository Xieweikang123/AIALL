import type { ChatToolCall } from "./aiForward";
import type { VibeAgentEvent } from "../shared/agentTypes";
import type { AgentTurnContext } from "./agentTurnContext";
import { emitUserVisibleAssistantMessage } from "./agentStream";
import { isUiAppearanceQuestionPrompt } from "../src/orchestration/generic/userIntentClassifiers";
import {
  isAdequateVisionFirstTurnDescription,
  buildConsultativeUiAppearanceHint,
  buildVisionBuildContinueHint,
  buildVisionConsultativeContinueHint,
  buildVisionConsultativeLocateRetryHint,
  buildConsultativeUiAppearanceRetryHint,
  buildConsultativeAppearanceAnswerAfterReadHint,
  buildConsultativeVisibleShellEmptyInnerHint,
  extractVisibleAnchorQuotes,
  buildVisionFirstTurnRetryHint,
  buildVisionFirstTurnPrematureCompletionRetryHint,
  suggestsEmbeddedLayoutMisread,
  shouldRunVisionAnchorPrefgrep,
  suggestsVisibleShellEmptyInner,
  consultativeAppearanceNeedsVueRead,
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
import { buildSearchFilesEmptyHint } from "./agentAskPrompt";

export interface VisionTurnParams {
  visibleContent: string;
  toolCalls: ChatToolCall[];
  streamedChars: number;
}

/**
 * Handle vision-first-turn description and consultative vision retries (Block 11).
 */
export async function runTurnVision(
  ctx: AgentTurnContext,
  params: VisionTurnParams,
  onEvent: (event: VibeAgentEvent) => void,
): Promise<{ action: "continue" | "next" }> {
  const cfg = ctx.runConfig;
  const p = cfg.runPolicy;
  const { visibleContent, toolCalls, streamedChars } = params;
  const {
    consultativeVisionRun,
    accuracyConsultativeRun,
    behaviorPurposeRun,
    consultativeUiAppearanceRun,
    uiDefectBuildRun,
  } = p;
  const {
    isReadOnlyAgent,
    isPlanExplore,
    projectRoot,
    prompt,
    imageDataUrls,
    model,
    visionLocateSingleTurnRun,
  } = cfg;
  const { readOnlyBuildRun } = p;
  const turn = ctx.turn;

  if (!ctx.visionFirstTurnPending && !visionLocateSingleTurnRun) {
    return { action: "next" };
  }

  const completeVisionFirstTurn = (text: string, isFinalTurn: boolean) => {
    onEvent({
      type: "turn_response",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        assistantText: text,
        toolCalls: [],
        hasToolCalls: false,
        isFinal: isFinalTurn,
      },
    });
    if (text && !streamedChars) {
      emitUserVisibleAssistantMessage(onEvent, text, streamedChars);
    }
    ctx.messages.push({ role: "assistant", content: text });
  };

  if (ctx.visionFirstTurnPending) {
    const text = visibleContent.trim();
    if (toolCalls.length) {
      onEvent({
        type: "turn_trace",
        data: {
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          toolCallPreamble: text,
          toolCallPreambleSubstantive: false,
        },
      });
    }

    if (!isAdequateVisionFirstTurnDescription(text, prompt)) {
      ctx.visionFirstTurnRetries += 1;
      if (ctx.visionFirstTurnRetries >= 2) {
        ctx.visionFirstTurnPending = false;
        ctx.messages.push({
          role: "system",
          content: "首轮读图描述不充分，已跳过多轮读图重试，请直接根据已有信息继续。",
        });
        onEvent({
          type: "status",
          data: {
            phase: "vision_first_turn_skipped",
            turn,
            ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
            model,
            detail: "读图描述不充分，跳过重试，请根据已有信息继续",
          },
        });
        return { action: "continue" };
      }
      ctx.messages.push({
        role: "system",
        content: buildVisionFirstTurnRetryHint(
          ctx.visionFirstTurnRetries,
          ctx.visionFirstTurnRetries >= 2,
          prompt,
        ),
      });
      completeVisionFirstTurn(text, false);
      onEvent({
        type: "status",
        data: {
          phase: "vision_first_turn_retry",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          model,
          detail: `读图描述不充分，第 ${ctx.visionFirstTurnRetries} 次重试…`,
        },
      });
      return { action: "continue" };
    }

    // Successful first turn
    ctx.visionFirstTurnPending = false;
    ctx.visionFirstTurnDescriptionText = text;
    completeVisionFirstTurn(text, false);
    ctx.toolGuard.visionMisreadActive = suggestsEmbeddedLayoutMisread(text);
    ctx.toolGuard.visionAnchorQuotes = extractVisibleAnchorQuotes(text);
    ctx.toolGuard.visionNarrativeText = text;
    ctx.toolGuard.visionLocateActive = ctx.toolGuard.visionAnchorQuotes.length > 0 || imageDataUrls.length > 0;

    if (consultativeVisionRun) {
      if (isUiAppearanceQuestionPrompt(prompt)) {
        ctx.messages.push({ role: "system", content: buildConsultativeUiAppearanceHint() });
      }
      if (
        shouldRunVisionAnchorPrefgrep({
          consultativeVisionRun,
          prompt,
          anchorQuotes: ctx.toolGuard.visionAnchorQuotes,
        })
      ) {
        onEvent({
          type: "status",
          data: {
            phase: "vision_anchor_prefgrep",
            turn,
            ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
            model,
            detail: "读图完成，正在按锚点搜索源码…",
          },
        });
        const pregrep = await appendVisionAnchorPrefgrepMessages(
          projectRoot,
          ctx.toolGuard.visionAnchorQuotes,
          ctx.messages,
        );
        ctx.pregrepUniqueFiles = pregrep.uniqueFiles;
        if (pregrep.hadMatches) {
          ctx.visionAutoGrepHadMatches = true;
          ctx.visionLocateToolsUsed = true;
        }
      } else {
        ctx.messages.push({ role: "system", content: buildVisionConsultativeContinueHint() });
      }
      if (suggestsVisibleShellEmptyInner(text)) {
        ctx.messages.push({ role: "system", content: buildConsultativeVisibleShellEmptyInnerHint() });
      }
      if (accuracyConsultativeRun) {
        ctx.messages.push({ role: "system", content: buildConsultativeAccuracyTraceHint() });
      }
      if (ctx.segmentMaxTurns !== undefined && !accuracyConsultativeRun) {
        ctx.segmentMaxTurns = Math.min(ctx.segmentMaxTurns, turn + 4);
      }
    } else {
      ctx.messages.push({ role: "system", content: buildVisionBuildContinueHint(text, prompt) });
    }
    onEvent({
      type: "status",
      data: {
        phase: "vision_first_turn_done",
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: consultativeVisionRun ? "读图描述完成，准备简要核对后回答" : "读图描述完成，开始定位与修改",
      },
    });
    return { action: "continue" };
  }

  // ── Vision locate single-turn (no tool calls path) ──
  if (!toolCalls.length && visionLocateSingleTurnRun) {
    const text = visibleContent.trim();
    const userText = text;

    if (!ctx.visionLocateToolsUsed && consultativeVisionRun) {
      if (!ctx.toolGuard.visionAnchorQuotes?.length) {
        ctx.toolGuard.visionAnchorQuotes = extractVisibleAnchorQuotes(text);
        ctx.toolGuard.visionLocateActive = true;
        ctx.toolGuard.visionNarrativeText = text;
      }
      if (
        ctx.toolGuard.visionAnchorQuotes.length > 0 &&
        shouldRunVisionAnchorPrefgrep({
          consultativeVisionRun,
          prompt,
          anchorQuotes: ctx.toolGuard.visionAnchorQuotes,
        })
      ) {
        onEvent({
          type: "status",
          data: {
            phase: "vision_anchor_prefgrep",
            turn,
            ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
            model,
            detail: "读图完成，正在按锚点搜索源码…",
          },
        });
        const pregrep = await appendVisionAnchorPrefgrepMessages(
          projectRoot,
          ctx.toolGuard.visionAnchorQuotes,
          ctx.messages,
        );
        ctx.pregrepUniqueFiles = pregrep.uniqueFiles;
        ctx.visionAutoGrepHadMatches = true;
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
          phase: "vision_consultative_locate_single_turn",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          model,
          detail: "单轮读图定位需要 grep 确认，已继续",
        },
      });
      return { action: "continue" };
    }
  }

  return { action: "next" };
}
