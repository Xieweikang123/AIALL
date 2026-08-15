import type { Ref } from "vue";
import { clearPendingAgentRun } from "../services/agentHmrRecovery";
import {
  AGENT_SILENT_CONTINUE_MAX,
  buildAgentMaxTurnsExhaustedMessage,
  extractRateLimitHintFromStatusLog,
  hasRecoverableAgentProgress,
  isAgentMaxTurnsExhausted,
  isRecoverableAgentError,
  PARTIAL_RUN_RESUME_REASON,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  shouldOfferPartialRunResume,
} from "../services/agentRecovery";
import { isAgentSseProgressEvent } from "../services/agentSseEventHandlers";
import { debugLog } from "../utils/debugLog";
import { parseAgentSuggestions } from "../services/agentSuggestions";
import { computeLineDelta } from "../services/agentCursorFeed";
import {
  buildWrittenFilesSummary,
  finalizeAssistantBubbleContent,
  hasAgentFinalAnswer,
  commitAgentFinalAnswerIfMissing,
  mergeAssistantTurnText,
} from "../services/agentMessageDisplay";
import {
  recordAgentRoundNarrative,
  recordAgentRoundRequest,
  recordAgentRoundResponse,
  recordAgentRoundStatus,
  recordAgentRoundToolStart,
} from "../services/agentRoundGroups";
import { parseMemoryProposalToolResult } from "../services/projectMemoryProposal";
import { parseSkillProposalToolResult } from "../services/projectSkillProposal";
import { stripTextToolCallMarkup } from "../services/textToolCallMarkup";
import { stripToolSummaryFromAssistantContent } from "../services/vibeChatStorage";
import { resolveAgentDoneFileAction } from "../services/vibeAgentTurnApply";
import type { VibeAgentSseEvent } from "../services/vibeAgentClient";
import type { VibeChatMessage, AgentStatusData, TurnFileDiff } from "../types/vibeChat";
import type { AgentRunLiveState } from "../services/agentRunLiveState";
import type { RunUiPatchKind } from "./useAgentStreamPatch";
import {
  assistantTransientUiClearPatch,
  formatToolMeta,
  syncRoundGroupsPatch,
} from "../utils/vibeHelpers";
import type { createAgentSessionRunManager } from "./agentSessionRuns";
import type { useAgentStallRecovery } from "./useAgentStallRecovery";

const MAX_TOOL_FULL_RESULT_CHARS = 4_000;

type SessionRunManager = ReturnType<typeof createAgentSessionRunManager<VibeChatMessage>>;
type StallRecovery = ReturnType<typeof useAgentStallRecovery>;

function applySuggestionsToAssistantContent(assistantMsg: VibeChatMessage, rawContent: string): string {
  const { content, suggestions } = parseAgentSuggestions(rawContent);
  assistantMsg.agentSuggestions = suggestions.length ? suggestions : undefined;
  return content;
}

export interface UseAgentEventHandlersDeps {
  runManager: SessionRunManager;
  stallRecovery: StallRecovery;
  chatSending: Ref<boolean>;
  projectPath: Ref<string>;
  planExecutionActive: Ref<boolean>;
  pendingPromptQueue: Ref<string[]>;
  pendingSettleTimerRef: { current: number | null };
  patchAssistantMsg: (id: string, patch: Partial<VibeChatMessage>, sessionId?: string) => void;
  shouldMinimizeRunUiPatch: (msg: VibeChatMessage) => boolean;
  scheduleMinimizedRunUiPatch: (sessionId: string, msgId: string, kind?: RunUiPatchKind) => void;
  flushMinimizedRunUiPatch: (sessionId: string, msgId: string, msg: VibeChatMessage) => void;
  buildRunUiFullPatch: (msg: VibeChatMessage) => Partial<VibeChatMessage>;
  clearStreamDeltaBuffer: () => void;
  enqueueStreamDelta: (msgId: string, msg: VibeChatMessage, delta: string) => void;
  formatLiveStatus: (live: AgentRunLiveState) => string;
  setAgentStatus: (
    sessionId: string,
    msg: VibeChatMessage,
    phase: AgentStatusData["phase"],
    data?: Partial<AgentStatusData>,
    options?: { log?: boolean },
  ) => void;
  isAgentRunning: (msg: VibeChatMessage) => boolean;
  scrollStatusLogToBottomInternal: (msgId: string) => void;
  scrollChatToBottom: (force?: boolean) => Promise<void>;
  finishRunSession: (sessionId: string, silent?: boolean) => void;
  updateAgentRunSessionStatus: (
    sessionId: string,
    status: "completed" | "failed" | "interrupted",
  ) => void;
  persistChatNow: (path?: string, options?: { flushStore?: boolean; sessionId?: string }) => void;
  schedulePersistDuringRun: (sessionId: string) => void;
  persistAgentRunSession: (sessionId: string) => void;
  maybePersistChat: (sessionId: string) => void;
  maybeScrollChat: (sessionId: string) => void;
  dequeuePendingPromptAndRun: () => void;
  clearPendingAgentEvents: () => void;
  isRunVisible: (sessionId: string) => boolean;
  mergeDeferredCaptureIntoMsg: (sessionId: string, msg: VibeChatMessage) => void;
  appendStatusLog: (msg: VibeChatMessage, line: string) => void;
  resolveOriginalUserPrompt: (assistantMsgId: string) => string;
  maybePersistPlanFileToDisk: (
    assistantMsg: VibeChatMessage,
    msgId: string,
    options: { wasExecutePlanRun: boolean; wasAborted: boolean },
  ) => Promise<void>;
  onAgentRunSettled?: (msg: VibeChatMessage) => void;
  /** 运行收尾后请求 AI 提取可点击选项（后台异步，幂等）。 */
  requestSuggestedOptions?: (assistantMsg: VibeChatMessage, sessionId: string) => void;
  onMemoryProposal?: (msgId: string, proposal: import("../services/projectMemoryProposal").MemoryProposalPayload) => void;
  onSkillProposal?: (msgId: string, proposal: import("../services/projectSkillProposal").SkillProposalPayload) => void;
  storeFileDiff: (relPath: string, before: string, after: string, deleted?: boolean, created?: boolean) => void;
  syncEditorAfterAgentFileChange: (relPath: string, diff: TurnFileDiff) => void;
  refreshTree: () => void | Promise<void>;
  clearTurnFileDiffsFromStore: (diffs: Record<string, TurnFileDiff>) => void;
  handleAgentWrittenFiles: (files: string[]) => Promise<void>;
  resolveCompletedTurns: (reported: number, msg: VibeChatMessage) => number;
}

