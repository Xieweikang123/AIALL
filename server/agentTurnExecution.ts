import type { ChatCompletionMessage, ChatToolCall } from "./aiForward";
import type { VibeAgentEvent } from "../shared/agentTypes";
import type { AgentTurnContext } from "./agentTurnContext";
import {
  markAnchorLocated,
  markTeleportBodyConfirmed,
  recordPatchFailure,
  isPlanTextOnlyFollowUpRun,
  shouldSkipExploreTurnForRuntimeFailures,
} from "./agentTurnContext";
import { executeTool, readStagedFileContent } from "./agentToolExecutor";
import { WRITE_AGENT_TOOL_NAMES, READ_ONLY_AGENT_TOOL_NAMES, toolSummary, parseToolArgs, canParallelizeToolBatch, callIsProductiveWrite } from "./agentClassifier";
import { applyUniquePatch, resolveProjectPath, resolveReadablePath } from "./vibeFs";
import {
  isRuntimeExploreFailureTurn,
  isToolResultFailure,
  textIndicatesPatchAnchor,
  textConfirmsTeleportToBody,
} from "./agentExploreGuard";
import { truncateForSse, truncateToolResultForModel, MAX_TOOL_RESULT_SSE_CHARS } from "./agentContext";
import {
  buildGrepEmptyRecoveryNudge,
  buildGrepHitVueReadNudge,
  buildAlternateUiPatchStrategyNudge,
  buildRuntimeToolFailureRecoveryNudge,
  buildReadFileFailedRecoveryNudge,
  MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS,
} from "../shared/agentExplorationBudget";
import { buildPatchAnchorLocatedNudge, shouldNudgeAlternateUiPatchStrategy } from "./agentExploreGuard";
import { buildScheduledJobRegistrationNudge, shouldNudgeScheduledJobRegistration } from "../src/services/agentConsultativeTopics";
import { extractJobClassNamesFromReadPaths } from "../src/services/agentStructuralPatterns";
import { detectProjectRuntimeProfile } from "./agentRuntimeHint";
import { buildPostPatchVerifyNudge } from "../shared/agentExplorationBudget";
import { resetExploreOnProductiveWrite, markExploreOnlyTurn, forceAnchorOnNoProductiveWrite, markStructuredAssetAcquired, resetStructuredAssetTracking, trackEphemeralProbeWrite, trackEphemeralProbeDelete } from "./agentTurnContext";
import { isVerifyRunCommand } from "../shared/projectVerifyRun";
import {
  buildAskExploreBudgetNudge,
  buildAskForceAnswerNudge,
  buildConsultativeDuplicateExploreNudge,
  buildExploreBudgetNudge,
  buildExploreExploreBudgetNudge,
  buildPlanListDirOnlySoftNudge,
  isExplorationArchivePath,
  buildExplorationArchiveWriteBlockedMessage,
  isProductiveWritePath,
  isWriteAllowedForAutoBugFix,
  MAX_AUTO_BUG_FIX_WRITES,
} from "../shared/agentExplorationBudget";
import {
  buildStructuredAssetWriteNudge,
  countSchemaTablesInPayload,
  isEphemeralProbePath,
  isProbeExploreToolName,
  isProductiveDeliverableWrite,
  looksLikeStructuredSchemaPayload,
  STRUCTURED_ASSET_PROBE_TURN_BUDGET,
} from "../shared/agentProbeGuard";

