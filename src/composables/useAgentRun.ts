import { ref, onBeforeUnmount, getCurrentInstance, type ComputedRef, type Ref } from "vue";
import { debugLog } from "../utils/debugLog";
import {
  buildAgentPromptForProfile,
  enrichAgentUserPrompt,
  resolveAgentMaxTurns,
  resolveAgentResumeRunProfile,
  resolveResumeMaxTurns,
  resolveAgentRunProfile,
  resolveAskExecutionEscalation,
  shapeAgentHistoryForProfile,
  type AgentRunProfile,
} from "../services/agentRunProfile";
import {
  EXPLORE_CONTINUE_PRESET_PROMPT,
  EXPLORE_DEPTH_MAX_TURNS,
  EXPLORE_FOLLOWUP_MAX_TURNS,
  EXPLORE_PROJECT_PRESET_PROMPT,
  type ExploreDepth,
  resolveExploreRequestMaxTurns,
} from "../services/agentExplore";
import { isProjectReport } from "../services/projectReportDisplay";
import {
  AGENT_SILENT_CONTINUE_DELAY_MS,
  AGENT_SILENT_CONTINUE_MAX,
  AGENT_MODEL_WAIT_STALL_MS,
  AGENT_CONTINUE_MODEL_WAIT_STALL_MS,
  resolveModelWaitStallMs,
  agentStallRecoveryReason,
  agentConnectStallMessage,
  buildAgentMaxTurnsExhaustedMessage,
  buildAgentRunningStatusText,
  buildAgentResumePrompt,
  buildSilentContinueStatusLog,
  canResumeAgentRun,
  hasRecoverableAgentProgress,
  inferAgentRecoveryFlags,
  isAgentMaxTurnsExhausted,
  isAgentConnectPhase,
  isAgentConnectStalled,
  isAgentRunStalled,
  isRecoverableAgentError,
  isIncompleteAgentRunWithoutFinalAnswer,
  applyInferredAgentRecovery,
  diagnoseMissingFinalAnswer,
  applyMissingFinalAnswerDiagnosis,
  isHmrInterruptReason,
  PARTIAL_RUN_RESUME_REASON,
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  shouldOfferPartialRunResume,
  shouldSilentAutoContinue,
  resolveAutoResumeSeconds,
} from "../services/agentRecovery";
import {
  persistAgentRunForHmr,
  popPendingAgentRun,
  clearPendingAgentRun,
} from "../services/agentHmrRecovery";
import { compressImageDataUrlsForAgent } from "../services/imageCompress";
import {
  buildAgentHistoryFromMessages,
  stripReferenceAttachments,
  stripToolSummaryFromAssistantContent,
  updateVibeChatSessionStatus,
} from "../services/vibeChatStorage";
import {
  isAssistantExecutionBrief,
  looksLikeModificationPlan,
  findLastAssistantContentInMessages,
} from "../services/agentContinuation";
import {
  ensurePlanFileBeforeExecution,
  persistPlanFile,
  resolvePlanDocumentRelPath,
} from "../services/planFile";
import { parseAgentSuggestions, type AgentSuggestion } from "../services/agentSuggestions";
import { stripTextToolCallMarkup } from "../services/textToolCallMarkup";
import { isDeleteNotFoundError, resolveAgentDoneFileAction } from "../services/vibeAgentTurnApply";
import {
  runVibeAgentSse,
  type VibeAgentSseEvent,
  type VibeChatHistoryMessage,
  type VibeChatMode,
} from "../services/vibeAgentClient";
import {
  recordAgentRoundNarrative,
  recordAgentRoundRequest,
  recordAgentRoundResponse,
  recordAgentRoundStatus,
  recordAgentRoundToolStart,
} from "../services/agentRoundGroups";
import { computeLineDelta } from "../services/agentCursorFeed";
import type { AgentStatusData, TurnFileDiff, VibeChatMessage } from "../types/vibeChat";
import {
  finalizeAssistantBubbleContent,
  hasAgentFinalAnswer,
  commitAgentFinalAnswerIfMissing,
  hasAgentRunStructure,
  mergeAssistantTurnText,
  resolveAgentTimelineAnswer,
  type LiveAgentAnswerSource,
} from "../services/agentMessageDisplay";
import {
  buildAgentRoundGroupViewsForMessage,
  resolveAgentAnswerPreview,
} from "../services/agentMessageViewModel";
import {
  buildCompactStatusInput,
  buildCursorCompactLiveStatus,
} from "../services/agentCompactStatus";
import { parseMemoryProposalToolResult } from "../services/projectMemoryProposal";
import { parseSkillProposalToolResult } from "../services/projectSkillProposal";
import { loadWebProxyUrlFromStorage } from "../services/aiLocalConfig";
import { isAgentSseProgressEvent } from "../services/agentSseEventHandlers";
import {
  assistantTransientUiClearPatch,
  formatCharCount,
  formatToolMeta,
  genId,
  hasAgentActivity,
  hasRunningTool,
  modelStepPhaseLabel,
  roundGroupSetupLabel,
  statusLogPhaseClass,
  syncRoundGroupsPatch,
} from "../utils/vibeHelpers";
import {
  createInitialLiveState,
  formatAgentLiveStatus,
  patchLiveFromStatusEvent,
  type AgentRunLiveState,
} from "../services/agentRunLiveState";
import { createAgentSessionRunManager } from "./agentSessionRuns";
import { useAgentChainScroll } from "./useAgentChainScroll";
import { useAgentStreamPatch } from "./useAgentStreamPatch";
import { useAgentState } from "./useAgentState";
import { useAgentSSEConnection } from "./useAgentSSEConnection";
import { useAgentToolDispatch } from "./useAgentToolDispatch";

export type ChatMessage = VibeChatMessage;

function applySuggestionsToAssistantContent(assistantMsg: ChatMessage, rawContent: string): string {
  const { content, suggestions } = parseAgentSuggestions(rawContent);
  assistantMsg.agentSuggestions = suggestions.length ? suggestions : undefined;
  return content;
}

export type UseAgentRunDeps = {
  chatMessages: Ref<ChatMessage[]>;
  chatSending: Ref<boolean>;
  chatMode: Ref<VibeChatMode>;
  chatError: Ref<string>;
  projectPath: Ref<string>;
  projectOpened: Ref<boolean>;
  configReady: Ref<boolean>;
  aiConfig: Ref<{ endpoint: string; apiKey: string; model: string; providerName: string }>;
  activeAssistantMsgId: ComputedRef<string>;
  activeSessionId: Ref<string>;
  activeFilePath: Ref<string>;
  pendingPromptQueue: Ref<string[]>;
  patchAssistantMsg: (id: string, patch: Partial<ChatMessage>, sessionId?: string) => void;
  schedulePersistChat: () => void;
  schedulePersistDuringAgentRun: (options?: { sessionId?: string; flushStore?: boolean }) => void;
  persistChatNow: (path?: string, options?: { flushStore?: boolean; sessionId?: string }) => void;
  persistPendingQueue: () => void;
  scrollChatToBottom: (force?: boolean) => Promise<void>;
  resetChatScrollPin: () => void;
  isChatPinnedToBottom: () => boolean;
  reloadAiConfig: () => void;
  handleAgentWrittenFiles: (files: string[]) => Promise<void>;
  clearTurnFileDiffsFromStore: (diffs: Record<string, TurnFileDiff>) => void;
  storeFileDiff: (relPath: string, before: string, after: string, deleted?: boolean, created?: boolean) => void;
  syncEditorAfterAgentFileChange: (relPath: string, diff: TurnFileDiff) => void;
  refreshTree: () => void | Promise<void>;
  resolveUserMessageImages: (msg: ChatMessage) => string[];
  buildAgentHistory: (prompt: string, profile: AgentRunProfile) => VibeChatHistoryMessage[];
  buildAgentHistoryForResume: (assistantMsgId: string) => VibeChatHistoryMessage[];
  resolveOriginalUserPrompt: (assistantMsgId: string) => string;
  findLastUserMessage: () => { content: string } | null;
  beginAgentRunSession: (sessionId: string) => void;
  endAgentRunSession: (sessionId?: string, silent?: boolean) => void;
  persistAgentRunSession: (sessionId: string) => void;
  snapshotAgentRunSession?: (sessionId: string) => void;
  onAgentRunSettled?: (msg: ChatMessage) => void;
  /** After Plan explore writes a per-message plan file, open it in the editor. */
  onPlanFileReady?: (relPath: string, messageId: string) => void;
  onMemoryProposal?: (msgId: string, proposal: import("../services/projectMemoryProposal").MemoryProposalPayload) => void;
  onSkillProposal?: (msgId: string, proposal: import("../services/projectSkillProposal").SkillProposalPayload) => void;
};

