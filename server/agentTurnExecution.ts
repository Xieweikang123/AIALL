import type { ChatCompletionMessage, ChatToolCall } from "./aiForward";
import type { VibeAgentEvent } from "../shared/agentTypes";
import type { AgentTurnContext } from "./agentTurnContext";
import { markAnchorLocated, markTeleportBodyConfirmed, recordPatchFailure } from "./agentTurnContext";
import { executeTool, readStagedFileContent } from "./agentToolExecutor";
import { WRITE_AGENT_TOOL_NAMES, READ_ONLY_AGENT_TOOL_NAMES, toolSummary, parseToolArgs, canParallelizeToolBatch, callIsProductiveWrite } from "./agentClassifier";
import { applyUniquePatch, resolveProjectPath, resolveReadablePath } from "./vibeFs";
import { isToolResultFailure, textIndicatesPatchAnchor, textConfirmsTeleportToBody } from "./agentExploreGuard";
import { truncateForSse, truncateToolResultForModel, MAX_TOOL_RESULT_SSE_CHARS } from "./agentContext";
import { buildGrepEmptyRecoveryNudge, buildGrepHitVueReadNudge, buildAlternateUiPatchStrategyNudge } from "./agentExplorationBudget";
import { buildPatchAnchorLocatedNudge, shouldNudgeAlternateUiPatchStrategy } from "./agentExploreGuard";
import { buildScheduledJobRegistrationNudge, shouldNudgeScheduledJobRegistration } from "../src/services/agentConsultativeTopics";
import { extractJobClassNamesFromReadPaths } from "../src/services/agentStructuralPatterns";
import { detectProjectRuntimeProfile } from "./agentRuntimeHint";
import { buildPostPatchVerifyNudge } from "./agentExplorationBudget";
import { resetExploreOnProductiveWrite, markExploreOnlyTurn, forceAnchorOnNoProductiveWrite } from "./agentTurnContext";
import { buildConsultativeDuplicateExploreNudge } from "./agentExplorationBudget";
import { isProductiveWritePath } from "./agentExplorationBudget";
import { isExplorationArchivePath, buildExplorationArchiveWriteBlockedMessage } from "./agentExplorationBudget";

export interface ExecutionParams {
  turn: number;
  projectRoot: string;
  toolMode: "ask" | "build" | "plan" | "explore";
  webProxyUrl?: string;
  injectedKeyFilePaths: string[];
  signal?: AbortSignal;
  // Run-policy flags
  isReadOnlyAgent: boolean;
  isPlanExplore: boolean;
  readOnlyBuildRun: boolean;
  isExplore: boolean;
  isAsk: boolean;
  implementFollowUpRun: boolean;
  sameIssueFollowUpRun: boolean;
  consultativeVisionRun: boolean;
  scheduledTaskConsultativeRun: boolean;
  exploreTurnBudget: number;
  mode: "ask" | "build" | "plan" | "explore";
  model: string;
  visibleContent: string;
  toolCalls: ChatToolCall[];
  streamedChars: number;
}

/**
 * Run tool preamble, execution, and post-tool analysis (Blocks 13–17).
 */