type DoneEventPayload = {
  data: { writtenFiles?: string[]; pendingFiles?: string[]; turns: number };
};

function resolveDoneEventWrittenFiles(
  assistantMsg: VibeChatMessage,
  event: DoneEventPayload,
  wasAborted: boolean,
): string[] {
  const turnFileDiffPaths = assistantMsg.turnFileDiffs
    ? Object.keys(assistantMsg.turnFileDiffs)
    : [];
  return (
    resolveAgentDoneFileAction({
      chatMode: assistantMsg.chatMode ?? "build",
      wasAborted,
      serverPendingFiles: event.data.pendingFiles || [],
      serverWrittenFiles: event.data.writtenFiles || [],
      turnFileDiffPaths,
      tools: assistantMsg.tools,
      priorWrittenFiles: assistantMsg.writtenFiles,
    }).writtenFiles ?? []
  );
}

function commitSynthesizedWriteSummary(
  assistantMsg: VibeChatMessage,
  completedTurns: number,
  writtenFiles: string[],
): void {
  const summary = buildWrittenFilesSummary(writtenFiles, false);
  assistantMsg.writtenFiles = writtenFiles;
  assistantMsg.content = summary;
  assistantMsg.roundGroups = recordAgentRoundResponse(
    assistantMsg.roundGroups,
    completedTurns,
    {
      assistantText: summary,
      toolCalls: [],
      hasToolCalls: false,
      isFinal: true,
    },
    assistantMsg.agentMaxTurns,
  );
}

