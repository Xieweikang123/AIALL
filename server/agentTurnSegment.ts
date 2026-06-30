import type { VibeAgentEvent } from "../shared/agentTypes";
import type { AgentTurnContext } from "./agentTurnContext";
import { isPlanTextOnlyFollowUpRun } from "./agentTurnContext";
import { buildDoneData } from "./agentClassifier";
import {
  AGENT_SAFETY_MAX_TURNS,
  buildSegmentContinueNudge,
  buildTurnCapFinalSummaryNudge,
  buildTurnCapExhaustedMessage,
  extendSegmentMaxTurns,
} from "./agentTurnBudget";
import {
  buildExploreForceReportNudge,
  buildAskForceAnswerNudge,
  buildConsultativeSegmentCapNudge,
  buildPlanSegmentCapNudge,
  buildPlanForceAnswerNudge,
  buildSegmentEmergencyFinishNudge,
  EXPLORE_MAX_TOTAL_EXPLORE_SOFT,
  ASK_MAX_TOTAL_EXPLORE_SOFT,
  PLAN_MAX_TOTAL_EXPLORE_SOFT,
} from "./agentExplorationBudget";

/**
 * Handle turn-cap emergency nudges and segment boundary (Blocks 18–19).
 */
export function handleTurnSegment(
  ctx: AgentTurnContext,
  onEvent: (event: VibeAgentEvent) => void,
): { action: "return" | "continue" | "next" } {
  const cfg = ctx.runConfig;
  const p = cfg.runPolicy;
  const {
    isReadOnlyAgent,
    isExplore,
    isPlanExplore,
    isExecutePlan,
    mode,
    nudgeMode,
    segmentBudget,
    model,
  } = cfg;
  const { readOnlyBuildRun } = p;
  const turn = ctx.turn;

  // ── Block 18: Turn cap emergency finish nudge ──
  if (
    !readOnlyBuildRun &&
    !isExplore &&
    !isPlanExplore &&
    ctx.segmentMaxTurns !== undefined &&
    turn >= ctx.segmentMaxTurns - 3 &&
    turn < ctx.segmentMaxTurns
  ) {
    const remaining = ctx.segmentMaxTurns - turn;
    ctx.messages.push({
      role: "system",
      content: buildSegmentEmergencyFinishNudge(remaining),
    });
  }

  // ── Block 19: Segment max turns reached ──
  if (ctx.segmentMaxTurns !== undefined && turn >= ctx.segmentMaxTurns) {
    // 19a: Safety cap
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
      onEvent({ type: "done", data: buildDoneData(ctx.writeStage, turn, ctx.outputTruncated) });
      return { action: "return" };
    }

    // 19b: Read-only / explore / plan segment cap
    if (readOnlyBuildRun || isExplore || isPlanExplore) {
      ctx.messages.push({
        role: "system",
        content: isExplore
          ? buildExploreForceReportNudge(Math.max(ctx.totalExploreTurns, EXPLORE_MAX_TOTAL_EXPLORE_SOFT))
          : isPlanExplore
            ? buildPlanSegmentCapNudge(turn, ctx.totalExploreTurns)
            : buildConsultativeSegmentCapNudge(turn, ctx.totalExploreTurns),
      });
      if (!isExplore && !isPlanExplore) {
        ctx.messages.push({
          role: "system",
          content: buildAskForceAnswerNudge(Math.max(ctx.totalExploreTurns, ASK_MAX_TOTAL_EXPLORE_SOFT)),
        });
      }
      if (isPlanExplore && !isPlanTextOnlyFollowUpRun(ctx)) {
        ctx.messages.push({
          role: "system",
          content: buildPlanForceAnswerNudge(Math.max(ctx.totalExploreTurns, PLAN_MAX_TOTAL_EXPLORE_SOFT)),
        });
      } else if (isPlanExplore && isPlanTextOnlyFollowUpRun(ctx)) {
        ctx.messages.push({
          role: "system",
          content: buildAskForceAnswerNudge(Math.max(ctx.totalExploreTurns, ASK_MAX_TOTAL_EXPLORE_SOFT)),
        });
      }
      ctx.segmentMaxTurns = turn + 1;
      ctx.consultativeForceAnswerPending = true;
      onEvent({
        type: "status",
        data: {
          phase: isExplore ? "explore_segment_cap" : isPlanExplore ? "plan_segment_cap" : "consultative_segment_cap",
          turn,
          maxTurns: ctx.segmentMaxTurns,
          model,
          detail: isExplore
            ? "探索已达段内轮次上限，须输出项目报告"
            : isPlanExplore
              ? "规划已达段内轮次上限，须输出修改方案"
              : "咨询只读已达段内轮次上限，须输出结论",
        },
      });
      return { action: "continue" };
    }

    // 19c: Final summary attempt 1-2
    if (!isReadOnlyAgent && ctx.turnCapFinalSummaryAttempts < 2) {
      ctx.turnCapFinalSummaryAttempts += 1;
      ctx.messages.push({
        role: "system",
        content: buildTurnCapFinalSummaryNudge(
          turn,
          ctx.writeStage?.writtenList.map((entry) => entry.key).filter(Boolean),
          ctx.turnCapFinalSummaryAttempts,
        ),
      });
      ctx.segmentMaxTurns = turn + 1;
      ctx.consultativeForceAnswerPending = true;
      onEvent({
        type: "status",
        data: {
          phase: "turn_cap_final_summary",
          turn,
          maxTurns: ctx.segmentMaxTurns,
          model,
          detail:
            ctx.turnCapFinalSummaryAttempts >= 2
              ? "段内轮次将尽，最后机会须输出总结"
              : "段内轮次将尽，须输出中文总结",
        },
      });
      return { action: "continue" };
    }

    // 19d: Exhausted — hard exit
    if (!isReadOnlyAgent && ctx.turnCapFinalSummaryAttempts >= 2) {
      onEvent({
        type: "status",
        data: { phase: "finished", turn, maxTurns: ctx.segmentMaxTurns },
      });
      onEvent({
        type: "error",
        data: { message: buildTurnCapExhaustedMessage(turn) },
      });
      onEvent({ type: "done", data: buildDoneData(ctx.writeStage, turn, ctx.outputTruncated) });
      return { action: "return" };
    }

    // 19e: Auto-extend segment
    ctx.segmentIndex += 1;
    ctx.segmentMaxTurns = extendSegmentMaxTurns(turn, segmentBudget);
    ctx.turnsLowNudgeSent = false;
    if (!readOnlyBuildRun && !isExplore && !isPlanExplore) {
      ctx.messages.push({
        role: "system",
        content: buildSegmentContinueNudge(turn, ctx.segmentIndex, nudgeMode, isExecutePlan && mode === "plan"),
      });
    }
    onEvent({
      type: "status",
      data: {
        phase: "continuing",
        turn,
        maxTurns: ctx.segmentMaxTurns,
        detail: `自动续跑第 ${ctx.segmentIndex} 段（累计 ${turn} 轮）…`,
      },
    });
    return { action: "next" };
  }

  return { action: "next" };
}