export interface ExecutionParams {
  turn: number;
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
  const cfg = ctx.runConfig;
  const p = cfg.runPolicy;
  const { turn, visibleContent, streamedChars, toolCalls } = params;
  const {
    projectRoot,
    toolMode,
    webProxyUrl,
    injectedKeyFilePaths,
    isReadOnlyAgent,
    isPlanExplore,
    isExplore,
    isAsk,
    mode,
    model,
    exploreTurnBudget,
  } = cfg;
  const signal = cfg.signal;
  const {
    readOnlyBuildRun,
    implementFollowUpRun,
    sameIssueFollowUpRun,
    consultativeVisionRun,
    scheduledTaskConsultativeRun,
    automatedBugFixRun,
  } = p;
  const targetFiles = cfg.runProfile.targetFiles ?? [];
  const autoBugFixRuntimeProfile = automatedBugFixRun
    ? detectProjectRuntimeProfile(projectRoot)
    : null;
  const verifyScriptsForRun = autoBugFixRuntimeProfile?.verifyScripts?.length
    ? autoBugFixRuntimeProfile.verifyScripts
    : autoBugFixRuntimeProfile?.verifyScript
      ? [autoBugFixRuntimeProfile.verifyScript]
      : [];

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

    if (
      automatedBugFixRun &&
      (toolName === "patch_file" || toolName === "write_file" || toolName === "delete_file")
    ) {
      const filePath = String(toolArgs.path || "").trim();
      if (toolName !== "delete_file" && filePath) {
        const guardResolved = resolveProjectPath(projectRoot, filePath);
        if (
          guardResolved.ok
          && isProductiveWritePath(guardResolved.relative)
          && !ctx.autoBugFixWrittenFiles.has(guardResolved.relative)
          && ctx.autoBugFixWrittenFiles.size >= MAX_AUTO_BUG_FIX_WRITES
        ) {
          return {
            call,
            result: `错误：扫描修复已达写入上限（${MAX_AUTO_BUG_FIX_WRITES} 个文件），请 run_command 复验或输出总结。`,
            pendingDiff: null,
          };
        }
      }
      if (filePath) {
        const guardResolved = resolveProjectPath(projectRoot, filePath);
        if (guardResolved.ok && !isWriteAllowedForAutoBugFix(guardResolved.relative, targetFiles)) {
          return {
            call,
            result: `错误：扫描修复不允许修改 ${guardResolved.relative}（不在目标文件清单内）。`,
            pendingDiff: null,
          };
        }
      }
    }

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
    if (automatedBugFixRun && toolName === "run_command" && verifyScriptsForRun.length) {
      try {
        const args = parseToolArgs(outcome.call.function.arguments || "{}");
        const cmd = String(args.command ?? args.cmd ?? "").trim();
        if (!cmd || !isVerifyRunCommand(cmd, verifyScriptsForRun)) return;
        const succeeded = !isToolResultFailure(outcome.result);
        const lastVerifyScript = verifyScriptsForRun[verifyScriptsForRun.length - 1];
        const isFinalVerifyStep = isVerifyRunCommand(cmd, [lastVerifyScript]);
        if (!succeeded) {
          ctx.lastVerifyRunSucceeded = false;
        } else if (isFinalVerifyStep) {
          ctx.lastVerifyRunSucceeded = true;
        }
      } catch { /* ignore */ }
    }
    if (
      automatedBugFixRun &&
      !isToolResultFailure(outcome.result) &&
      (toolName === "patch_file" || toolName === "write_file")
    ) {
      try {
        const args = parseToolArgs(outcome.call.function.arguments || "{}");
        const rel = String(args.path || "").replace(/\\/g, "/").trim();
        if (rel && isProductiveWritePath(rel)) {
          ctx.autoBugFixWrittenFiles.add(rel);
        }
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

  const turnOutcomes: ToolOutcome[] = [];
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
          turnOutcomes.push(outcome);
        }
      } else {
        for (const call of batch) {
          const outcome = await runToolCall(call);
          emitToolOutcome(outcome);
          turnOutcomes.push(outcome);
        }
      }
      index = end;
    }

    // ── Block 16b: Track probe artifacts + structured assets from tool results ──
    if (!isReadOnlyAgent && !isPlanExplore && !readOnlyBuildRun) {
      for (const outcome of turnOutcomes) {
        if (isToolResultFailure(outcome.result)) continue;
        const toolName = outcome.call.function.name;
        const toolArgs = parseToolArgs(outcome.call.function.arguments || "{}");
        const filePath = String(toolArgs.path ?? "").trim();

        if (toolName === "write_file" && filePath && isEphemeralProbePath(filePath)) {
          trackEphemeralProbeWrite(ctx, filePath);
          if (looksLikeStructuredSchemaPayload(String(toolArgs.content ?? ""))) {
            markStructuredAssetAcquired(
              ctx,
              turn,
              countSchemaTablesInPayload(String(toolArgs.content ?? "")),
            );
          }
        }
        if (toolName === "delete_file" && filePath && isEphemeralProbePath(filePath)) {
          trackEphemeralProbeDelete(ctx, filePath);
        }
        if (toolName === "read_file" && filePath && isEphemeralProbePath(filePath)) {
          if (looksLikeStructuredSchemaPayload(outcome.result)) {
            markStructuredAssetAcquired(ctx, turn, countSchemaTablesInPayload(outcome.result));
          }
        }
        if (toolName === "run_command" && looksLikeStructuredSchemaPayload(outcome.result)) {
          markStructuredAssetAcquired(ctx, turn, countSchemaTablesInPayload(outcome.result));
        }
      }
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

  const turnReadFailedPaths: string[] = [];
  for (const outcome of turnOutcomes) {
    if (outcome.call.function.name !== "read_file") continue;
    if (!isToolResultFailure(outcome.result)) continue;
    const toolArgs = parseToolArgs(outcome.call.function.arguments || "{}");
    const path = String(toolArgs.path ?? "").trim();
    if (path) turnReadFailedPaths.push(path);
  }
  if (turnReadFailedPaths.length > 0) {
    if (!ctx.toolGuard.consultativeReadFailedPaths) {
      ctx.toolGuard.consultativeReadFailedPaths = [];
    }
    for (const path of turnReadFailedPaths) {
      if (!ctx.toolGuard.consultativeReadFailedPaths.includes(path)) {
        ctx.toolGuard.consultativeReadFailedPaths.push(path);
      }
    }
    ctx.messages.push({
      role: "system",
      content: buildReadFileFailedRecoveryNudge(turnReadFailedPaths),
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
  const turnHadDeliverableWrite = turnOutcomes.some((outcome) => {
    if (isToolResultFailure(outcome.result)) return false;
    const toolName = outcome.call.function.name;
    const toolArgs = parseToolArgs(outcome.call.function.arguments || "{}");
    return isProductiveDeliverableWrite(toolName, String(toolArgs.path ?? ""));
  });

  // ── Block 17i: Structured asset state advancer ──
  if (
    !isReadOnlyAgent &&
    !isPlanExplore &&
    !readOnlyBuildRun &&
    ctx.structuredAssetAcquiredTurn !== null
  ) {
    if (turnHadDeliverableWrite) {
      resetStructuredAssetTracking(ctx);
    } else {
      const turnProbeOnly =
        toolCalls.length > 0 &&
        toolCalls.every((call) => isProbeExploreToolName(call.function.name));
      if (turnProbeOnly) {
        ctx.consecutiveProbeTurnsAfterAsset += 1;
      }
      if (
        !ctx.structuredAssetWriteNudgeSent &&
        ctx.consecutiveProbeTurnsAfterAsset >= STRUCTURED_ASSET_PROBE_TURN_BUDGET
      ) {
        ctx.messages.push({
          role: "system",
          content: buildStructuredAssetWriteNudge(ctx.structuredAssetTableCount),
        });
        ctx.structuredAssetWriteNudgeSent = true;
        ctx.consecutiveProbeTurnsAfterAsset = 0;
      }
    }
  }

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

  // ── Block 17f-pre: Plan list_dir-only soft nudge ──
  if (
    isPlanExplore &&
    !isPlanTextOnlyFollowUpRun(ctx) &&
    !ctx.planPendingAmendRun &&
    turnExploreOnly &&
    toolCalls.every((call) => call.function.name === "list_dir") &&
    ctx.exploreFilesRead.size === 0 &&
    ctx.totalExploreTurns >= 3 &&
    !ctx.planListDirOnlyNudgeSent
  ) {
    ctx.messages.push({
      role: "system",
      content: buildPlanListDirOnlySoftNudge(ctx.totalExploreTurns),
    });
    ctx.planListDirOnlyNudgeSent = true;
  }

  // ── Block 17f: Consultative duplicate explore detection ──
  if ((readOnlyBuildRun || isPlanExplore) && turnExploreOnly && toolCalls.length > 0) {
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
    const runtimeFailureTurn = isRuntimeExploreFailureTurn(turnOutcomes);
    const skipExploreBudget = shouldSkipExploreTurnForRuntimeFailures(ctx, turnOutcomes);
    if (runtimeFailureTurn && skipExploreBudget) {
      ctx.consecutiveRuntimeToolFailureTurns += 1;
      ctx.messages.push({
        role: "system",
        content: buildRuntimeToolFailureRecoveryNudge(ctx.consecutiveRuntimeToolFailureTurns, false),
      });
    } else {
      if (
        runtimeFailureTurn &&
        ctx.consecutiveRuntimeToolFailureTurns >= MAX_CONSECUTIVE_RUNTIME_TOOL_FAILURE_TURNS
      ) {
        ctx.messages.push({
          role: "system",
          content: buildRuntimeToolFailureRecoveryNudge(ctx.consecutiveRuntimeToolFailureTurns, true),
        });
      }
      markExploreOnlyTurn(ctx, readArgsList, readOnlyBuildRun || isReadOnlyAgent);
      ctx.consecutiveRuntimeToolFailureTurns = 0;
    }
  }

  // Explore budget nudges
  if (isExplore && ctx.consecutiveExploreTurns >= 4) {
    ctx.messages.push({ role: "system", content: buildExploreExploreBudgetNudge(ctx.consecutiveExploreTurns) });
    ctx.consecutiveExploreTurns = 0;
  } else if (isAsk && ctx.consecutiveExploreTurns >= 6) {
    ctx.messages.push({ role: "system", content: buildAskForceAnswerNudge(ctx.consecutiveExploreTurns) });
    ctx.consecutiveExploreTurns = 0;
  } else if (readOnlyBuildRun && ctx.consecutiveExploreTurns >= 5) {
    ctx.messages.push({ role: "system", content: buildConsultativeDuplicateExploreNudge() });
    ctx.consecutiveExploreTurns = 0;
  } else if (
    isPlanExplore &&
    !isPlanTextOnlyFollowUpRun(ctx) &&
    turnExploreOnly &&
    ctx.consecutiveExploreTurns >= exploreTurnBudget
  ) {
    ctx.messages.push({
      role: "system",
      content: buildExploreBudgetNudge(ctx.consecutiveExploreTurns, "plan"),
    });
    ctx.consultativeForceAnswerPending = true;
    ctx.consecutiveExploreTurns = 0;
  } else if (
    isPlanExplore &&
    isPlanTextOnlyFollowUpRun(ctx) &&
    turnExploreOnly &&
    ctx.consecutiveExploreTurns >= exploreTurnBudget
  ) {
    ctx.messages.push({
      role: "system",
      content: buildAskExploreBudgetNudge(ctx.consecutiveExploreTurns),
    });
    ctx.consultativeForceAnswerPending = true;
    ctx.consecutiveExploreTurns = 0;
  } else if (!isReadOnlyAgent && !readOnlyBuildRun && !isPlanExplore && ctx.consecutiveExploreTurns >= exploreTurnBudget) {
    ctx.messages.push({
      role: "system",
      content: buildExploreBudgetNudge(ctx.consecutiveExploreTurns, mode),
    });
    ctx.consecutiveExploreTurns = 0;
  }
}