export function useAgentEventHandlers(deps: UseAgentEventHandlersDeps) {
  const {
    runManager,
    stallRecovery,
    chatSending,
    projectPath,
    planExecutionActive,
    pendingPromptQueue,
    pendingSettleTimerRef,
    patchAssistantMsg,
    shouldMinimizeRunUiPatch,
    scheduleMinimizedRunUiPatch,
    flushMinimizedRunUiPatch,
    buildRunUiFullPatch,
    clearStreamDeltaBuffer,
    enqueueStreamDelta,
    formatLiveStatus,
    setAgentStatus,
    isAgentRunning,
    scrollStatusLogToBottomInternal,
    scrollChatToBottom,
    finishRunSession,
    updateAgentRunSessionStatus,
    persistChatNow,
    schedulePersistDuringRun,
    persistAgentRunSession,
    maybePersistChat,
    maybeScrollChat,
    dequeuePendingPromptAndRun,
    clearPendingAgentEvents,
    isRunVisible,
    mergeDeferredCaptureIntoMsg,
    appendStatusLog,
    resolveOriginalUserPrompt,
    maybePersistPlanFileToDisk,
    onAgentRunSettled,
    requestSuggestedOptions,
    onMemoryProposal,
    onSkillProposal,
    storeFileDiff,
    syncEditorAfterAgentFileChange,
    refreshTree,
    clearTurnFileDiffsFromStore,
    handleAgentWrittenFiles,
    resolveCompletedTurns,
  } = deps;

type EventOf<T extends string> = Extract<VibeAgentSseEvent, { type: T }>;
type AgentEventFn = (
  event: VibeAgentSseEvent,
  assistantMsg: VibeChatMessage,
  sessionId: string,
  msgId: string,
) => void;

function handleAgentContextEvent(event: EventOf<"agent_context">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  assistantMsg.agentContext = event.data;
  if (shouldMinimizeRunUiPatch(assistantMsg)) {
    scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
  } else {
    patchAssistantMsg(msgId, { agentContext: event.data });
  }
}

function handleTurnRequestEvent(event: EventOf<"turn_request">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  if (event.data.contextChars !== undefined) {
    assistantMsg.contextChars = event.data.contextChars;
  }
  if (event.data.turn) assistantMsg.agentTurn = event.data.turn;
  if (event.data.maxTurns) assistantMsg.agentMaxTurns = event.data.maxTurns;
  const run = runManager.get(sessionId);
  if (run?.live) {
    if (event.data.turn) run.live.turn = event.data.turn;
    if (event.data.maxTurns) run.live.maxTurns = event.data.maxTurns;
    if (event.data.contextChars !== undefined) run.live.contextChars = event.data.contextChars;
  }
  assistantMsg.roundGroups = recordAgentRoundRequest(
    assistantMsg.roundGroups,
    event.data.turn,
    {
      model: event.data.model,
      contextMessages: event.data.contextMessages,
      contextChars: event.data.contextChars,
      messages: event.data.messages,
    },
    event.data.maxTurns,
  );
  if (shouldMinimizeRunUiPatch(assistantMsg)) {
    scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
    return;
  }
  patchAssistantMsg(msgId, syncRoundGroupsPatch(assistantMsg));
  if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
}

function handleTurnResponseEvent(event: EventOf<"turn_response">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  debugLog("[eventHandlers] handleTurnResponseEvent", {
    turn: event.data.turn,
    isFinal: event.data.isFinal,
    hasToolCalls: event.data.hasToolCalls,
    assistantText: (event.data.assistantText || "").slice(0, 80),
    contentBefore: (assistantMsg.content || "").slice(0, 80),
    agentTurn: assistantMsg.agentTurn,
  });

  clearStreamDeltaBuffer();

  // 保存流式输出的原始内容
  const streamedContent = assistantMsg.content || "";

  assistantMsg.content = stripTextToolCallMarkup(
    stripToolSummaryFromAssistantContent(assistantMsg.content || ""),
  );
  const strippedAssistantText = stripTextToolCallMarkup(
    stripToolSummaryFromAssistantContent(event.data.assistantText || ""),
  );
  assistantMsg.roundGroups = recordAgentRoundResponse(
    assistantMsg.roundGroups,
    event.data.turn,
    {
      assistantText: strippedAssistantText,
      toolCalls: event.data.toolCalls,
      hasToolCalls: event.data.hasToolCalls,
      isFinal: event.data.isFinal,
    },
    event.data.maxTurns,
  );
  const turnText = strippedAssistantText;
  if (turnText && event.data.isFinal) {
    // Prefer authoritative turn_response over a divergent/corrupt stream prefix.
    assistantMsg.content = mergeAssistantTurnText(
      streamedContent || assistantMsg.content || "",
      turnText,
      { preferIncoming: true },
    );
    assistantMsg.activityExpanded = false;

    debugLog("[eventHandlers] merged final turn text", {
      contentAfter: assistantMsg.content.slice(0, 80),
    });
  }
  if (shouldMinimizeRunUiPatch(assistantMsg)) {
    scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
    return;
  }
  patchAssistantMsg(msgId, {
    ...syncRoundGroupsPatch(assistantMsg),
    content: assistantMsg.content,
    activityExpanded: assistantMsg.activityExpanded,
  });
  if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
}

function handleTurnTraceEvent(event: EventOf<"turn_trace">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  debugLog("[eventHandlers] handleTurnTraceEvent", {
    turn: event.data.turn,
    assistantText: (event.data.assistantText ?? event.data.toolCallPreamble ?? "").slice(0, 80),
  });

  const traceText = stripTextToolCallMarkup(
    stripToolSummaryFromAssistantContent(
      event.data.assistantText ?? event.data.toolCallPreamble ?? "",
    ),
  );
  if (!assistantMsg.turnTraces) assistantMsg.turnTraces = [];
  assistantMsg.turnTraces.push({
    turn: event.data.turn,
    maxTurns: event.data.maxTurns,
    assistantText: traceText,
    hasToolCalls: event.data.hasToolCalls ?? false,
  });
  assistantMsg.roundGroups = recordAgentRoundNarrative(
    assistantMsg.roundGroups,
    event.data.turn,
    traceText,
    event.data.maxTurns,
  );
  if (shouldMinimizeRunUiPatch(assistantMsg)) {
    scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
    return;
  }
  patchAssistantMsg(msgId, {
    turnTraces: [...assistantMsg.turnTraces],
    ...syncRoundGroupsPatch(assistantMsg),
  });
  if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
}

function handleStatusEvent(event: EventOf<"status">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  const { phase } = event.data;
  const run = runManager.get(sessionId);
  if (!run) return;
  const prevPhase = run.live.phase;
  setAgentStatus(sessionId, assistantMsg, phase, event.data, { log: phase !== prevPhase });

  const phaseChanged = phase !== prevPhase;
  const contextChanged =
    event.data.contextChars !== undefined &&
    event.data.contextChars !== assistantMsg.contextChars;
  const streamChanged =
    event.data.streamChars !== undefined &&
    event.data.streamChars !== assistantMsg.streamChars;
  const isTerminal = phase === "aborted" || phase === "finished";
  // Heartbeat-only status (same phase, e.g.「已等待 12s」) updates run.live only;
  // skip patching chatMessages to avoid re-rendering the whole UI every 2s.
  if (!phaseChanged && !contextChanged && !streamChanged && !isTerminal) {
    return;
  }

  if (shouldMinimizeRunUiPatch(assistantMsg)) {
    if (phase === "aborted") {
      clearStreamDeltaBuffer();
      assistantMsg.agentAborted = true;
      assistantMsg.agentAbortReason ||= "运行连接已中断";
      stallRecovery.stopAgentUiTick();
      finishRunSession(sessionId);
      updateAgentRunSessionStatus(sessionId, "interrupted");
      patchAssistantMsg(msgId, {
        agentAborted: true,
        agentAbortReason: assistantMsg.agentAbortReason,
        content: assistantMsg.content,
      });
      persistChatNow();
      if (pendingPromptQueue.value.length) {
        dequeuePendingPromptAndRun();
      }
      return;
    }
    const statusText = formatLiveStatus(run.live);
    assistantMsg.roundGroups = recordAgentRoundStatus(
      assistantMsg.roundGroups,
      phase,
      statusText,
      assistantMsg.agentTurn ?? event.data.turn,
      assistantMsg.agentMaxTurns ?? event.data.maxTurns,
    );
    scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
    return;
  }

  const statusText = formatLiveStatus(run.live);
  assistantMsg.roundGroups = recordAgentRoundStatus(
    assistantMsg.roundGroups,
    phase,
    statusText,
    assistantMsg.agentTurn ?? event.data.turn,
    assistantMsg.agentMaxTurns ?? event.data.maxTurns,
  );
  patchAssistantMsg(msgId, {
    streamChars: assistantMsg.streamChars,
    contextChars: assistantMsg.contextChars,
    statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
    agentTurn: assistantMsg.agentTurn,
    agentMaxTurns: assistantMsg.agentMaxTurns,
    agentModel: assistantMsg.agentModel,
    ...syncRoundGroupsPatch(assistantMsg),
  });
  if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
  if (phase === "aborted") {
    clearStreamDeltaBuffer();
    assistantMsg.agentAborted = true;
    assistantMsg.agentAbortReason ||= "运行连接已中断";
    const abortTurn = assistantMsg.agentTurn ?? 1;
    assistantMsg.roundGroups = recordAgentRoundResponse(
      assistantMsg.roundGroups,
      abortTurn,
      { assistantText: "", toolCalls: [], hasToolCalls: false, isFinal: false },
      assistantMsg.agentMaxTurns,
    );
    patchAssistantMsg(msgId, {
      agentAborted: true,
      agentAbortReason: assistantMsg.agentAbortReason,
      ...syncRoundGroupsPatch(assistantMsg),
    });
    stallRecovery.stopAgentUiTick();
    finishRunSession(sessionId);
    updateAgentRunSessionStatus(sessionId, "interrupted");
    persistChatNow();
    if (pendingPromptQueue.value.length) {
      dequeuePendingPromptAndRun();
    }
  }
  void scrollChatToBottom();
}

function handleToolStartEvent(event: EventOf<"tool_start">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  const meta = formatToolMeta(event.data.name, event.data.args);
  const toolTurn = assistantMsg.agentTurn ?? runManager.get(sessionId)?.live.turn ?? 1;
  const toolStep = {
    id: event.data.id,
    ...meta,
    args: { ...event.data.args },
    summary: "",
    running: true,
    turn: toolTurn,
  };
  if (!assistantMsg.tools) assistantMsg.tools = [];
  assistantMsg.tools.push(toolStep);
  assistantMsg.roundGroups = recordAgentRoundToolStart(assistantMsg.roundGroups, event.data.id, toolTurn);
  setAgentStatus(sessionId, assistantMsg, "executing_tool", {
    toolTitle: meta.title,
    toolDetail: meta.detail,
    turn: assistantMsg.agentTurn,
    maxTurns: assistantMsg.agentMaxTurns,
  });
  if (shouldMinimizeRunUiPatch(assistantMsg)) {
    scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
    return;
  }
  patchAssistantMsg(msgId, {
    tools: [...assistantMsg.tools],
    statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
    ...syncRoundGroupsPatch(assistantMsg),
  });
  if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
  void scrollChatToBottom();
}

function handleFileDiffEvent(event: EventOf<"file_diff">, assistantMsg: VibeChatMessage, _sessionId: string, msgId: string) {
  const relPath = event.data.path;
  const diff = { before: event.data.before, after: event.data.after, deleted: event.data.deleted, created: event.data.created };
  storeFileDiff(relPath, diff.before, diff.after, diff.deleted);
  if (!assistantMsg.turnFileDiffs) assistantMsg.turnFileDiffs = {};
  assistantMsg.turnFileDiffs[relPath] = diff;
  const normalizedPath = relPath.replace(/\\/g, "/");
  const writeStep = [...(assistantMsg.tools || [])].reverse().find((tool) => {
    if (tool.name !== "write_file") return false;
    const toolPath = String(tool.args?.path ?? tool.detail.split(" · ")[0] ?? "").replace(/\\/g, "/");
    return toolPath === normalizedPath;
  });
  if (writeStep) {
    writeStep.lineDelta = computeLineDelta(diff.before, diff.after, diff.created);
  }
  patchAssistantMsg(msgId, {
    turnFileDiffs: { ...assistantMsg.turnFileDiffs },
    tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
  });
  void syncEditorAfterAgentFileChange(relPath, diff);
  void scrollChatToBottom();
}

function handleToolEndEvent(event: EventOf<"tool_end">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  const step = assistantMsg.tools?.find((t) => t.id === event.data.id);
  if (step) {
    step.running = false;
    step.ok = event.data.ok;
    step.summary = event.data.summary;
    if (event.data.result) {
      const raw = event.data.result;
      step.fullResult =
        raw.length > MAX_TOOL_FULL_RESULT_CHARS
          ? `${raw.slice(0, MAX_TOOL_FULL_RESULT_CHARS)}…`
          : raw;
    }
  }
  if (event.data.result) {
    const proposal = parseMemoryProposalToolResult(event.data.result);
    if (proposal) onMemoryProposal?.(msgId, proposal);
    const skillProposal = parseSkillProposalToolResult(event.data.result);
    if (skillProposal) onSkillProposal?.(msgId, skillProposal);
  }
  if (event.data.name === "run_command" && event.data.ok) {
    void refreshTree();
  }
  const pending = assistantMsg.tools?.some((t) => t.running);
  setAgentStatus(sessionId, assistantMsg, pending ? "executing_tools" : "summarizing_tools", {
    turn: assistantMsg.agentTurn,
    maxTurns: assistantMsg.agentMaxTurns,
  });
  if (shouldMinimizeRunUiPatch(assistantMsg)) {
    scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
    return;
  }
  patchAssistantMsg(msgId, {
    tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
    statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
  });
  if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
  void scrollChatToBottom();
}

function handleMessageDeltaEvent(event: EventOf<"message_delta">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  const delta = event.data.delta || "";
  if (!delta) return;
  const run = runManager.get(sessionId);
  const waitPhases = new Set(["waiting_model", "sending_request", "retrying_model"]);
  if (run && waitPhases.has(run.live.phase)) {
    setAgentStatus(sessionId, assistantMsg, "streaming_model", {
      turn: assistantMsg.agentTurn,
      maxTurns: assistantMsg.agentMaxTurns,
      model: assistantMsg.agentModel,
      streamChars: (assistantMsg.streamChars || 0) + delta.length,
    });
    if (!shouldMinimizeRunUiPatch(assistantMsg)) {
      patchAssistantMsg(msgId, {
        streamChars: assistantMsg.streamChars,
      });
    }
  }
  enqueueStreamDelta(msgId, assistantMsg, delta);
}

function handleMessageEvent(event: EventOf<"message">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  clearStreamDeltaBuffer();
  const cleanText = stripTextToolCallMarkup(stripToolSummaryFromAssistantContent(event.data.text));
  const minimizing = shouldMinimizeRunUiPatch(assistantMsg);
  if (cleanText) {
    assistantMsg.content = mergeAssistantTurnText(assistantMsg.content || "", cleanText);
  }
  if (minimizing) {
    schedulePersistDuringRun(sessionId);
    scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
    return;
  }
  patchAssistantMsg(msgId, {
    content: assistantMsg.content,
  });
  schedulePersistDuringRun(sessionId);
  void scrollChatToBottom();
}

function handleErrorEvent(event: EventOf<"error">, assistantMsg: VibeChatMessage, sessionId: string, _msgId: string) {
  if (isRunVisible(sessionId)) clearStreamDeltaBuffer();
  planExecutionActive.value = false;
  if (stallRecovery.trySilentContinue(sessionId, assistantMsg, event.data.message)) {
    runManager.setAbortHandle(sessionId, null);
    return;
  }
  stallRecovery.applyRecoverableAgentFailure(assistantMsg, event.data.message);
  finishRunSession(sessionId);
  maybePersistChat(sessionId);
  maybeScrollChat(sessionId);

  const recoverable = isRecoverableAgentError(event.data.message);
  if (!recoverable && pendingPromptQueue.value.length && isRunVisible(sessionId)) {
    dequeuePendingPromptAndRun();
  }
}

function handleDoneEvent(event: EventOf<"done">, assistantMsg: VibeChatMessage, sessionId: string, msgId: string) {
  if (isRunVisible(sessionId)) clearStreamDeltaBuffer();
  const wasExecutePlanRun = planExecutionActive.value;
  planExecutionActive.value = false;
  runManager.setAbortHandle(sessionId, null);
  clearPendingAgentRun();
  flushMinimizedRunUiPatch(sessionId, msgId, assistantMsg);

  if (assistantMsg.agentFailed) {
    finishRunSession(sessionId);
    const completedTurns = resolveCompletedTurns(event.data.turns, assistantMsg);
    if (!assistantMsg.totalTurns) assistantMsg.totalTurns = completedTurns;
    patchAssistantMsg(msgId, {
      totalTurns: assistantMsg.totalTurns,
      ...assistantTransientUiClearPatch(),
      ...syncRoundGroupsPatch(assistantMsg),
    });
    persistChatNow();
    void scrollChatToBottom();
    if (pendingPromptQueue.value.length) {
      dequeuePendingPromptAndRun();
    }
    return;
  }

  const completedTurns = resolveCompletedTurns(event.data.turns, assistantMsg);
  const wasAborted = !!assistantMsg.agentAborted;

  mergeDeferredCaptureIntoMsg(sessionId, assistantMsg);

  if ((assistantMsg.chatMode === "ask" || assistantMsg.chatMode === "explore") && !wasAborted) {
    assistantMsg.totalTurns = completedTurns;
    if (projectPath.value.trim()) {
      updateAgentRunSessionStatus(sessionId, "completed");
    }
    assistantMsg.writtenFiles = resolveAgentDoneFileAction({
      chatMode: assistantMsg.chatMode ?? "ask",
      wasAborted: false,
      serverPendingFiles: [],
      serverWrittenFiles: event.data.writtenFiles ?? [],
      turnFileDiffPaths: [],
      tools: assistantMsg.tools,
      priorWrittenFiles: assistantMsg.writtenFiles,
    }).writtenFiles;
    assistantMsg.content = applySuggestionsToAssistantContent(
      assistantMsg,
      finalizeAssistantBubbleContent({
        ...assistantMsg,
        wasAborted: false,
        writtenFiles: assistantMsg.writtenFiles,
        agentFailed: false,
      }),
    );
    assistantMsg.activityExpanded = false;
    stallRecovery.stopAgentUiTick();
    clearPendingAgentEvents();
    finishRunSession(sessionId);
    patchAssistantMsg(msgId, {
      ...assistantTransientUiClearPatch(),
      activityExpanded: assistantMsg.activityExpanded,
      content: assistantMsg.content,
      totalTurns: assistantMsg.totalTurns,
      writtenFiles: assistantMsg.writtenFiles,
    });
    pendingSettleTimerRef.current = window.setTimeout(() => {
      pendingSettleTimerRef.current = null;
      persistChatNow(undefined, { flushStore: true, sessionId });
      void scrollChatToBottom();
      onAgentRunSettled?.(assistantMsg);
      requestSuggestedOptions?.(assistantMsg, sessionId);
    }, 0);
    if (pendingPromptQueue.value.length) {
      dequeuePendingPromptAndRun();
    }
    return;
  }

  // Update session status to completed if agent completed successfully
  if (!wasAborted && !assistantMsg.agentFailed && projectPath.value.trim()) {
    updateAgentRunSessionStatus(sessionId, "completed");
  }
  const hasRunningTools = assistantMsg.tools?.some((t) => t.running);
  const hadProgress = hasRecoverableAgentProgress(assistantMsg);
  const incompleteRun =
    !wasAborted &&
    hadProgress &&
    (hasRunningTools || (completedTurns === 0 && event.data.turns === 0));
  const maxTurnsExhausted =
    !wasAborted &&
    !assistantMsg.agentFailed &&
    isAgentMaxTurnsExhausted(assistantMsg, completedTurns);

  // 自动续跑：模型输出被截断时静默继续
  if (event.data.truncated && !wasAborted && !assistantMsg.agentFailed) {
    const continueCount = assistantMsg.agentContinueCount ?? 0;
    const maxContinues = AGENT_SILENT_CONTINUE_MAX;
    const truncatedNotice = `回复内容较长，正在自动补充完成（第 ${continueCount + 1}/${maxContinues} 次）…`;
    if (stallRecovery.trySilentContinue(sessionId, assistantMsg, truncatedNotice)) {
      if (!assistantMsg.totalTurns) {
        assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
      }
      patchAssistantMsg(msgId, {
        totalTurns: assistantMsg.totalTurns,
        ...syncRoundGroupsPatch(assistantMsg),
      });
      schedulePersistDuringRun(sessionId);
      void scrollChatToBottom();
      return;
    }
  }

  if (incompleteRun) {
    if (stallRecovery.trySilentContinue(sessionId, assistantMsg, "连接中断（运行未完成）")) {
      if (!assistantMsg.totalTurns) {
        assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
      }
      patchAssistantMsg(msgId, {
        totalTurns: assistantMsg.totalTurns,
        ...syncRoundGroupsPatch(assistantMsg),
      });
      schedulePersistDuringRun(sessionId);
      persistAgentRunSession(sessionId);
      void scrollChatToBottom();
      return;
    }
    const continueBefore = assistantMsg.agentContinueCount ?? 0;
    stallRecovery.handleRecoverableInterruption(sessionId, assistantMsg, "连接中断（运行未完成）", { logStatus: true });
    if ((assistantMsg.agentContinueCount ?? 0) > continueBefore) {
      if (!assistantMsg.totalTurns) {
        assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
      }
      patchAssistantMsg(msgId, {
        totalTurns: assistantMsg.totalTurns,
        ...syncRoundGroupsPatch(assistantMsg),
      });
      schedulePersistDuringRun(sessionId);
      persistAgentRunSession(sessionId);
      void scrollChatToBottom();
      return;
    }
    finishRunSession(sessionId);
    if (!assistantMsg.totalTurns) {
      assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
    }
    patchAssistantMsg(msgId, {
      totalTurns: assistantMsg.totalTurns,
      ...assistantTransientUiClearPatch(),
      ...syncRoundGroupsPatch(assistantMsg),
    });
    persistChatNow();
    void scrollChatToBottom();
    if (pendingPromptQueue.value.length) {
      dequeuePendingPromptAndRun();
    }
    return;
  }

  if (maxTurnsExhausted) {
    const reason = buildAgentMaxTurnsExhaustedMessage(assistantMsg.agentMaxTurns ?? completedTurns);
    if (stallRecovery.trySilentContinue(sessionId, assistantMsg, reason)) {
      assistantMsg.totalTurns = completedTurns;
      patchAssistantMsg(msgId, { totalTurns: completedTurns, ...syncRoundGroupsPatch(assistantMsg) });
      schedulePersistDuringRun(sessionId);
      persistAgentRunSession(sessionId);
      void scrollChatToBottom();
      return;
    }
    const continueBefore = assistantMsg.agentContinueCount ?? 0;
    stallRecovery.handleRecoverableInterruption(sessionId, assistantMsg, reason, { logStatus: true });
    if ((assistantMsg.agentContinueCount ?? 0) > continueBefore) {
      assistantMsg.totalTurns = completedTurns;
      patchAssistantMsg(msgId, { totalTurns: completedTurns, ...syncRoundGroupsPatch(assistantMsg) });
      schedulePersistDuringRun(sessionId);
      persistAgentRunSession(sessionId);
      void scrollChatToBottom();
      return;
    }
    finishRunSession(sessionId);
    assistantMsg.totalTurns = completedTurns;
    patchAssistantMsg(msgId, { totalTurns: completedTurns, ...syncRoundGroupsPatch(assistantMsg) });
    persistChatNow();
    void scrollChatToBottom();
    if (pendingPromptQueue.value.length) {
      dequeuePendingPromptAndRun();
    }
    return;
  }

  const spuriousDoneAfterInterrupt =
    !wasAborted &&
    event.data.turns === 0 &&
    hadProgress &&
    !hasRunningTools &&
    !hasAgentFinalAnswer(assistantMsg);

  if (spuriousDoneAfterInterrupt) {
    if (stallRecovery.trySilentContinue(sessionId, assistantMsg, "连接中断（运行未完成）")) {
      if (!assistantMsg.totalTurns) {
        assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
      }
      patchAssistantMsg(msgId, {
        totalTurns: assistantMsg.totalTurns,
        ...syncRoundGroupsPatch(assistantMsg),
      });
      schedulePersistDuringRun(sessionId);
      persistAgentRunSession(sessionId);
      void scrollChatToBottom();
      return;
    }
    stallRecovery.handleRecoverableInterruption(sessionId, assistantMsg, "连接中断（运行未完成）", { logStatus: true });
    finishRunSession(sessionId);
    if (!assistantMsg.totalTurns) {
      assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
    }
    patchAssistantMsg(msgId, {
      totalTurns: assistantMsg.totalTurns,
      agentFailed: assistantMsg.agentFailed,
      agentRecoverable: assistantMsg.agentRecoverable,
      agentFailureReason: assistantMsg.agentFailureReason,
      agentRecoveryDismissed: assistantMsg.agentRecoveryDismissed,
      content: assistantMsg.content,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      ...syncRoundGroupsPatch(assistantMsg),
    });
    persistChatNow();
    void scrollChatToBottom();
    return;
  }

  assistantMsg.totalTurns = completedTurns;
  const continueCount = assistantMsg.agentContinueCount ?? 0;
  appendStatusLog(
    assistantMsg,
    wasAborted
      ? `已停止（共 ${completedTurns} 轮）`
      : continueCount > 0
        ? `✅ 完成（共 ${completedTurns} 轮，含 ${continueCount} 次自动续跑）`
        : `完成（共 ${completedTurns} 轮）`,
  );

  commitAgentFinalAnswerIfMissing(assistantMsg, completedTurns, assistantMsg.agentMaxTurns);

  const autoBugFixOriginalPrompt = resolveOriginalUserPrompt(assistantMsg.id) ?? "";
  const isAutoBugFixRun = autoBugFixOriginalPrompt.includes("[AUTO_BUG_FIX]");
  if (
    isAutoBugFixRun &&
    !wasAborted &&
    !assistantMsg.agentFailed &&
    !hasAgentFinalAnswer(assistantMsg)
  ) {
    stallRecovery.handleRecoverableInterruption(sessionId, assistantMsg, "运行中断（未生成最终回复）", {
      logStatus: true,
      noAutoResume: true,
    });
    assistantMsg.content = resolveAgentFailureBubbleContent(assistantMsg);
    if (!assistantMsg.content?.trim()) {
      assistantMsg.content = "运行未生成修复总结，可点击「恢复运行」继续，或重新发起扫描修复。";
    }
    flushMinimizedRunUiPatch(sessionId, msgId, assistantMsg);
    patchAssistantMsg(msgId, {
      ...buildRunUiFullPatch(assistantMsg),
      content: assistantMsg.content,
      agentFailed: assistantMsg.agentFailed,
      agentRecoverable: assistantMsg.agentRecoverable,
      agentFailureReason: assistantMsg.agentFailureReason,
      agentFailureDetail: assistantMsg.agentFailureDetail,
      agentRecoveryDismissed: assistantMsg.agentRecoveryDismissed,
      totalTurns: assistantMsg.totalTurns,
      activityExpanded: true,
    });
    persistChatNow(undefined, { flushStore: true });
    finishRunSession(sessionId);
    void scrollChatToBottom();
    void maybePersistPlanFileToDisk(assistantMsg, msgId, { wasExecutePlanRun, wasAborted }).then(() => {
      onAgentRunSettled?.(assistantMsg);
      requestSuggestedOptions?.(assistantMsg, sessionId);
    }).catch((err: unknown) => {
      debugLog("maybePersistPlanFileToDisk failed:", err);
    });
    return;
  }

  if (!wasAborted && hadProgress && !hasAgentFinalAnswer(assistantMsg)) {
    const rateLimitHint = extractRateLimitHintFromStatusLog(assistantMsg.statusLog);
    if (rateLimitHint && stallRecovery.trySilentContinue(sessionId, assistantMsg, rateLimitHint)) {
      schedulePersistDuringRun(sessionId);
      void scrollChatToBottom();
      return;
    }
    const writtenFiles = resolveDoneEventWrittenFiles(assistantMsg, event, wasAborted);
    if (
      writtenFiles.length > 0
      && (assistantMsg.chatMode === "build" || !assistantMsg.chatMode)
    ) {
      commitSynthesizedWriteSummary(assistantMsg, completedTurns, writtenFiles);
    } else {
      stallRecovery.handleRecoverableInterruption(sessionId, assistantMsg, "运行中断（未生成最终回复）", {
        logStatus: true,
      });
      assistantMsg.content = resolveAgentFailureBubbleContent(assistantMsg);
      flushMinimizedRunUiPatch(sessionId, msgId, assistantMsg);
      patchAssistantMsg(msgId, {
        ...buildRunUiFullPatch(assistantMsg),
        content: assistantMsg.content,
        agentFailed: assistantMsg.agentFailed,
        agentRecoverable: assistantMsg.agentRecoverable,
        agentFailureReason: assistantMsg.agentFailureReason,
        agentFailureDetail: assistantMsg.agentFailureDetail,
        agentRecoveryDismissed: assistantMsg.agentRecoveryDismissed,
        totalTurns: assistantMsg.totalTurns,
        activityExpanded: true,
      });
      persistChatNow(undefined, { flushStore: true });
      finishRunSession(sessionId);
      void scrollChatToBottom();
      return;
    }
  }

  const turnFileDiffPaths = assistantMsg.turnFileDiffs
    ? Object.keys(assistantMsg.turnFileDiffs)
    : [];
  const fileAction = resolveAgentDoneFileAction({
    chatMode: assistantMsg.chatMode ?? "build",
    wasAborted,
    serverPendingFiles: event.data.pendingFiles || [],
    serverWrittenFiles: event.data.writtenFiles || [],
    turnFileDiffPaths,
    tools: assistantMsg.tools,
    priorWrittenFiles: assistantMsg.writtenFiles,
  });

  assistantMsg.pendingApproval = fileAction.pendingApproval;
  assistantMsg.writtenFiles = fileAction.writtenFiles;

  assistantMsg.content = applySuggestionsToAssistantContent(
    assistantMsg,
    finalizeAssistantBubbleContent({
      ...assistantMsg,
      wasAborted,
      writtenFiles: fileAction.writtenFiles,
      agentFailed: false,
    }),
  );

  const offerPartialResume = shouldOfferPartialRunResume({
    wasAborted,
    writtenFiles: fileAction.writtenFiles,
    msg: assistantMsg,
  });

  if (offerPartialResume) {
    assistantMsg.agentFailed = true;
    assistantMsg.agentRecoverable = true;
    assistantMsg.agentFailureReason = PARTIAL_RUN_RESUME_REASON;
    assistantMsg.agentRecoveryDismissed = false;
  } else {
    assistantMsg.agentFailed = false;
    assistantMsg.agentRecoverable = false;
    assistantMsg.agentFailureReason = undefined;
    assistantMsg.agentRecoveryDismissed = true;
    assistantMsg.agentContinueCount = undefined;
  }

  assistantMsg.activityExpanded = offerPartialResume || wasAborted
    ? true
    : false;

  // End the run before patching final content so the UI does not render
  // live-preview text while msg.content already holds the finalized answer.
  finishRunSession(sessionId);

  patchAssistantMsg(msgId, {
    ...assistantTransientUiClearPatch(),
    activityExpanded: assistantMsg.activityExpanded,
    content: assistantMsg.content,
    agentSuggestions: assistantMsg.agentSuggestions,
    totalTurns: assistantMsg.totalTurns,
    statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
    ...syncRoundGroupsPatch(assistantMsg),
    writtenFiles: assistantMsg.writtenFiles,
    pendingApproval: assistantMsg.pendingApproval,
    turnFileDiffs: assistantMsg.turnFileDiffs ? { ...assistantMsg.turnFileDiffs } : undefined,
    agentAborted: assistantMsg.agentAborted || undefined,
    agentFailed: offerPartialResume ? true : undefined,
    agentRecoverable: offerPartialResume ? true : undefined,
    agentFailureReason: offerPartialResume ? PARTIAL_RUN_RESUME_REASON : undefined,
    agentFailureDetail: undefined,
    agentRecoveryDismissed: offerPartialResume ? false : true,
    agentContinueCount: offerPartialResume ? assistantMsg.agentContinueCount : undefined,
  });
  persistChatNow(undefined, { flushStore: true });

  if (fileAction.writtenFiles?.length) {
    if (!fileAction.pendingApproval && assistantMsg.turnFileDiffs) {
      clearTurnFileDiffsFromStore(assistantMsg.turnFileDiffs);
    }
    void handleAgentWrittenFiles(fileAction.writtenFiles);
  }

  void maybePersistPlanFileToDisk(assistantMsg, msgId, { wasExecutePlanRun, wasAborted }).then(() => {
    void scrollChatToBottom();
    onAgentRunSettled?.(assistantMsg);
    requestSuggestedOptions?.(assistantMsg, sessionId);
    if (pendingPromptQueue.value.length) {
      dequeuePendingPromptAndRun();
    }
  }).catch((err: unknown) => {
    debugLog("maybePersistPlanFileToDisk failed:", err);
  });
}

const agentEventHandlers = new Map<string, AgentEventFn>([
  ["agent_context", handleAgentContextEvent as AgentEventFn],
  ["turn_request", handleTurnRequestEvent as AgentEventFn],
  ["turn_response", handleTurnResponseEvent as AgentEventFn],
  ["turn_trace", handleTurnTraceEvent as AgentEventFn],
  ["status", handleStatusEvent as AgentEventFn],
  ["tool_start", handleToolStartEvent as AgentEventFn],
  ["file_diff", handleFileDiffEvent as AgentEventFn],
  ["tool_end", handleToolEndEvent as AgentEventFn],
  ["message_delta", handleMessageDeltaEvent as AgentEventFn],
  ["message", handleMessageEvent as AgentEventFn],
  ["error", handleErrorEvent as AgentEventFn],
  ["done", handleDoneEvent as AgentEventFn],
]);

function handleAgentEvent(
  event: VibeAgentSseEvent,
  assistantMsg: VibeChatMessage,
  runGen: number,
  sessionId: string,
) {
  if (!runManager.isValid(sessionId, runGen)) {
    if (event.type === "done" || event.type === "error") {
      if (runManager.get(sessionId)) {
        finishRunSession(sessionId);
      } else if (chatSending.value) {
        finishRunSession(sessionId);
      }
    }
    return;
  }
  const msgId = assistantMsg.id;
  if (isAgentSseProgressEvent(event.type)) stallRecovery.touchAgentProgress(sessionId);
  const handler = agentEventHandlers.get(event.type);
  if (handler) handler(event, assistantMsg, sessionId, msgId);
}
  return { handleAgentEvent };
}