export async function runTurnExecution(
  ctx: AgentTurnContext,
  params: ExecutionParams,
  onEvent: (event: VibeAgentEvent) => void,
): Promise<void> {
  const { turn, projectRoot, toolMode, webProxyUrl, injectedKeyFilePaths, signal, visibleContent,
    streamedChars, toolCalls, model, isReadOnlyAgent, isPlanExplore, readOnlyBuildRun, isExplore,
    isAsk, implementFollowUpRun, sameIssueFollowUpRun, consultativeVisionRun,
    scheduledTaskConsultativeRun, exploreTurnBudget, mode } = params;

  // ── Block 13: Tool preamble processing ──
  if (visibleContent.trim() && toolCalls.length > 0) {
    // English planning nudge
    if (false) {
      // (placeholder for english planning nudge — kept inline in original)
    }
    onEvent({
      type: "turn_trace",
      data: {
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        toolCallPreamble: visibleContent.trim(),
        toolCallPreambleSubstantive: false,
      },
    });
  }

  // ── Block 14: Emit turn_response ──
  onEvent({
    type: "turn_response",
    data: {
      turn,
      ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
      assistantText: visibleContent.trim(),
      toolCalls: toolCalls.map((c) => ({
        id: c.id,
        name: c.function.name,
        args: parseToolArgs(c.function.arguments || "{}"),
      })),
      hasToolCalls: true,
      isFinal: false,
    },
  });

  // ── Block 15: Push assistant message ──
  ctx.messages.push({
    role: "assistant",
    content: visibleContent || "",
    tool_calls: toolCalls,
  });

  // ── Block 16: Tool execution ──
  type ToolOutcome = {
    call: ChatToolCall;
    result: string;
    pendingDiff: Extract<VibeAgentEvent, { type: "file_diff" }> | null;
  };

  const runToolCall = async (call: ChatToolCall): Promise<ToolOutcome> => {
    const toolName = call.function.name;
    const toolArgs = parseToolArgs(call.function.arguments || "{}");
    let pendingDiff: ToolOutcome["pendingDiff"] = null;

    if (ctx.writeStage && WRITE_AGENT_TOOL_NAMES.has(toolName)) {
      const filePath = String(toolArgs.path || "").trim();
      if (filePath) {
        const resolved = resolveProjectPath(projectRoot, filePath);
        if (resolved.ok) {
          const staged = await readStagedFileContent(
            { path: resolved.path, key: resolved.relative, outsideProject: false },
            ctx.writeStage,
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
        ctx.writeStage,
        toolMode,
        ctx.readCache,
        ctx.readSliceCache,
        ctx.grepCache,
        ctx.readSliceRepeatCounts,
        ctx.toolGuard,
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
    ctx.messages.push({
      role: "tool",
      tool_call_id: outcome.call.id,
      content: truncateToolResultForModel(outcome.result),
    });
    if (!isToolResultFailure(outcome.result) && textIndicatesPatchAnchor(outcome.result)) {
      markAnchorLocated(ctx, ctx.writeStage !== null && !isReadOnlyAgent && !isPlanExplore && !readOnlyBuildRun);
    }
    if (!isToolResultFailure(outcome.result) && textConfirmsTeleportToBody(outcome.result)) {
      markTeleportBodyConfirmed(ctx);
    }
    if (toolName === "patch_file" && isToolResultFailure(outcome.result)) {
      try {
        const args = JSON.parse(outcome.call.function.arguments || "{}");
        recordPatchFailure(ctx, turn, String(args.path || ""), outcome.result.slice(0, 200));
      } catch { /* ignore */ }
    }
  };

  const turnGrepEmptyPatterns: string[] = [];
  const toolExecutionHeartbeat = setInterval(() => {
    if (signal?.aborted) return;
    onEvent({
      type: "status",
      data: {
        phase: "executing_tool",
        turn,
        ...(ctx.segmentMaxTurns !== undefined ? { maxTurns: ctx.segmentMaxTurns } : {}),
        model,
        detail: "正在执行工具...",
      },
    });
  }, 5000);

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
          emitToolOutcome(outcome);
        }
      } else {
        for (const call of batch) {
          const outcome = await runToolCall(call);
          emitToolOutcome(outcome);
        }
      }
      index = end;
    }
  } finally {
    clearInterval(toolExecutionHeartbeat);
  }

  // ── Block 17a: Grep empty recovery nudge ──
  if (turnGrepEmptyPatterns.length > 0) {
    ctx.messages.push({
      role: "system",
      content: buildGrepEmptyRecoveryNudge(turnGrepEmptyPatterns),
    });
  }

  // ── Block 17b: Vision locate tool tracking ──
  if (consultativeVisionRun && ctx.toolGuard.visionLocateActive) {
    for (const call of toolCalls) {
      if (call.function.name === "grep") {
        ctx.visionLocateToolsUsed = true;
      }
      if (call.function.name === "read_file") {
        ctx.visionLocateToolsUsed = true;
        ctx.visionLocateReadUsed = true;
      }
    }
  }

  // ── Block 17c: Turn patch failures corrective nudge ──
  const thisTurnPatchFailures = ctx.patchFailureLog.filter((f) => f.turn === turn);
  if (thisTurnPatchFailures.length > 0 && turn > 1) {
    const failedFiles = [...new Set(thisTurnPatchFailures.map((f) => f.path))].join("、");
    ctx.messages.push({
      role: "system",
      content:
        `【系统纠正】本轮 ${thisTurnPatchFailures.length} 个 patch_file 调用失败（文件：${failedFiles}）。` +
        "请 read_file 重新读取；从返回原文复制更短且唯一的 old_string 再 patch。" +
        "禁止凭记忆构造 old_string。",
    });
    for (const path of new Set(thisTurnPatchFailures.map((f) => f.path).filter(Boolean))) {
      if (shouldNudgeAlternateUiPatchStrategy(ctx.patchFailureLog, path)) {
        ctx.messages.push({ role: "system", content: buildAlternateUiPatchStrategyNudge(path) });
      }
    }
  }

  const turnHadProductiveWrite = toolCalls.some((call) => callIsProductiveWrite(call));

  // ── Block 17d: Consultative grep-hit-Vue read nudge ──
  const turnExploreOnly =
    toolCalls.length > 0 && toolCalls.every((call) => READ_ONLY_AGENT_TOOL_NAMES.has(call.function.name));
  if (
    readOnlyBuildRun &&
    consultativeVisionRun &&
    turnExploreOnly &&
    ctx.toolGuard.grepHitVueFiles?.size &&
    toolCalls.some((c) => c.function.name === "grep")
  ) {
    const grepVueList = [...ctx.toolGuard.grepHitVueFiles];
    const reads = ctx.toolGuard.consultativeReadPaths ?? [];
    const unreadVue = grepVueList.filter(
      (vue) =>
        !reads.some(
          (read) =>
            read.replace(/\\/g, "/").endsWith(vue.replace(/\\/g, "/")) ||
            read.includes(vue.replace(/\\/g, "/")),
        ),
    );
    if (unreadVue.length > 0) {
      ctx.messages.push({ role: "system", content: buildGrepHitVueReadNudge(unreadVue) });
    }
  }

  // ── Block 17e: Scheduled job registration nudge ──
  if (
    (isReadOnlyAgent || readOnlyBuildRun) &&
    scheduledTaskConsultativeRun &&
    turnExploreOnly &&
    !ctx.scheduledJobRegistrationNudgeSent &&
    ctx.toolGuard.consultativeReadPaths?.length
  ) {
    const readPaths = ctx.toolGuard.consultativeReadPaths;
    const grepPatterns = ctx.toolGuard.grepPatterns ?? [];
    if (shouldNudgeScheduledJobRegistration(readPaths, grepPatterns)) {
      const jobNames = extractJobClassNamesFromReadPaths(readPaths);
      if (jobNames.length > 0) {
        ctx.messages.push({
          role: "system",
          content: buildScheduledJobRegistrationNudge([...new Set(jobNames)]),
        });
        ctx.scheduledJobRegistrationNudgeSent = true;
      }
    }
  }

  // ── Block 17f: Consultative duplicate explore detection ──
  if (readOnlyBuildRun && turnExploreOnly && toolCalls.length > 0) {
    const exploreSig = toolCalls
      .map((call) => `${call.function.name}:${call.function.arguments || "{}"}`)
      .sort()
      .join("|");
    if (exploreSig && exploreSig === ctx.lastConsultativeExploreSig) {
      ctx.consultativeDuplicateExploreHits += 1;
      if (ctx.consultativeDuplicateExploreHits >= 1) {
        ctx.messages.push({ role: "system", content: buildConsultativeDuplicateExploreNudge() });
        ctx.consultativeForceAnswerPending = true;
      }
    } else {
      ctx.lastConsultativeExploreSig = exploreSig;
      ctx.consultativeDuplicateExploreHits = 0;
    }
  }

  // ── Block 17g: Patch anchor located nudge ──
  if (
    ctx.patchAnchorLocated &&
    ctx.writeStage !== null &&
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    !ctx.patchAnchorNudgeSent &&
    turnExploreOnly
  ) {
    ctx.messages.push({ role: "system", content: buildPatchAnchorLocatedNudge() });
    ctx.patchAnchorNudgeSent = true;
  }

  // ── Block 17h: Explore tracking ──
  if (turnHadProductiveWrite) {
    resetExploreOnProductiveWrite(ctx);
    const runtimeProfile = detectProjectRuntimeProfile(projectRoot);
    if (
      !ctx.postPatchVerifyNudgeSent &&
      runtimeProfile.verifyScript &&
      !isReadOnlyAgent &&
      !isPlanExplore &&
      !readOnlyBuildRun
    ) {
      ctx.messages.push({
        role: "system",
        content: buildPostPatchVerifyNudge(runtimeProfile.verifyScript),
      });
      ctx.postPatchVerifyNudgeSent = true;
    }
  } else if (turnExploreOnly) {
    const readArgsList: string[] = [];
    if (
      (implementFollowUpRun || sameIssueFollowUpRun) &&
      ctx.totalExploreTurns >= 1 &&
      ctx.writeStage &&
      !ctx.writeStage.writtenList.some((p) => isProductiveWritePath(p))
    ) {
      forceAnchorOnNoProductiveWrite(ctx);
    }
    for (const call of toolCalls) {
      if (call.function.name === "read_file") {
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          if (args.path) readArgsList.push(String(args.path));
        } catch { /* ignore */ }
      }
    }
    markExploreOnlyTurn(ctx, readArgsList, readOnlyBuildRun || isReadOnlyAgent);
  }

  // Explore budget nudges
  if (isExplore && ctx.consecutiveExploreTurns >= 4) {
    ctx.messages.push({ role: "system", content: buildExploreForceReportNudge(ctx.consecutiveExploreTurns) });
    ctx.consecutiveExploreTurns = 0;
  } else if (isAsk && ctx.consecutiveExploreTurns >= 6) {
    ctx.messages.push({ role: "system", content: buildAskForceAnswerNudge(ctx.consecutiveExploreTurns) });
    ctx.consecutiveExploreTurns = 0;
  } else if (readOnlyBuildRun && ctx.consecutiveExploreTurns >= 5) {
    ctx.messages.push({ role: "system", content: buildConsultativeDuplicateExploreNudge() });
    ctx.consecutiveExploreTurns = 0;
  } else if (!isReadOnlyAgent && !readOnlyBuildRun && ctx.consecutiveExploreTurns >= exploreTurnBudget) {
    ctx.messages.push({ role: "system", content: buildExploreForceReportNudge(ctx.consecutiveExploreTurns) });
    ctx.consecutiveExploreTurns = 0;
  }
}