const MAX_TOOL_FULL_RESULT_CHARS = 4_000;
const AGENT_EVENT_FRAME_BUDGET_MS = 12;

export function useAgentRun(deps: UseAgentRunDeps) {
  const {
    chatMessages,
    chatSending,
    chatMode,
    chatError,
    projectPath,
    projectOpened,
    configReady,
    aiConfig,
    activeAssistantMsgId,
    activeSessionId,
    activeFilePath,
    pendingPromptQueue,
    patchAssistantMsg,
    schedulePersistChat,
    schedulePersistDuringAgentRun,
    persistChatNow,
    persistPendingQueue,
    scrollChatToBottom,
    resetChatScrollPin,
    isChatPinnedToBottom,
    reloadAiConfig,
    handleAgentWrittenFiles,
    clearTurnFileDiffsFromStore,
    storeFileDiff,
    syncEditorAfterAgentFileChange,
    refreshTree,
    resolveUserMessageImages,
    buildAgentHistory,
    buildAgentHistoryForResume,
    resolveOriginalUserPrompt,
    findLastUserMessage,
    beginAgentRunSession,
    endAgentRunSession,
    persistAgentRunSession,
    snapshotAgentRunSession,
    onAgentRunSettled,
    onPlanFileReady,
    onMemoryProposal,
    onSkillProposal,
  } = deps;

  const state = useAgentState({
    activeSessionId,
    chatMessages,
    chatMode,
    resolveUserMessageImages,
  });

  const {
    runManager,
    agentUiTick,
    agentLiveRevision,
    stalledAssistantMsg,
    planExecutionActive,
    autoResumeSecondsLeft,
    autoResumeTargetId,
    runningAssistantMsgId,
    bumpLiveRevision,
    findRunForMsg,
    getLiveForMsg,
    resolveLiveAgentSource,
    formatLiveStatus,
    isRunVisible,
    isAgentRunning,
    isActivityDetailed,
    messageDisplayContent,
    cursorCompactLiveStatus,
    agentStatusDisplay,
    buildAgentRunningStatusTextForMsg,
    agentAbortDisplayReason,
    agentRunningHint,
    ensureDeferredCapture,
    mergeDeferredCaptureIntoMsg,
  } = state;

  const toolDispatch = useAgentToolDispatch({
    handleAgentWrittenFiles,
    clearTurnFileDiffsFromStore,
    storeFileDiff,
    syncEditorAfterAgentFileChange,
    onMemoryProposal,
    onSkillProposal,
  });

  const {
    parseAndDispatchProposals,
    resolveTurnImageSources,
    applyFileChanges,
  } = toolDispatch;

  function formatAgentStatus(data: AgentStatusData, compact = false): string {
    return formatLiveStatus(
      patchLiveFromStatusEvent(createInitialLiveState(), data.phase, data),
      compact,
    );
  }

  function maybeScrollChat(sessionId: string, force = false) {
    if (isRunVisible(sessionId)) void scrollChatToBottom(force);
  }

  function maybePersistChat(sessionId: string, options?: { flushStore?: boolean }) {
    if (isRunVisible(sessionId)) persistChatNow(undefined, options);
    else persistAgentRunSession(sessionId);
  }

  /** Agent 运行中：debounce 磁盘写入，后台 session 仍走 snapshot。 */
  function schedulePersistDuringRun(sessionId: string) {
    if (isRunVisible(sessionId)) schedulePersistDuringAgentRun({ sessionId });
    else persistAgentRunSession(sessionId);
  }

  /** 续跑、排队或倒计时恢复期间不弹「已完成」通知，仅在真正收尾时通知。 */
  function shouldSuppressAgentCompleteNotification(silent: boolean): boolean {
    if (silent) return true;
    if (pendingPromptQueue.value.length > 0) return true;
    if (autoResumeSchedulePending || autoResumeTargetId.value) return true;
    return false;
  }

  function finishRunSession(sessionId: string, silent = false) {
    const run = runManager.get(sessionId);
    if (run?.assistantMsg.role === "assistant") {
      applyInferredAgentRecovery(run.assistantMsg);
      Object.assign(run.assistantMsg, assistantTransientUiClearPatch());
      patchAssistantMsg(
        run.assistantMsg.id,
        {
          agentFailed: run.assistantMsg.agentFailed,
          agentRecoverable: run.assistantMsg.agentRecoverable,
          agentFailureReason: run.assistantMsg.agentFailureReason,
          agentRecoveryDismissed: run.assistantMsg.agentRecoveryDismissed,
          content: run.assistantMsg.content,
          activityExpanded: run.assistantMsg.activityExpanded,
          ...assistantTransientUiClearPatch(),
          ...syncRoundGroupsPatch(run.assistantMsg),
        },
        sessionId,
      );
    }
    persistAgentRunSession(sessionId);
    endAgentRunSession(sessionId, shouldSuppressAgentCompleteNotification(silent));
    runManager.remove(sessionId);
    if (runManager.size() === 0) {
      agentLastProgressAt = 0;
      stalledAssistantMsg.value = null;
      stopAgentUiTick();
    }
  }

  function updateAgentRunSessionStatus(
    sessionId: string,
    status: "completed" | "failed" | "interrupted",
  ) {
    const project = projectPath.value.trim();
    if (project && sessionId) updateVibeChatSessionStatus(project, sessionId, status);
  }

  let agentUiTickTimer: ReturnType<typeof setInterval> | null = null;
  let autoResumeTimer: ReturnType<typeof setInterval> | null = null;
  let agentLastProgressAt = 0;
  let autoResumeSchedulePending = false;

  const {
    chainJumpVisible,
    bindStatusLogScroll,
    onChainViewportScroll,
    jumpChainToLatest,
    scrollStatusLogToBottomInternal,
  } = useAgentChainScroll({ scrollChatToBottom, chatSending, activeAssistantMsgId });

  const {
    shouldMinimizeRunUiPatch,
    scheduleMinimizedRunUiPatch,
    flushMinimizedRunUiPatch,
    enqueueStreamDelta,
    clearStreamDeltaBuffer,
    scheduleStreamScroll,
    buildRunUiFullPatch,
    cleanupTimers: cleanupStreamPatchTimers,
  } = useAgentStreamPatch({
    chatSending,
    isChatPinnedToBottom,
    scrollChatToBottom,
    patchAssistantMsg,
    findRunForMsg,
    isAgentRunning,
    isRunVisible,
    formatLiveStatus,
    bumpLiveRevision,
    scrollStatusLogToBottomInternal,
    getRunPhase: (sid: string) => runManager.get(sid)?.live.phase,
    getRunAssistantMsg: (sid: string) => runManager.get(sid)?.assistantMsg,
  });

  const sseConnection = useAgentSSEConnection({
    handleAgentEvent,
  });

  const {
    clearPendingAgentEvents,
    enqueueAgentEvent,
  } = sseConnection;

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      stopAgentUiTick();
      cancelAutoResume();
      cleanupStreamPatchTimers();
      if (sseConnection.agentEventFlushRaf) {
        cancelAnimationFrame(sseConnection.agentEventFlushRaf);
      }
    });
  }

  function appendStatusLog(msg: ChatMessage, line: string) {
    const text = line.trim();
    if (!text) return;
    if (!msg.statusLog) msg.statusLog = [];
    const last = msg.statusLog[msg.statusLog.length - 1];
    if (last !== text) msg.statusLog.push(text);
  }

  function refreshStalledAssistantMsg() {
    const run = getActiveRun();
    if (!run || run.lastProgressAt <= 0) {
      stalledAssistantMsg.value = null;
      return;
    }
    if (!isAgentRunStalled(run.lastProgressAt, true)) {
      stalledAssistantMsg.value = null;
      return;
    }
    const msg = findRunningAssistantMsg();
    if (!msg || !hasRecoverableAgentProgress(msg)) {
      stalledAssistantMsg.value = null;
      return;
    }
    stalledAssistantMsg.value = msg;
  }

  function isAssistantStalled(msg: ChatMessage): boolean {
    return Boolean(stalledAssistantMsg.value && stalledAssistantMsg.value.id === msg.id);
  }

  function findRunningAssistantMsgForSession(sessionId: string): ChatMessage | null {
    const run = runManager.get(sessionId);
    if (!run) return null;
    if (isRunVisible(sessionId)) {
      return chatMessages.value.find((m) => m.id === run.assistantMsgId) ?? run.assistantMsg;
    }
    return run.assistantMsg;
  }

  function findRunningAssistantMsg(): ChatMessage | null {
    const run = getActiveRun();
    if (!run) return null;
    return findRunningAssistantMsgForSession(activeSessionId.value);
  }

  function checkAgentStallForSession(sessionId: string) {
    const run = runManager.get(sessionId);
    if (!run) return;
    const msg = findRunningAssistantMsgForSession(sessionId);
    if (!msg) return;
    const { live } = run;

    if (
      isAgentConnectStalled(run.connectStartedAt, live.phase, true) &&
      isAgentConnectPhase(live.phase)
    ) {
      abortAgentConnectStall(sessionId, msg);
      return;
    }

    const MODEL_WAIT_PHASES = ["sending_request", "waiting_model", "retrying_model"];
    const waitThreshold = resolveModelWaitStallMs(
      live.contextChars ?? 0,
      msg.agentContinueCount ?? 0,
    );
    if (
      MODEL_WAIT_PHASES.includes(live.phase) &&
      live.waitStartedAt &&
      Date.now() - live.waitStartedAt >= waitThreshold
    ) {
      recoverAgentRunFromStall(sessionId, msg, "模型请求长时间无响应（可能已卡住）");
      return;
    }

    if (run.lastProgressAt <= 0) return;
    if (!isAgentRunStalled(run.lastProgressAt, true)) return;
    if (!hasRecoverableAgentProgress(msg)) return;
    recoverAgentRunFromStall(sessionId, msg, agentStallRecoveryReason());
  }

  function checkAgentStall() {
    if (runManager.size() === 0) return;
    for (const run of runManager.listRuns()) {
      checkAgentStallForSession(run.sessionId);
    }
  }

  function touchAgentProgress(sessionId: string) {
    runManager.touchProgress(sessionId);
    if (sessionId === activeSessionId.value) {
      agentLastProgressAt = runManager.get(sessionId)?.lastProgressAt ?? Date.now();
    }
  }

  function startAgentUiTick() {
    if (agentUiTickTimer) return;
    agentUiTickTimer = setInterval(() => {
      agentUiTick.value += 1;
      let needsLiveRefresh = false;
      for (const run of runManager.listRuns()) {
        if (isAgentConnectPhase(run.live.phase)) {
          needsLiveRefresh = true;
          break;
        }
      }
      if (needsLiveRefresh) bumpLiveRevision();
      syncRunningAssistantOnUiTick();
      refreshStalledAssistantMsg();
      checkAgentStall();
    }, 2000);
  }

  function syncRunningAssistantOnUiTick() {
    for (const run of runManager.listRuns()) {
      if (!shouldMinimizeRunUiPatch(run.assistantMsg)) continue;
      patchAssistantMsg(
        run.assistantMsg.id,
        buildRunUiFullPatch(run.assistantMsg),
        run.sessionId,
      );
    }
  }

  function stopAgentUiTick() {
    if (runManager.size() > 0) return;
    if (agentUiTickTimer) {
      clearInterval(agentUiTickTimer);
      agentUiTickTimer = null;
    }
    stalledAssistantMsg.value = null;
  }

  function getActiveRun() {
    return runManager.get(activeSessionId.value);
  }

  function hasActiveAgentRun(sessionId?: string): boolean {
    const sid = (sessionId ?? activeSessionId.value).trim();
    return Boolean(sid && runManager.has(sid));
  }

  function abortAgentConnectStall(sessionId: string, msg: ChatMessage) {
    const connectHasImages = runManager.get(sessionId)?.connectHasImages ?? false;
    runManager.abort(sessionId);
    runManager.setAbortHandle(sessionId, null);
    runManager.invalidate(sessionId);
    finishRunSession(sessionId);
    clearPendingAgentRun();
    const reason = agentConnectStallMessage(connectHasImages);
    msg.agentFailed = true;
    msg.agentRecoverable = true;
    msg.agentFailureReason = reason;
    patchAssistantMsg(msg.id, {
      agentFailed: true,
      agentRecoverable: true,
      agentFailureReason: reason,
    }, sessionId);
    if (projectPath.value.trim()) {
      updateAgentRunSessionStatus(sessionId, "failed");
    }
    maybePersistChat(sessionId);
    if (isRunVisible(sessionId)) chatError.value = reason;
  }

  function setAgentStatus(
    sessionId: string,
    msg: ChatMessage,
    phase: string,
    extra?: Partial<AgentStatusData> & { toolTitle?: string; toolDetail?: string },
    options?: { log?: boolean },
  ) {
    const run = runManager.get(sessionId);
    if (!run) return;
    const prevPhase = run.live.phase;
    run.live = patchLiveFromStatusEvent(run.live, phase, extra);
    const minimizing = shouldMinimizeRunUiPatch(msg);
    if (extra?.streamChars !== undefined) msg.streamChars = extra.streamChars;
    if (extra?.contextChars !== undefined) msg.contextChars = extra.contextChars;
    if (extra?.turn) msg.agentTurn = extra.turn;
    if (extra?.maxTurns) msg.agentMaxTurns = extra.maxTurns;
    if (extra?.model) msg.agentModel = extra.model;
    msg.agentPhase = phase;
    const statusText = formatLiveStatus(run.live);
    msg.status = statusText;
    const shouldLog = !minimizing && (options?.log ?? phase !== prevPhase);
    if (shouldLog) appendStatusLog(msg, statusText);
    bumpLiveRevision();
  }

  function findLastAssistantContent(): string | undefined {
    return findLastAssistantContentInMessages(chatMessages.value, (msg) =>
      messageDisplayContent(msg as ChatMessage),
    );
  }

  function findLastActionablePlanMessage(): ChatMessage | undefined {
    for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
      const msg = chatMessages.value[i];
      if (msg?.role !== "assistant") continue;
      const text = messageDisplayContent(msg as ChatMessage).trim();
      if (text && isAssistantExecutionBrief(text)) return msg as ChatMessage;
    }
    return undefined;
  }

  async function applyPlanFileEnsureForExecution(
    planMarkdown: string,
    sourceMsg?: ChatMessage,
  ): Promise<{ planContent: string; persistError?: string }> {
    if (!sourceMsg?.id?.trim()) {
      return { planContent: planMarkdown.trim() };
    }
    const ensured = await ensurePlanFileBeforeExecution(
      projectPath.value.trim(),
      planMarkdown,
      sourceMsg.id,
      sourceMsg.planFilePath,
    );
    if (ensured.planFilePath && sourceMsg.planFilePath !== ensured.planFilePath) {
      sourceMsg.planFilePath = ensured.planFilePath;
      patchAssistantMsg(sourceMsg.id, { planFilePath: ensured.planFilePath });
      onPlanFileReady?.(ensured.planFilePath, sourceMsg.id);
      persistChatNow(undefined, { flushStore: true });
    }
    if (ensured.persistError) {
      chatError.value = `方案未能保存到 ${ensured.planFilePath ?? "磁盘"}：${ensured.persistError}。将按会话内容执行。`;
    } else {
      chatError.value = "";
    }
    return { planContent: ensured.planContent, persistError: ensured.persistError };
  }

  async function tryPersistPlanMessageToDisk(
    assistantMsg: ChatMessage,
    msgId: string,
  ): Promise<boolean> {
    const planText = messageDisplayContent(assistantMsg).trim();
    if (!looksLikeModificationPlan(planText)) return false;
    const root = projectPath.value.trim();
    if (!root) return false;
    const relPath = resolvePlanDocumentRelPath(msgId, assistantMsg.planFilePath);
    const saved = await persistPlanFile(root, planText, relPath);
    if (!saved.ok) {
      chatError.value = `方案未能保存到 ${relPath}：${saved.error || "写入失败"}`;
      return false;
    }
    assistantMsg.planFilePath = saved.path;
    patchAssistantMsg(msgId, { planFilePath: saved.path });
    onPlanFileReady?.(saved.path, msgId);
    return true;
  }

  async function maybePersistPlanFileToDisk(
    assistantMsg: ChatMessage,
    msgId: string,
    options: { wasExecutePlanRun: boolean; wasAborted: boolean },
  ): Promise<void> {
    if (options.wasAborted || assistantMsg.agentFailed) return;
    if (assistantMsg.chatMode !== "plan" || options.wasExecutePlanRun) return;
    if (await tryPersistPlanMessageToDisk(assistantMsg, msgId)) {
      persistChatNow(undefined, { flushStore: true });
    }
  }



  function cancelAutoResume() {
    autoResumeSchedulePending = false;
    if (autoResumeTimer) {
      clearInterval(autoResumeTimer);
      autoResumeTimer = null;
    }
    autoResumeSecondsLeft.value = 0;
    autoResumeTargetId.value = "";
  }

  function startAutoResumeCountdown(assistantMsgId: string, errorMessage: string) {
    const msg = chatMessages.value.find((m) => m.id === assistantMsgId);
    if (!msg || !canResumeAgentRun(msg)) return;

    autoResumeTargetId.value = assistantMsgId;
    autoResumeSecondsLeft.value = resolveAutoResumeSeconds(
      errorMessage || msg.agentFailureReason || "",
    );
    autoResumeTimer = setInterval(() => {
      if (autoResumeSecondsLeft.value <= 1) {
        const targetId = autoResumeTargetId.value;
        cancelAutoResume();
        if (targetId && !chatSending.value) void resumeAgentRun(targetId);
        return;
      }
      autoResumeSecondsLeft.value -= 1;
    }, 1000);
  }

  function scheduleAutoResume(assistantMsgId: string, errorMessage = "") {
    cancelAutoResume();
    if (!assistantMsgId || !configReady.value || !projectOpened.value) return;

    autoResumeSchedulePending = true;

    const run = () => {
      autoResumeSchedulePending = false;
      if (!assistantMsgId || chatSending.value || !configReady.value || !projectOpened.value) return;
      startAutoResumeCountdown(assistantMsgId, errorMessage);
    };

    if (chatSending.value) {
      queueMicrotask(run);
      return;
    }
    run();
  }

  function maybeAutoResumeLastRecoverableAssistant() {
    if (chatSending.value || !configReady.value || !projectOpened.value) return;
    for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
      const m = chatMessages.value[i]!;
      if (m.role === "assistant" && canResumeAgentRun(m)) {
        const reason = m.agentFailureReason || "";
        if (reason && shouldSilentAutoContinue(reason)) {
          trySilentContinue(activeSessionId.value, m, reason);
        } else {
          // Fallback: auto-resume countdown for non-silent recoverable failures
          scheduleAutoResume(m.id, reason);
        }
        return;
      }
    }
  }

  function prepareAssistantForSilentContinue(assistantMsg: ChatMessage) {
    for (const tool of assistantMsg.tools || []) {
      if (tool.running) tool.running = false;
    }
  }

  function trySilentContinue(sessionId: string, assistantMsg: ChatMessage, reason: string): boolean {
    if (!shouldSilentAutoContinue(reason)) { debugLog(`[stall-recover] trySilent: shouldSilentAutoContinue=false`); return false; }
    const count = assistantMsg.agentContinueCount ?? 0;
    if (count >= AGENT_SILENT_CONTINUE_MAX) { debugLog(`[stall-recover] trySilent: count=${count}>=max`); return false; }
    if (!configReady.value || !projectOpened.value) { debugLog(`[stall-recover] trySilent: configReady=${configReady.value}, projectOpened=${projectOpened.value}`); return false; }
    if (!resolveOriginalUserPrompt(assistantMsg.id)) { debugLog(`[stall-recover] trySilent: originalPrompt empty`); return false; }

    prepareAssistantForSilentContinue(assistantMsg);
    assistantMsg.agentContinueCount = count + 1;
    if (isRunVisible(sessionId)) chatError.value = "";
    const statusLogReason = reason.includes("自动续跑") ? reason : `连接中断（自动续跑 ${count + 1}/${AGENT_SILENT_CONTINUE_MAX}）`;
    appendStatusLog(assistantMsg, buildSilentContinueStatusLog(statusLogReason, assistantMsg.agentContinueCount));
    patchAssistantMsg(assistantMsg.id, {
      agentContinueCount: assistantMsg.agentContinueCount,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      activityExpanded: true,
      activityDetailed: false,
      tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
      ...syncRoundGroupsPatch(assistantMsg),
    }, sessionId);

    runManager.abort(sessionId);
    runManager.setAbortHandle(sessionId, null);
    finishRunSession(sessionId, true);

    window.setTimeout(() => {
      void resumeAgentRun(assistantMsg.id, { silent: true });
    }, AGENT_SILENT_CONTINUE_DELAY_MS);
    return true;
  }

  function handleRecoverableInterruption(
    sessionId: string,
    assistantMsg: ChatMessage,
    reason: string,
    options?: { logStatus?: boolean; noAutoResume?: boolean },
  ) {
    if (trySilentContinue(sessionId, assistantMsg, reason)) return;
    applyRecoverableAgentFailure(assistantMsg, reason, { ...options, noAutoResume: true });
  }

  function applyRecoverableAgentFailure(
    assistantMsg: ChatMessage,
    message: string,
    options?: { logStatus?: boolean; noAutoResume?: boolean },
  ) {
    const recoverable = isRecoverableAgentError(message);
    assistantMsg.agentFailed = true;
    assistantMsg.agentRecoverable = recoverable;
    assistantMsg.agentFailureReason = message;
    assistantMsg.agentRecoveryDismissed = false;
    if (message.trim() === "运行中断（未生成最终回复）") {
      applyMissingFinalAnswerDiagnosis(assistantMsg, {
        doneTurns: resolveAgentCompletedTurns(assistantMsg),
        chatMode: assistantMsg.chatMode,
      });
    } else {
      assistantMsg.agentFailureDetail = undefined;
    }

    const progressContent = resolveAgentFailureBubbleContent(assistantMsg);
    assistantMsg.content = progressContent;
    if (options?.logStatus !== false) {
      appendStatusLog(
        assistantMsg,
        recoverable ? `连接中断：${message}（可恢复运行）` : `错误：${message}`,
      );
    }
    if (recoverable) {
      assistantMsg.activityExpanded = true;
      assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
    }

    chatError.value = recoverable
      ? recoverableAgentErrorHint(assistantMsg, message)
      : message;

    patchAssistantMsg(assistantMsg.id, {
      agentFailed: true,
      agentRecoverable: recoverable,
      agentFailureReason: message,
      agentFailureDetail: assistantMsg.agentFailureDetail,
      agentRecoveryDismissed: false,
      content: assistantMsg.content,
      activityExpanded: recoverable ? true : assistantMsg.activityExpanded,
      totalTurns: assistantMsg.totalTurns,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      ...syncRoundGroupsPatch(assistantMsg),
    });

    // Auto-resume countdown for recoverable errors (skip if noAutoResume is set)
    if (recoverable && !options?.noAutoResume) {
      scheduleAutoResume(assistantMsg.id, message);
    }
  }

  function recoverAgentRunFromStall(sessionId: string, assistantMsg: ChatMessage, reason: string) {
    debugLog(`[stall-recover] recoverAgentRunFromStall sessionId=${sessionId}, reason=${reason}`);
    runManager.invalidate(sessionId);
    clearStreamDeltaBuffer();
    runManager.abort(sessionId);
    runManager.setAbortHandle(sessionId, null);

    const silentResult = trySilentContinue(sessionId, assistantMsg, reason);
    debugLog(`[stall-recover] trySilentContinue result=${silentResult}`);
    if (silentResult) {
      maybePersistChat(sessionId);
      maybeScrollChat(sessionId);
      return;
    }

    debugLog(`[stall-recover] trySilentContinue failed, calling finishRunSession + handleRecoverableInterruption`);
    finishRunSession(sessionId);
    handleRecoverableInterruption(sessionId, assistantMsg, reason);
    if (projectPath.value.trim()) updateAgentRunSessionStatus(sessionId, "failed");
    maybePersistChat(sessionId);
    maybeScrollChat(sessionId);
  }

  function forceRecoverStalledRun(assistantMsgId: string) {
    const msg = chatMessages.value.find((m) => m.id === assistantMsgId);
    if (!msg || msg.role !== "assistant") { debugLog(`[stall-recover] msg not found or not assistant: id=${assistantMsgId}`); return; }
    const run = getActiveRun();
    debugLog(`[stall-recover] msg found, chatSending=${chatSending.value}, run=${!!run}, runMsgId=${run?.assistantMsgId}, msgId=${msg.id}, configReady=${configReady.value}, projectOpened=${projectOpened.value}`);
    if (chatSending.value && run?.assistantMsgId === msg.id) {
      debugLog(`[stall-recover] -> recoverAgentRunFromStall`);
      recoverAgentRunFromStall(activeSessionId.value, msg, agentStallRecoveryReason());
      return;
    }
    if (canResumeAgentRun(msg)) {
      debugLog(`[stall-recover] -> resumeAgentRun (no active run)`);
      void resumeAgentRun(assistantMsgId);
    } else {
      debugLog(`[stall-recover] canResume=false, no action`);
    }
  }

  function resolveCompletedTurns(reported: number, msg: ChatMessage): number {
    if (reported > 0) {
      return (msg.totalTurns ?? 0) + reported;
    }
    return resolveAgentCompletedTurns(msg);
  }

  function dequeuePendingPromptAndRun() {
    if (!pendingPromptQueue.value.length) return;
    const next = pendingPromptQueue.value.shift()!;
    persistPendingQueue();
    void runAgentTurn(next, { skipUserBubble: true });
  }



  type EventOf<T extends string> = Extract<VibeAgentSseEvent, { type: T }>;
  type AgentEventFn = (
    event: VibeAgentSseEvent,
    assistantMsg: ChatMessage,
    sessionId: string,
    msgId: string,
  ) => void;

  function handleAgentContextEvent(event: EventOf<"agent_context">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
    assistantMsg.agentContext = event.data;
    if (shouldMinimizeRunUiPatch(assistantMsg)) {
      scheduleMinimizedRunUiPatch(sessionId, msgId, "full");
    } else {
      patchAssistantMsg(msgId, { agentContext: event.data });
    }
  }

  function handleTurnRequestEvent(event: EventOf<"turn_request">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
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

  function handleTurnResponseEvent(event: EventOf<"turn_response">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
    if (event.data.isFinal) clearStreamDeltaBuffer();
    assistantMsg.roundGroups = recordAgentRoundResponse(
      assistantMsg.roundGroups,
      event.data.turn,
      {
        assistantText: event.data.assistantText,
        toolCalls: event.data.toolCalls,
        hasToolCalls: event.data.hasToolCalls,
        isFinal: event.data.isFinal,
      },
      event.data.maxTurns,
    );
    const turnText = stripTextToolCallMarkup(
      stripToolSummaryFromAssistantContent(event.data.assistantText || ""),
    );
    if (turnText && event.data.isFinal) {
      assistantMsg.content = mergeAssistantTurnText(assistantMsg.content || "", turnText);
      assistantMsg.activityExpanded = false;
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

  function handleTurnTraceEvent(event: EventOf<"turn_trace">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
    if (!assistantMsg.turnTraces) assistantMsg.turnTraces = [];
    assistantMsg.turnTraces.push({
      turn: event.data.turn,
      maxTurns: event.data.maxTurns,
      assistantText: event.data.assistantText ?? "",
      hasToolCalls: event.data.hasToolCalls ?? false,
    });
    assistantMsg.roundGroups = recordAgentRoundNarrative(
      assistantMsg.roundGroups,
      event.data.turn,
      event.data.assistantText ?? event.data.toolCallPreamble,
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

  function handleStatusEvent(event: EventOf<"status">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
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
        stopAgentUiTick();
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
      stopAgentUiTick();
      finishRunSession(sessionId);
      updateAgentRunSessionStatus(sessionId, "interrupted");
      persistChatNow();
      if (pendingPromptQueue.value.length) {
        dequeuePendingPromptAndRun();
      }
    }
    void scrollChatToBottom();
  }

  function handleToolStartEvent(event: EventOf<"tool_start">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
    const meta = formatToolMeta(event.data.name, event.data.args);
    const toolTurn = assistantMsg.agentTurn ?? runManager.get(sessionId)?.live.turn ?? 1;
    const toolStep = {
      id: event.data.id,
      ...meta,
      args: { ...event.data.args },
      summary: "",
      ok: true,
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

  function handleFileDiffEvent(event: EventOf<"file_diff">, assistantMsg: ChatMessage, _sessionId: string, msgId: string) {
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

  function handleToolEndEvent(event: EventOf<"tool_end">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
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

  function handleMessageDeltaEvent(event: EventOf<"message_delta">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
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

  function handleMessageEvent(event: EventOf<"message">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
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

  function handleErrorEvent(event: EventOf<"error">, assistantMsg: ChatMessage, sessionId: string, _msgId: string) {
    if (isRunVisible(sessionId)) clearStreamDeltaBuffer();
    planExecutionActive.value = false;
    if (trySilentContinue(sessionId, assistantMsg, event.data.message)) {
      runManager.setAbortHandle(sessionId, null);
      return;
    }
    applyRecoverableAgentFailure(assistantMsg, event.data.message);
    finishRunSession(sessionId);
    maybePersistChat(sessionId);
    maybeScrollChat(sessionId);

    const recoverable = isRecoverableAgentError(event.data.message);
    if (!recoverable && pendingPromptQueue.value.length && isRunVisible(sessionId)) {
      dequeuePendingPromptAndRun();
    }
  }

  function handleDoneEvent(event: EventOf<"done">, assistantMsg: ChatMessage, sessionId: string, msgId: string) {
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
      assistantMsg.writtenFiles = event.data.writtenFiles?.length ? [...event.data.writtenFiles] : undefined;
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
      stopAgentUiTick();
      clearPendingAgentEvents();
      finishRunSession(sessionId);
      patchAssistantMsg(msgId, {
        ...assistantTransientUiClearPatch(),
        activityExpanded: assistantMsg.activityExpanded,
        content: assistantMsg.content,
        totalTurns: assistantMsg.totalTurns,
        writtenFiles: assistantMsg.writtenFiles,
      });
      window.setTimeout(() => {
        persistChatNow(undefined, { flushStore: true, sessionId });
        void scrollChatToBottom();
        onAgentRunSettled?.(assistantMsg);
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
      if (trySilentContinue(sessionId, assistantMsg, truncatedNotice)) {
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
      if (trySilentContinue(sessionId, assistantMsg, "连接中断（运行未完成）")) {
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
      handleRecoverableInterruption(sessionId, assistantMsg, "连接中断（运行未完成）", { logStatus: true });
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
      if (trySilentContinue(sessionId, assistantMsg, reason)) {
        assistantMsg.totalTurns = completedTurns;
        patchAssistantMsg(msgId, { totalTurns: completedTurns, ...syncRoundGroupsPatch(assistantMsg) });
        schedulePersistDuringRun(sessionId);
        persistAgentRunSession(sessionId);
        void scrollChatToBottom();
        return;
      }
      const continueBefore = assistantMsg.agentContinueCount ?? 0;
      handleRecoverableInterruption(sessionId, assistantMsg, reason, { logStatus: true });
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
      if (trySilentContinue(sessionId, assistantMsg, "连接中断（运行未完成）")) {
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
      handleRecoverableInterruption(sessionId, assistantMsg, "连接中断（运行未完成）", { logStatus: true });
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

    if (!wasAborted && hadProgress && !hasAgentFinalAnswer(assistantMsg)) {
      handleRecoverableInterruption(sessionId, assistantMsg, "运行中断（未生成最终回复）", {
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

    const turnFileDiffPaths = assistantMsg.turnFileDiffs
      ? Object.keys(assistantMsg.turnFileDiffs)
      : [];
    const fileAction = resolveAgentDoneFileAction({
      chatMode: assistantMsg.chatMode ?? "build",
      wasAborted,
      serverPendingFiles: event.data.pendingFiles || [],
      serverWrittenFiles: event.data.writtenFiles || [],
      turnFileDiffPaths,
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
      if (assistantMsg.turnFileDiffs) {
        clearTurnFileDiffsFromStore(assistantMsg.turnFileDiffs);
      }
      void handleAgentWrittenFiles(fileAction.writtenFiles);
    }

    void maybePersistPlanFileToDisk(assistantMsg, msgId, { wasExecutePlanRun, wasAborted }).then(() => {
      void scrollChatToBottom();
      onAgentRunSettled?.(assistantMsg);
      if (pendingPromptQueue.value.length) {
        dequeuePendingPromptAndRun();
      }
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
    assistantMsg: ChatMessage,
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
    if (isAgentSseProgressEvent(event.type)) touchAgentProgress(sessionId);
    const handler = agentEventHandlers.get(event.type);
    if (handler) handler(event, assistantMsg, sessionId, msgId);
  }

  function interruptSessionRun(sessionId: string, options?: { logStatus?: boolean; reason?: string }) {
    debugLog(`[interrupt] interruptSessionRun sessionId=${sessionId}, reason=${options?.reason}`);
    cancelAutoResume();
    clearPendingAgentRun();
    clearPendingAgentEvents();

    const run = runManager.get(sessionId);
    if (!run) {
      debugLog(`[interrupt] no run found for session ${sessionId}, clearing orphaned sending state`);
      runManager.abort(sessionId);
      finishRunSession(sessionId, true);
      return;
    }
    runManager.invalidate(sessionId);

    const running = run.assistantMsg;
    const reason = options?.reason?.trim() || "已被新指令打断";
    running.agentAborted = true;
    running.agentAbortReason = reason;
    if (options?.logStatus !== false) {
      appendStatusLog(running, reason);
      setAgentStatus(sessionId, running, "aborted", undefined, { log: false });
    }

    const patch: Partial<ChatMessage> = {
      agentAborted: true,
      agentAbortReason: reason,
      statusLog: running.statusLog ? [...running.statusLog] : undefined,
    };

    if (isHmrInterruptReason(reason) && hasRecoverableAgentProgress(running)) {
      running.agentFailed = true;
      running.agentRecoverable = true;
      running.agentFailureReason = reason;
      running.agentRecoveryDismissed = false;
      running.totalTurns = resolveAgentCompletedTurns(running);
      running.content = resolveAgentFailureBubbleContent(running);
      running.activityExpanded = true;
      patch.agentFailed = true;
      patch.agentRecoverable = true;
      patch.agentFailureReason = reason;
      patch.agentRecoveryDismissed = false;
      patch.totalTurns = running.totalTurns;
      patch.content = running.content;
      patch.activityExpanded = true;
      patch.statusLog = running.statusLog ? [...running.statusLog] : undefined;
      Object.assign(patch, syncRoundGroupsPatch(running));
    }

    patchAssistantMsg(running.id, patch, sessionId);
    if (isRunVisible(sessionId)) clearStreamDeltaBuffer();
    runManager.abort(sessionId);
    runManager.setAbortHandle(sessionId, null);
    // 手动停止 / 被新指令打断 → 都不应弹「已完成」通知
    finishRunSession(sessionId, true);
    if (projectPath.value.trim()) updateAgentRunSessionStatus(sessionId, "interrupted");
  }

  function interruptAgentRun(options?: { logStatus?: boolean; reason?: string }) {
    interruptSessionRun(activeSessionId.value, options);
  }

  function stopAgent() {
    debugLog(`[stop-agent] called`);
    interruptAgentRun({ reason: "已手动停止" });
  }

  function tryResumeHmrInterruptedRun(): void {
    const pending = popPendingAgentRun();
    if (!pending) return;
    if (runManager.size() > 0) return;
    // 如果项目路径不匹配，不恢复
    const currentProject = projectPath.value.trim();
    if (pending.projectPath && pending.projectPath !== currentProject) return;
    const prompt = (pending.request?.prompt as string) || "";
    if (!prompt) return;
    // 如果配置尚未就绪，不恢复
    if (!configReady.value || !projectOpened.value) return;

    // 恢复运行：显示提示并自动重发（用户气泡已在会话中，仅重发请求）
    chatError.value = "检测到之前因页面刷新中断的 Agent 运行，正在恢复…";
    const storedImages = Array.isArray(pending.request?.imageDataUrls)
      ? (pending.request.imageDataUrls as string[]).filter(Boolean)
      : [];
    void runAgentTurn(prompt, {
      skipUserBubble: true,
      imageDataUrls: storedImages,
    });
  }

  async function resumeAgentRun(assistantMsgId: string, options?: { silent?: boolean }) {
    cancelAutoResume();
    const sessionId = activeSessionId.value;
    if (!configReady.value || !projectOpened.value) {
      debugLog(`[resume] early return: configReady=${configReady.value}, projectOpened=${projectOpened.value}`);
      chatError.value = !configReady.value
        ? "请先配置 AI 模型后再恢复"
        : "请先打开项目后再恢复";
      return;
    }

    const assistantIdx = chatMessages.value.findIndex((m) => m.id === assistantMsgId);
    if (assistantIdx < 0) {
      debugLog(`[resume] early return: assistant not found id=${assistantMsgId}`);
      chatError.value = "找不到可恢复的 Agent 回复，请重新发送指令";
      return;
    }

    const assistantMsg = chatMessages.value[assistantIdx];
    if (!options?.silent && !canResumeAgentRun(assistantMsg)) {
      debugLog(`[resume] early return: canResumeAgentRun=false`);
      chatError.value = "当前运行无法恢复，请重新发送指令";
      return;
    }
    if (options?.silent && !hasRecoverableAgentProgress(assistantMsg)) {
      debugLog(`[resume] early return: silent but no recoverable progress`);
      return;
    }

    const originalPrompt = resolveOriginalUserPrompt(assistantMsgId);
    if (!originalPrompt) {
      debugLog(`[resume] early return: originalPrompt empty`);
      chatError.value = "找不到原始任务内容，无法恢复运行";
      return;
    }

    debugLog(`[resume] proceeding: sessionId=${sessionId}, silent=${!!options?.silent}`);

    if (runManager.has(sessionId)) {
      interruptSessionRun(sessionId, { logStatus: true, reason: "已被新指令打断" });
    }

    const failureReason =
      assistantMsg.agentFailureReason ||
      inferAgentRecoveryFlags(assistantMsg)?.agentFailureReason ||
      "连接中断";
    const resumeHistory = chatMessages.value
      .slice(0, assistantIdx)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content || "" }));
    const resumePrompt = buildAgentResumePrompt(assistantMsg, originalPrompt, failureReason, {
      history: resumeHistory,
    });
    const mode = assistantMsg.chatMode ?? chatMode.value;
    const runProfile = resolveAgentResumeRunProfile(
      assistantMsg,
      originalPrompt,
      mode,
      findLastAssistantContent(),
      resumeHistory,
    );

    const savedEndpoint = aiConfig.value.endpoint;
    const savedApiKey = aiConfig.value.apiKey;
    const savedModel = aiConfig.value.model;
    reloadAiConfig();
    if (!aiConfig.value.endpoint) aiConfig.value.endpoint = savedEndpoint;
    if (!aiConfig.value.apiKey) aiConfig.value.apiKey = savedApiKey;
    if (!aiConfig.value.model) aiConfig.value.model = savedModel;
    clearStreamDeltaBuffer();
    chatError.value = "";
    resetChatScrollPin();

    assistantMsg.agentFailed = false;
    assistantMsg.agentRecoverable = false;
    assistantMsg.agentFailureReason = undefined;
    assistantMsg.agentFailureDetail = undefined;
    assistantMsg.agentAborted = false;
    assistantMsg.agentAbortReason = undefined;
    assistantMsg.agentContinueCount = undefined;
    if (hasAgentRunStructure(assistantMsg) && !hasAgentFinalAnswer(assistantMsg)) {
      assistantMsg.content = "";
    }
    assistantMsg.activityExpanded = true;
    assistantMsg.activityDetailed = false;

    beginAgentRunSession(sessionId);
    const runGen = runManager.start(sessionId, assistantMsg.id, assistantMsg, false, "connecting_local");
    startAgentUiTick();
    const connectStatus = formatLiveStatus(runManager.get(sessionId)!.live);
    appendStatusLog(
      assistantMsg,
      options?.silent
        ? `继续执行（自动续跑 ${assistantMsg.agentContinueCount ?? 1}/${AGENT_SILENT_CONTINUE_MAX}）…`
        : "正在恢复运行…",
    );
    assistantMsg.roundGroups = recordAgentRoundStatus(
      assistantMsg.roundGroups,
      "connecting_local",
      connectStatus,
    );
    patchAssistantMsg(assistantMsgId, {
      agentFailed: false,
      agentRecoverable: false,
      agentFailureReason: undefined,
      agentFailureDetail: undefined,
      content: assistantMsg.content,
      agentAborted: false,
      agentAbortReason: undefined,
      agentContinueCount: undefined,
      activityExpanded: true,
      activityDetailed: false,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      ...assistantTransientUiClearPatch(),
      ...syncRoundGroupsPatch(assistantMsg),
    }, sessionId);
    persistChatNow();
    snapshotAgentRunSession?.(sessionId);
    await scrollChatToBottom(true);

    const history = shapeAgentHistoryForProfile(
      buildAgentHistoryForResume(assistantMsgId),
      runProfile,
      resumePrompt,
    );

    const handle = runVibeAgentSse(
      {
        prompt: resumePrompt,
        history,
        projectPath: projectPath.value.trim(),
        endpoint: aiConfig.value.endpoint,
        apiKey: aiConfig.value.apiKey,
        model: aiConfig.value.model,
        mode,
        maxTurns: resolveResumeMaxTurns(
          mode,
          runProfile,
          resolveAgentCompletedTurns(assistantMsg),
          mode === "explore" ? assistantMsg.agentMaxTurns : undefined,
        ),
        openFilePath: activeFilePath.value || undefined,
        runProfile: runProfile.kind === "execute_plan" ? runProfile : undefined,
        webProxyUrl: loadWebProxyUrlFromStorage() || undefined,
      },
      (event) => enqueueAgentEvent(event, assistantMsg, runGen, sessionId),
    );
    runManager.setAbortHandle(sessionId, handle);
  }

  function beginAssistantRunSlot(
    sessionId: string,
    assistantMsg: ChatMessage,
    phase: string,
    connectHasImages: boolean,
    detail?: string,
  ): number {
    if (assistantMsg.activityDetailed) {
      assistantMsg.activityDetailed = false;
      patchAssistantMsg(assistantMsg.id, { activityDetailed: false }, sessionId);
    }
    const existing = runManager.get(sessionId);
    if (existing && existing.assistantMsgId === assistantMsg.id) {
      runManager.applyStatus(sessionId, phase, { detail });
      runManager.setConnectHasImages(sessionId, connectHasImages);
      return runManager.getGeneration(sessionId);
    }
    const gen = runManager.start(sessionId, assistantMsg.id, assistantMsg, connectHasImages, phase);
    if (detail) runManager.setLive(sessionId, { detail });
    startAgentUiTick();
    return gen;
  }



  async function runAgentTurn(
    userText: string,
    options?: {
      skipUserBubble?: boolean;
      resumeAssistantMsg?: ChatMessage;
      referencedFiles?: string[];
      imageDataUrls?: string[];
      userBubbleContent?: string;
      /** Pin the target session (avoids races if activeSessionId changes during async prep). */
      sessionId?: string;
      /** When executing a specific plan message, use its content as the prior assistant plan. */
      planAssistantContent?: string;
      maxTurns?: number;
      exploreDepth?: ExploreDepth;
    },
  ): Promise<boolean> {
    const rawPrompt = userText.trim();
    const project = projectPath.value.trim();
    if (!configReady.value || !projectOpened.value) {
      chatError.value = !configReady.value
        ? "请先配置 AI 模型后再发送"
        : "请先打开项目后再发送";
      return false;
    }

    reloadAiConfig();
    clearStreamDeltaBuffer();
    const sessionId = (options?.sessionId ?? activeSessionId.value).trim();
    if (!sessionId) {
      chatError.value = "会话尚未就绪，请重新选择或新建会话";
      return false;
    }
    if (activeSessionId.value !== sessionId) {
      chatError.value = "会话已切换，发送已取消";
      return false;
    }
    const uiMode = chatMode.value;
    const earlyLastAssistant = options?.planAssistantContent ?? findLastAssistantContent();
    const askEscalation =
      uiMode === "ask"
        ? resolveAskExecutionEscalation({
            prompt: rawPrompt,
            mode: uiMode,
            lastAssistantContent: earlyLastAssistant,
            referencedFiles: options?.referencedFiles,
          })
        : null;
    const agentMode = askEscalation?.mode ?? uiMode;

    function rollbackTurnPlaceholders(skipUserBubble?: boolean) {
      const msgs = chatMessages.value;
      if (msgs.length > 0 && msgs[msgs.length - 1]?.role === "assistant") msgs.pop();
      if (!skipUserBubble && msgs.length > 0 && msgs[msgs.length - 1]?.role === "user") msgs.pop();
    }

    function attachUserImages(imageDataUrls?: string[]) {
      if (!imageDataUrls?.length || options?.skipUserBubble) return;
      for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
        const msg = chatMessages.value[i];
        if (msg?.role === "user") {
          msg.imageDataUrls = [...imageDataUrls];
          break;
        }
      }
    }

    let assistantMsg: ChatMessage;
    let compressedImagesForRequest: string[] | undefined;
    let hasImagesForRequest = false;

    if (options?.resumeAssistantMsg) {
      assistantMsg = options.resumeAssistantMsg;
      const imageSources = resolveTurnImageSources(options);
      compressedImagesForRequest = imageSources.length
        ? await compressImageDataUrlsForAgent(imageSources)
        : undefined;
      hasImagesForRequest = Boolean(compressedImagesForRequest?.length);
    } else {
      const canBootstrapEarly = Boolean(
        rawPrompt || options?.skipUserBubble || (options?.imageDataUrls?.length ?? 0) > 0,
      );

      if (canBootstrapEarly) {
        if (runManager.has(sessionId)) {
          interruptSessionRun(sessionId, { logStatus: true, reason: "已被新指令打断" });
        }
        beginAgentRunSession(sessionId);
        chatError.value = "";
        resetChatScrollPin();

        if (!options?.skipUserBubble) {
          chatMessages.value.push({
            id: genId(),
            role: "user",
            content: options?.userBubbleContent ?? stripReferenceAttachments(rawPrompt),
            imageDataUrls: options?.imageDataUrls?.length ? [...options.imageDataUrls] : undefined,
          });
        }

        assistantMsg = {
          id: genId(),
          role: "assistant",
          content: "",
          chatMode: agentMode,
          tools: [],
          roundGroups: [],
          activityExpanded: true,
          activityDetailed: false,
        };
        chatMessages.value.push(assistantMsg);
        beginAssistantRunSlot(sessionId, assistantMsg, "preparing", false);
        const bootRun = runManager.get(sessionId);
        if (bootRun) {
          appendStatusLog(assistantMsg, formatLiveStatus(bootRun.live));
        }
        snapshotAgentRunSession?.(sessionId);
        await scrollChatToBottom(true);
      }

      const imageSources = resolveTurnImageSources(options);
      compressedImagesForRequest = imageSources.length
        ? await compressImageDataUrlsForAgent(imageSources)
        : undefined;
      hasImagesForRequest = Boolean(compressedImagesForRequest?.length);

      if (!rawPrompt && !hasImagesForRequest) {
        if (canBootstrapEarly) {
          runManager.remove(sessionId);
          endAgentRunSession(sessionId, true);
          rollbackTurnPlaceholders(options?.skipUserBubble);
        }
        chatError.value = "消息无效，无法发送";
        return false;
      }

      if (canBootstrapEarly) {
        attachUserImages(compressedImagesForRequest);
        beginAssistantRunSlot(
          sessionId,
          assistantMsg!,
          "connecting_local",
          hasImagesForRequest,
          hasImagesForRequest ? "上传图片中…" : undefined,
        );
        persistChatNow(undefined, { sessionId });
        snapshotAgentRunSession?.(sessionId);
      } else {
        if (runManager.has(sessionId)) {
          interruptSessionRun(sessionId, { logStatus: true, reason: "已被新指令打断" });
        }
        beginAgentRunSession(sessionId);
        chatError.value = "";
        resetChatScrollPin();

        if (!options?.skipUserBubble) {
          chatMessages.value.push({
            id: genId(),
            role: "user",
            content: options?.userBubbleContent ?? stripReferenceAttachments(rawPrompt),
            imageDataUrls: compressedImagesForRequest?.length ? [...compressedImagesForRequest] : undefined,
          });
        }
        assistantMsg = {
          id: genId(),
          role: "assistant",
          content: "",
          chatMode: agentMode,
          tools: [],
          roundGroups: [],
          activityExpanded: true,
          activityDetailed: false,
        };
        chatMessages.value.push(assistantMsg);
        beginAssistantRunSlot(
          sessionId,
          assistantMsg,
          "connecting_local",
          hasImagesForRequest,
          hasImagesForRequest ? "上传图片中…" : undefined,
        );
        persistChatNow(undefined, { sessionId });
        snapshotAgentRunSession?.(sessionId);
        await scrollChatToBottom(true);
      }
    }

    let planAssistantContent = options?.planAssistantContent;
    const lastAssistant = planAssistantContent ?? findLastAssistantContent();
    const runProfile =
      askEscalation?.runProfile ??
      resolveAgentRunProfile({
        prompt: rawPrompt,
        mode: agentMode,
        lastAssistantContent: lastAssistant,
        referencedFiles: options?.referencedFiles,
      });
    if (runProfile.kind === "execute_plan" && !planAssistantContent && lastAssistant?.trim()) {
      const sourceMsg = findLastActionablePlanMessage();
      const ensured = await applyPlanFileEnsureForExecution(lastAssistant, sourceMsg);
      planAssistantContent = ensured.planContent;
    }
    const effectiveLastAssistant = planAssistantContent ?? lastAssistant;
    planExecutionActive.value = agentMode === "plan" && runProfile.kind === "execute_plan";
    const prompt = buildAgentPromptForProfile(
      enrichAgentUserPrompt(rawPrompt, {
        lastAssistantContent: effectiveLastAssistant,
        hasImages: hasImagesForRequest,
      }),
      runProfile,
    );

    const history = buildAgentHistory(rawPrompt, runProfile);

    const exploreDepth = options?.exploreDepth ?? "standard";
    const maxTurns =
      uiMode === "explore"
        ? resolveExploreRequestMaxTurns(
            rawPrompt,
            history,
            options?.maxTurns,
            undefined,
            exploreDepth,
          )
        : options?.maxTurns ?? resolveAgentMaxTurns(agentMode, runProfile);

    const runGen = runManager.has(sessionId)
      ? runManager.getGeneration(sessionId)
      : beginAssistantRunSlot(
          sessionId,
          assistantMsg!,
          "connecting_local",
          hasImagesForRequest,
          hasImagesForRequest ? "上传图片中…" : undefined,
        );
    const agentRequest = {
      prompt,
      history,
      projectPath: projectPath.value.trim(),
      endpoint: aiConfig.value.endpoint,
      apiKey: aiConfig.value.apiKey,
      model: aiConfig.value.model,
      mode: agentMode,
      maxTurns,
      openFilePath: activeFilePath.value || undefined,
      runProfile: runProfile.kind === "execute_plan" ? runProfile : undefined,
      imageDataUrls: compressedImagesForRequest?.length ? compressedImagesForRequest : undefined,
      webProxyUrl: loadWebProxyUrlFromStorage() || undefined,
    };
    // 持久化请求状态，以便 HMR 重载后恢复
    persistAgentRunForHmr({
      request: agentRequest as unknown as Record<string, unknown>,
      projectPath: agentRequest.projectPath,
      sessionId: sessionId || undefined,
    });
    const handle = runVibeAgentSse(
      agentRequest,
      (event) => enqueueAgentEvent(event, assistantMsg, runGen, sessionId),
    );
    runManager.setAbortHandle(sessionId, handle);
    return true;
  }

  function shouldShowMessageBubble(msg: ChatMessage): boolean {
    if (msg.role === "user") {
      return Boolean(
        msg.content?.trim()
          || msg.imageDataUrls?.length
          || msg.imageRefs?.length
          || msg.imageCount,
      );
    }
    if (hasAgentActivity(msg)) return false;
    return Boolean(messageDisplayContent(msg));
  }

  function canContinueExploreMessage(msg: ChatMessage): boolean {
    if (msg.role !== "assistant" || msg.chatMode !== "explore") return false;
    if (chatSending.value || isAgentRunning(msg)) return false;
    if (msg.agentAborted || msg.agentFailed) return false;
    return isProjectReport(messageDisplayContent(msg));
  }

  async function startExploreProject(depth: ExploreDepth = "standard") {
    chatMode.value = "explore";
    return runAgentTurn(EXPLORE_PROJECT_PRESET_PROMPT, {
      maxTurns: EXPLORE_DEPTH_MAX_TURNS[depth],
      exploreDepth: depth,
    });
  }

  async function continueExploreFromMessage(assistantMsgId: string) {
    chatMode.value = "explore";
    const assistantIdx = chatMessages.value.findIndex((m) => m.id === assistantMsgId);
    const history =
      assistantIdx >= 0
        ? chatMessages.value
            .slice(0, assistantIdx)
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.content || "" }))
        : undefined;
    const completed =
      assistantIdx >= 0
        ? resolveAgentCompletedTurns(chatMessages.value[assistantIdx]!)
        : 0;
    return runAgentTurn(EXPLORE_CONTINUE_PRESET_PROMPT, {
      maxTurns: resolveExploreRequestMaxTurns(
        EXPLORE_CONTINUE_PRESET_PROMPT,
        history,
        undefined,
        completed,
      ),
    });
  }

  async function sendExploreFollowUp(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    chatMode.value = "explore";
    return runAgentTurn(trimmed, { maxTurns: EXPLORE_FOLLOWUP_MAX_TURNS });
  }

  function canExecutePlanMessage(msg: ChatMessage): boolean {
    if (msg.role !== "assistant") return false;
    if (chatMode.value !== "plan") return false;
    if (chatSending.value || isAgentRunning(msg)) return false;
    if (msg.writtenFiles?.length) return false;
    return looksLikeModificationPlan(messageDisplayContent(msg));
  }

  async function executePlanFromMessage(messageId: string) {
    const msg = chatMessages.value.find((m) => m.id === messageId);
    if (!msg || !canExecutePlanMessage(msg)) return;
    const planText = messageDisplayContent(msg).trim();
    const { planContent } = await applyPlanFileEnsureForExecution(planText, msg);
    await runAgentTurn("改吧", {
      userBubbleContent: "执行方案",
      planAssistantContent: planContent,
    });
  }

  function getActiveLiveContextChars(): number {
    return getActiveRun()?.live.contextChars ?? 0;
  }

  return {
    autoResumeSecondsLeft,
    autoResumeTargetId,
    agentUiTick,
    agentLiveRevision,
    chainJumpVisible,
    stalledAssistantMsg,
    formatAgentStatus,
    touchAgentProgress,
    startAgentUiTick,
    stopAgentUiTick,
    setAgentStatus,
    isAgentRunning,
    isAssistantStalled,
    hasAgentActivity,
    messageDisplayContent,
    resolveLiveAgentSource,
    agentStatusDisplay,
    buildAgentRunningStatusTextForMsg,
    agentRunningHint,
    roundGroupSetupLabel,
    modelStepPhaseLabel,
    statusLogPhaseClass,
    jumpChainToLatest,
    bindStatusLogScroll,
    onChainViewportScroll,
    enqueueStreamDelta,
    clearStreamDeltaBuffer,
    cancelAutoResume,
    startAutoResumeCountdown,
    scheduleAutoResume,
    maybeAutoResumeLastRecoverableAssistant,
    prepareAssistantForSilentContinue,
    trySilentContinue,
    applyRecoverableAgentFailure,
    recoverableAgentErrorHint: (msg: ChatMessage, reason: string) => recoverableAgentErrorHint(msg, reason),
    forceRecoverStalledRun,
    handleAgentEvent,
    runAgentTurn,
    resumeAgentRun,
    stopAgent,
    interruptAgentRun,
    tryResumeHmrInterruptedRun,
    agentAbortDisplayReason,
    shouldShowMessageBubble,
    canExecutePlanMessage,
    executePlanFromMessage,
    planExecutionActive,
    scheduleStreamScroll,
    getAgentAbortHandle: () => runManager.getActiveAbortHandle(activeSessionId.value),
    findLastAssistantContent,
    getActiveLiveContextChars,
    hasActiveAgentRun,
  };
}
