import type { VibeAgentEvent } from "../shared/agentTypes";
import type { AgentTurnContext } from "./agentTurnContext";
import { syncToolGuard, isPlanTextOnlyFollowUpRun } from "./agentTurnContext";
import { AGENT_SAFETY_MAX_TURNS, buildAgentTurnsLowNudge } from "../shared/agentTurnBudget";
import {
  EXPLORE_MAX_TOTAL_EXPLORE_HARD,
  EXPLORE_MAX_TOTAL_EXPLORE_SOFT,
  ASK_MAX_TOTAL_EXPLORE_HARD,
  ASK_MAX_TOTAL_EXPLORE_SOFT,
  PLAN_MAX_TOTAL_EXPLORE_HARD,
  PLAN_MAX_TOTAL_EXPLORE_SOFT,
  EXPLORE_INTERIM_DIAGNOSIS_TURN,
  MAX_UNIQUE_READ_FILES_BEFORE_NUDGE,
  isProductiveWritePath,
  buildAskForceAnswerNudge,
  buildAskExploreSoftCapNudge,
  buildBuildExploreForcePatchNudge,
  buildExploreExploreSoftCapNudge,
  buildExploreForceReportNudge,
  buildExploreInterimDiagnosisNudge,
  buildExploreSoftCapNudge,
  buildFileBreadthNudge,
  buildForceOutputNudge,
  buildPlanForceAnswerNudge,
  buildPatchAnchorForcePatchNudge,
  buildSameIssueFollowUpForceSummaryNudge,
  buildUiDefectForcePatchNudge,
  buildUserNegationNudge,
} from "../shared/agentExplorationBudget";
import { buildExploreAbortPartialReportNudge } from "../src/orchestration/product/agentExplorePrompt";
import { detectUserNegation } from "../src/services/agentContinuation";
import { buildDoneData } from "./agentClassifier";
import { shouldForcePatchAfterAnchorLocated } from "./agentExploreGuard";
import type { ChatCompletionMessage } from "./aiForward";

/**
 * Run the turn preflight phase — safety checks, abort handling, nudges,
 * exploration restriction, and tool selection (Blocks 1–9 of the turn loop).
 *
 * Returns the tools available to the model for this turn and a control-flow action.
 */
export function runTurnPreflight(
  ctx: AgentTurnContext,
  turn: number,
  activeTools: { type: "function"; function: { name: string; description: string; parameters: object } }[],
  onEvent: (event: VibeAgentEvent) => void,
  signal?: AbortSignal,
): { action: "return" | "next"; toolsForTurn: typeof activeTools } {
  const cfg = ctx.runConfig;
  const p = cfg.runPolicy;
  const {
    isReadOnlyAgent,
    isPlanExplore,
    isExecutePlan,
    isAsk,
    isExplore,
    mode,
    nudgeMode,
    prompt,
    model,
  } = cfg;
  const { readOnlyBuildRun, exploreHardCap, exploreSoftCap, implementFollowUpRun, sameIssueFollowUpRun, uiDefectBuildRun } = p;

  // ── Block 1: Safety hard cap ──
  if (turn > AGENT_SAFETY_MAX_TURNS) {
    onEvent({
      type: "status",
      data: { phase: "finished", turn: AGENT_SAFETY_MAX_TURNS, maxTurns: AGENT_SAFETY_MAX_TURNS },
    });
    onEvent({
      type: "error",
      data: { message: `已达安全上限（${AGENT_SAFETY_MAX_TURNS} 轮），任务可能未完成。` },
    });
    onEvent({ type: "done", data: buildDoneData(ctx.writeStage, AGENT_SAFETY_MAX_TURNS) });
    return { action: "return", toolsForTurn: [] };
  }

  // ── Block 2: Abort signal ──
  if (signal?.aborted) {
    if (isExplore && !ctx.exploreAbortGraceTurnActive) {
      ctx.exploreAbortGraceTurnActive = true;
      onEvent({
        type: "status",
        data: {
          phase: "aborted",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
          model,
          detail: "正在整理不完整知识库…",
        },
      });
      ctx.segmentMaxTurns = Math.max(ctx.segmentMaxTurns ?? 0, turn + 1);
    } else {
      onEvent({
        type: "status",
        data: {
          phase: "aborted",
          turn,
          ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        },
      });
      onEvent({ type: "done", data: buildDoneData(ctx.writeStage, turn - 1) });
      return { action: "return", toolsForTurn: [] };
    }
  }

  // ── Block 3: Turns-low nudge ──
  if (
    !isReadOnlyAgent &&
    !readOnlyBuildRun &&
    ctx.segmentMaxTurns !== undefined &&
    !ctx.turnsLowNudgeSent &&
    turn >= ctx.segmentMaxTurns - 3
  ) {
    ctx.messages.push({
      role: "system",
      content: buildAgentTurnsLowNudge(turn, ctx.segmentMaxTurns, nudgeMode, isExecutePlan && mode === "plan"),
    });
    ctx.turnsLowNudgeSent = true;
  }

  // ── Block 4: User negation detection ──
  if (!isReadOnlyAgent && !isPlanExplore && prompt && detectUserNegation(prompt)) {
    ctx.consecutiveUserNegations += 1;
  } else if (prompt) {
    ctx.consecutiveUserNegations = 0;
    ctx.negationNudgeSent = false;
  }
  if (
    !ctx.negationNudgeSent &&
    ctx.consecutiveUserNegations >= 2 &&
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun
  ) {
    ctx.messages.push({
      role: "system",
      content: buildUserNegationNudge(ctx.consecutiveUserNegations),
    });
    ctx.negationNudgeSent = true;
  }

  // ── Block 5: Sync toolGuard + exploration restriction ──
  syncToolGuard(ctx);

  const buildExploreHardCapReached =
    !isReadOnlyAgent && !isPlanExplore && !readOnlyBuildRun && ctx.totalExploreTurns >= exploreHardCap;
  const sameIssueFollowUpNeedsSummary =
    sameIssueFollowUpRun &&
    buildExploreHardCapReached &&
    ctx.writeStage !== null &&
    !ctx.writeStage.writtenList.some((p) => isProductiveWritePath(p));
  const forcePatchOutput =
    !sameIssueFollowUpNeedsSummary &&
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    ctx.writeStage !== null &&
    (buildExploreHardCapReached ||
      shouldForcePatchAfterAnchorLocated(
        ctx.patchAnchorLocated,
        ctx.patchAnchorForcePending,
        buildExploreHardCapReached,
        implementFollowUpRun,
      ));
  const forceTextOutput =
    !forcePatchOutput &&
    (sameIssueFollowUpNeedsSummary ||
      (isExplore && ctx.exploreAbortGraceTurnActive) ||
      (isExplore && ctx.totalExploreTurns >= EXPLORE_MAX_TOTAL_EXPLORE_HARD) ||
      (isAsk && ctx.totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_HARD) ||
      (isPlanExplore &&
        !isPlanTextOnlyFollowUpRun(ctx) &&
        (ctx.consultativeForceAnswerPending ||
          ctx.totalExploreTurns >= PLAN_MAX_TOTAL_EXPLORE_HARD)) ||
      (readOnlyBuildRun && ctx.totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_HARD));
  const stripWideSearch =
    !forceTextOutput &&
    !forcePatchOutput &&
    ((isExplore && ctx.totalExploreTurns >= EXPLORE_MAX_TOTAL_EXPLORE_SOFT) ||
      (isAsk && ctx.totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_SOFT) ||
      (isPlanExplore && !isPlanTextOnlyFollowUpRun(ctx) && ctx.totalExploreTurns >= PLAN_MAX_TOTAL_EXPLORE_SOFT) ||
      (readOnlyBuildRun && ctx.totalExploreTurns >= ASK_MAX_TOTAL_EXPLORE_SOFT) ||
      (!isReadOnlyAgent && !isPlanExplore && !readOnlyBuildRun && ctx.totalExploreTurns >= exploreSoftCap));

  // ── Block 5c: Inject nudges based on exploration flags ──
  if (forcePatchOutput && !ctx.uiDefectForcePatchNudgeSent && buildExploreHardCapReached && uiDefectBuildRun) {
    ctx.messages.push({
      role: "system",
      content: buildUiDefectForcePatchNudge(ctx.totalExploreTurns),
    });
    ctx.uiDefectForcePatchNudgeSent = true;
  } else if (
    forcePatchOutput &&
    buildExploreHardCapReached &&
    !ctx.buildExploreForcePatchNudgeSent &&
    !uiDefectBuildRun &&
    !ctx.patchAnchorForcePending
  ) {
    ctx.messages.push({
      role: "system",
      content: buildBuildExploreForcePatchNudge(ctx.totalExploreTurns),
    });
    ctx.buildExploreForcePatchNudgeSent = true;
  } else if (forcePatchOutput && ctx.patchAnchorForcePending && !ctx.patchAnchorForcePatchNudgeSent) {
    ctx.messages.push({
      role: "system",
      content: buildPatchAnchorForcePatchNudge(),
    });
    ctx.patchAnchorForcePatchNudgeSent = true;
  } else if (forceTextOutput) {
    ctx.messages.push({
      role: "system",
      content: sameIssueFollowUpNeedsSummary
        ? buildSameIssueFollowUpForceSummaryNudge(ctx.totalExploreTurns)
        : isExplore
          ? ctx.exploreAbortGraceTurnActive
            ? buildExploreAbortPartialReportNudge(ctx.exploreFilesRead.size)
            : buildExploreForceReportNudge(ctx.totalExploreTurns)
          : isPlanExplore
            ? isPlanTextOnlyFollowUpRun(ctx)
              ? buildAskForceAnswerNudge(ctx.totalExploreTurns)
              : buildPlanForceAnswerNudge(ctx.totalExploreTurns)
            : isReadOnlyAgent || readOnlyBuildRun
              ? buildAskForceAnswerNudge(ctx.totalExploreTurns)
              : buildForceOutputNudge(ctx.totalExploreTurns, mode),
    });
  } else if (stripWideSearch) {
    ctx.messages.push({
      role: "system",
      content: isExplore
        ? buildExploreExploreSoftCapNudge(ctx.totalExploreTurns)
        : isReadOnlyAgent || readOnlyBuildRun
          ? buildAskExploreSoftCapNudge(ctx.totalExploreTurns)
          : buildExploreSoftCapNudge(ctx.totalExploreTurns, mode),
    });
  }

  // ── Block 6: File breadth nudge ──
  if (!ctx.fileBreadthNudgeSent && ctx.exploreFilesRead.size >= MAX_UNIQUE_READ_FILES_BEFORE_NUDGE) {
    const files = Array.from(ctx.exploreFilesRead);
    ctx.messages.push({ role: "system", content: buildFileBreadthNudge(files, mode) });
    ctx.fileBreadthNudgeSent = true;
  }

  // ── Block 7: Interim diagnosis nudge ──
  if (
    !ctx.interimDiagnosisNudgeSent &&
    !isReadOnlyAgent &&
    !isPlanExplore &&
    ctx.writeStage !== null &&
    ctx.totalExploreTurns >= EXPLORE_INTERIM_DIAGNOSIS_TURN
  ) {
    ctx.messages.push({
      role: "system",
      content: buildExploreInterimDiagnosisNudge(ctx.writeStage.writtenList.map((w) => w.key)),
    });
    ctx.interimDiagnosisNudgeSent = true;
  }

  // ── Block 8: Status emission ──
  onEvent({
    type: "status",
    data: {
      phase: ctx.visionFirstTurnPending ? "vision_first_turn" : "waiting_model",
      turn,
      ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
      model,
    },
  });

  // ── Block 9: Tool selection ──
  const toolsForTurn: typeof activeTools = (() => {
    if (ctx.visionFirstTurnPending || forceTextOutput || ctx.consultativeForceAnswerPending || ctx.agentStepClarifyPending || ctx.ambiguousTermClarificationPending) {
      return [];
    }
    if (forcePatchOutput) {
      // Keep only write tools
      return activeTools.filter(
        (t) => {
          const name = t.function.name;
          return name === "patch_file" || name === "write_file" ||
            name === "read_file" || name === "list_dir" ||
            name === "search_files" || name === "grep" ||
            name === "run_command" || name === "web_search" || name === "web_extract";
        },
      );
    }
    if (stripWideSearch) {
      return activeTools.filter(
        (t) => !["grep", "search_files", "run_command", "web_search", "web_extract"].includes(t.function.name),
      );
    }
    return activeTools;
  })();

  return { action: "next", toolsForTurn };
}
