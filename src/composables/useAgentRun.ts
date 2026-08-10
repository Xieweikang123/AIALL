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
  AUTO_BUG_FIX_MAX_TURNS,
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
  AGENT_SILENT_CONTINUE_MAX,
  buildAgentMaxTurnsExhaustedMessage,
  buildAgentRunningStatusText,
  buildAgentResumePrompt,
  canResumeAgentRun,
  hasRecoverableAgentProgress,
  canReuseZeroProgressAssistantSlot,
  resetAssistantMessageForNewRun,
  prepareAssistantForResume,
  inferAgentRecoveryFlags,
  isAgentMaxTurnsExhausted,
  isIncompleteAgentRunWithoutFinalAnswer,
  applyInferredAgentRecovery,
  diagnoseMissingFinalAnswer,
  isHmrInterruptReason,
  PARTIAL_RUN_RESUME_REASON,
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  shouldOfferPartialRunResume,
  extractRateLimitHintFromStatusLog,
  isRecoverableAgentError,
} from "../services/agentRecovery";
import {
  persistAgentRunForHmr,
  popPendingAgentRun,
  clearPendingAgentRun,
} from "../services/agentHmrRecovery";
import { compressImageDataUrlsForAgent } from "../services/imageCompress";
import { resolveImagesForAgentTurn } from "../services/vibeChatImageStore";
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
import { isDeleteNotFoundError, resolveAgentDoneFileAction, resolveTaskWrittenFilesForResume } from "../services/vibeAgentTurnApply";
import {
  runVibeAgentSse,
  type VibeAgentSseEvent,
  type VibeChatHistoryMessage,
  type VibeChatMode,
} from "../services/vibeAgentClient";
import { resolveAgentRequestUserIntentAsync } from "../services/agentRequestIntent";
import { formatInvokeError } from "../services/tauriInvoke";
import { formatAgentTransportErrorMessage } from "../services/agentRecovery";
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
  commitAgentFinalAnswerIfMissing,
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
import { useAgentStallRecovery } from "./useAgentStallRecovery";
import { useAgentEventHandlers } from "./useAgentEventHandlers";

export type UseAgentRunDeps = {
  chatMessages: Ref<VibeChatMessage[]>;
  chatSending: Ref<boolean>;
  chatMode: Ref<VibeChatMode>;
  chatError: Ref<string>;
  projectPath: Ref<string>;
  projectOpened: Ref<boolean>;
  configReady: Ref<boolean>;
  aiConfig: Ref<{ endpoint: string; apiKey: string; model: string; providerName: string }>;
  /** Resolve a session's pinned AI provider config; return null to fall back to global aiConfig. */
  resolveSessionAiConfig?: (sessionId: string) => { endpoint: string; apiKey: string; model: string; providerName: string } | null;
  activeAssistantMsgId: ComputedRef<string>;
  activeSessionId: Ref<string>;
  activeFilePath: Ref<string>;
  pendingPromptQueue: Ref<string[]>;
  patchAssistantMsg: (id: string, patch: Partial<VibeChatMessage>, sessionId?: string) => void;
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
  resolveUserMessageImages: (msg: VibeChatMessage) => string[];
  buildAgentHistory: (prompt: string, profile: AgentRunProfile) => VibeChatHistoryMessage[];
  buildAgentHistoryForResume: (assistantMsgId: string) => VibeChatHistoryMessage[];
  resolveOriginalUserPrompt: (assistantMsgId: string) => string;
  findLastUserMessage: () => { content: string; imageDataUrls?: string[] } | null;
  beginAgentRunSession: (sessionId: string) => void;
  endAgentRunSession: (sessionId?: string, silent?: boolean) => void;
  persistAgentRunSession: (sessionId: string) => void;
  snapshotAgentRunSession?: (sessionId: string) => void;
  onAgentRunSettled?: (msg: VibeChatMessage) => void;
  /** After Plan explore writes a per-message plan file, open it in the editor. */
  onPlanFileReady?: (relPath: string, messageId: string) => void;
  onMemoryProposal?: (msgId: string, proposal: import("../services/projectMemoryProposal").MemoryProposalPayload) => void;
  onSkillProposal?: (msgId: string, proposal: import("../services/projectSkillProposal").SkillProposalPayload) => void;
};

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
    resolveSessionAiConfig,
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

  /** Apply a session's pinned provider config onto aiConfig (falls back to global when not pinned). */
  function applySessionAiConfig(sessionId: string) {
    const cfg = resolveSessionAiConfig?.(sessionId);
    if (!cfg) return;
    if (cfg.endpoint) aiConfig.value.endpoint = cfg.endpoint;
    if (cfg.apiKey) aiConfig.value.apiKey = cfg.apiKey;
    if (cfg.model) aiConfig.value.model = cfg.model;
    if (cfg.providerName) aiConfig.value.providerName = cfg.providerName;
  }

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

  let stallRecovery!: ReturnType<typeof useAgentStallRecovery>;

  /** 续跑、排队或倒计时恢复期间不弹「已完成」通知，仅在真正收尾时通知。 */
  function shouldSuppressAgentCompleteNotification(silent: boolean): boolean {
    if (silent) return true;
    if (pendingPromptQueue.value.length > 0) return true;
    if (stallRecovery.isAutoResumePending()) return true;
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
      stallRecovery.resetAgentLastProgressAt();
      stalledAssistantMsg.value = null;
      stallRecovery.stopAgentUiTick();
    }
  }

  function updateAgentRunSessionStatus(
    sessionId: string,
    status: "completed" | "failed" | "interrupted",
  ) {
    const project = projectPath.value.trim();
    if (project && sessionId) updateVibeChatSessionStatus(project, sessionId, status);
  }

  const pendingSettleTimerRef = { current: null as number | null };

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

  function appendStatusLog(msg: VibeChatMessage, line: string) {
    const text = line.trim();
    if (!text) return;
    if (!msg.statusLog) msg.statusLog = [];
    const last = msg.statusLog[msg.statusLog.length - 1];
    if (last !== text) msg.statusLog.push(text);
  }

  function getActiveRun() {
    return runManager.get(activeSessionId.value);
  }

  function findRunningAssistantMsgForSession(sessionId: string): VibeChatMessage | null {
    const run = runManager.get(sessionId);
    if (!run) return null;
    if (isRunVisible(sessionId)) {
      return chatMessages.value.find((m) => m.id === run.assistantMsgId) ?? run.assistantMsg;
    }
    return run.assistantMsg;
  }

  function findRunningAssistantMsg(): VibeChatMessage | null {
    const run = getActiveRun();
    if (!run) return null;
    return findRunningAssistantMsgForSession(activeSessionId.value);
  }

  stallRecovery = useAgentStallRecovery({
    runManager,
    chatMessages,
    activeSessionId,
    chatSending,
    chatError,
    projectPath,
    projectOpened,
    configReady,
    stalledAssistantMsg,
    autoResumeSecondsLeft,
    autoResumeTargetId,
    agentUiTick,
    bumpLiveRevision,
    patchAssistantMsg,
    isRunVisible,
    resolveOriginalUserPrompt,
    appendStatusLog,
    clearStreamDeltaBuffer,
    shouldMinimizeRunUiPatch,
    buildRunUiFullPatch,
    finishRunSession,
    maybePersistChat,
    maybeScrollChat,
    updateAgentRunSessionStatus,
    resumeAgentRun,
    getActiveRun,
    findRunningAssistantMsgForSession,
    findRunningAssistantMsg,
  });

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      stallRecovery.cleanupStallRecoveryTimers();
    });
  }

  function hasActiveAgentRun(sessionId?: string): boolean {
    const sid = (sessionId ?? activeSessionId.value).trim();
    return Boolean(sid && runManager.has(sid));
  }

  function setAgentStatus(
    sessionId: string,
    msg: VibeChatMessage,
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

  async function resolveIntentForAgentRequest(input: {
    prompt: string;
    history?: Array<{ role: string; content: string }>;
    mode: VibeChatMode;
    hasImage: boolean;
    sessionId: string;
    assistantMsg: VibeChatMessage;
  }) {
    return resolveAgentRequestUserIntentAsync(
      {
        prompt: input.prompt,
        history: input.history,
        mode: input.mode,
        hasImage: input.hasImage,
        endpoint: aiConfig.value.endpoint,
        apiKey: aiConfig.value.apiKey,
        model: aiConfig.value.model,
        projectPath: projectPath.value.trim() || undefined,
      },
      (phase, detail) => {
        setAgentStatus(input.sessionId, input.assistantMsg, phase, {
          model: aiConfig.value.model,
          detail,
        });
      },
    );
  }

  function findLastAssistantContent(): string | undefined {
    return findLastAssistantContentInMessages(chatMessages.value, (msg) =>
      messageDisplayContent(msg as VibeChatMessage),
    );
  }

  function findLastActionablePlanMessage(): VibeChatMessage | undefined {
    for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
      const msg = chatMessages.value[i];
      if (msg?.role !== "assistant") continue;
      const text = messageDisplayContent(msg as VibeChatMessage).trim();
      if (text && isAssistantExecutionBrief(text)) return msg as VibeChatMessage;
    }
    return undefined;
  }

  async function applyPlanFileEnsureForExecution(
    planMarkdown: string,
    sourceMsg?: VibeChatMessage,
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
    assistantMsg: VibeChatMessage,
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
    assistantMsg: VibeChatMessage,
    msgId: string,
    options: { wasExecutePlanRun: boolean; wasAborted: boolean },
  ): Promise<void> {
    if (options.wasAborted || assistantMsg.agentFailed) return;
    if (assistantMsg.chatMode !== "plan" || options.wasExecutePlanRun) return;
    if (await tryPersistPlanMessageToDisk(assistantMsg, msgId)) {
      persistChatNow(undefined, { flushStore: true });
    }
  }



  function resolveCompletedTurns(reported: number, msg: VibeChatMessage): number {
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



  const { handleAgentEvent } = useAgentEventHandlers({
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
    clearPendingAgentEvents: () => sseConnection.clearPendingAgentEvents(),
    isRunVisible,
    mergeDeferredCaptureIntoMsg,
    appendStatusLog,
    resolveOriginalUserPrompt,
    maybePersistPlanFileToDisk,
    onAgentRunSettled,
    onMemoryProposal,
    onSkillProposal,
    storeFileDiff,
    syncEditorAfterAgentFileChange,
    refreshTree,
    clearTurnFileDiffsFromStore,
    handleAgentWrittenFiles,
    resolveCompletedTurns,
  });

  const sseConnection = useAgentSSEConnection({ handleAgentEvent });
  const { clearPendingAgentEvents, enqueueAgentEvent } = sseConnection;

  function bindAgentRunInvoke(
    sessionId: string,
    assistantMsg: VibeChatMessage,
    runGen: number,
    handle: ReturnType<typeof runVibeAgentSse>,
  ) {
    runManager.setAbortHandle(sessionId, handle);
    const promise = "promise" in handle ? handle.promise : undefined;
    if (!promise) return;
    void promise.catch((error: unknown) => {
      if (!runManager.isValid(sessionId, runGen)) return;
      const message = formatAgentTransportErrorMessage(
        formatInvokeError(error, "Agent 运行异常退出"),
      );
      handleAgentEvent(
        { type: "error", data: { message } },
        assistantMsg,
        runGen,
        sessionId,
      );
    });
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (pendingSettleTimerRef.current) {
        clearTimeout(pendingSettleTimerRef.current);
        pendingSettleTimerRef.current = null;
      }
      cleanupStreamPatchTimers();
      if (sseConnection.agentEventFlushRaf) {
        cancelAnimationFrame(sseConnection.agentEventFlushRaf);
      }
    });
  }
  function interruptSessionRun(sessionId: string, options?: { logStatus?: boolean; reason?: string }) {
    debugLog(`[interrupt] interruptSessionRun sessionId=${sessionId}, reason=${options?.reason}`);
    stallRecovery.cancelAutoResume();
    const reason = options?.reason?.trim() || "已被新指令打断";
    const hmrInterrupt = isHmrInterruptReason(reason);
    if (!hmrInterrupt) {
      clearPendingAgentRun();
    }
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
    running.agentAborted = true;
    running.agentAbortReason = reason;
    if (options?.logStatus !== false) {
      appendStatusLog(running, reason);
      setAgentStatus(sessionId, running, "aborted", undefined, { log: false });
    }

    const patch: Partial<VibeChatMessage> = {
      agentAborted: true,
      agentAbortReason: reason,
      statusLog: running.statusLog ? [...running.statusLog] : undefined,
    };

    if (hmrInterrupt) {
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

      const originalPrompt = resolveOriginalUserPrompt(running.id) || "";
      if (originalPrompt) {
        const priorUser = [...chatMessages.value]
          .slice(0, chatMessages.value.findIndex((m) => m.id === running.id))
          .reverse()
          .find((m) => m.role === "user");
        const imageDataUrls = priorUser?.imageDataUrls?.filter(Boolean);
        persistAgentRunForHmr({
          request: {
            prompt: originalPrompt,
            ...(imageDataUrls?.length ? { imageDataUrls: [...imageDataUrls] } : {}),
          },
          projectPath: projectPath.value.trim(),
          sessionId: sessionId || undefined,
        });
      }
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

  function pauseAgent() {
    debugLog(`[pause-agent] called`);
    interruptAgentRun({ reason: "已暂停，可继续" });
  }

  function tryResumeHmrInterruptedRun(): void {
    if (runManager.size() > 0 || chatSending.value) return;
    if (!configReady.value || !projectOpened.value) return;

    const currentProject = projectPath.value.trim();

    for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
      const m = chatMessages.value[i]!;
      if (m.role !== "assistant") continue;
      const reason = m.agentFailureReason || m.agentAbortReason || "";
      if (!isHmrInterruptReason(reason) || !canResumeAgentRun(m)) continue;
      clearPendingAgentRun();
      void resumeAgentRun(m.id, { silent: true });
      return;
    }

    const pending = popPendingAgentRun();
    if (!pending) return;
    if (pending.projectPath && pending.projectPath !== currentProject) return;
    const prompt = (pending.request?.prompt as string) || "";
    const storedImages = Array.isArray(pending.request?.imageDataUrls)
      ? (pending.request.imageDataUrls as string[]).filter(Boolean)
      : [];
    if (!prompt && !storedImages.length) return;

    chatError.value = "检测到之前因页面刷新中断的 Agent 运行，正在恢复…";
    void runAgentTurn(prompt || "请结合附带的图片回答。", {
      skipUserBubble: true,
      imageDataUrls: storedImages,
    });
  }

  async function resumeAgentRun(assistantMsgId: string, options?: { silent?: boolean }) {
    stallRecovery.cancelAutoResume();
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
    applySessionAiConfig(sessionId);
    if (!aiConfig.value.endpoint) aiConfig.value.endpoint = savedEndpoint;
    if (!aiConfig.value.apiKey) aiConfig.value.apiKey = savedApiKey;
    if (!aiConfig.value.model) aiConfig.value.model = savedModel;
    clearStreamDeltaBuffer({ discard: true, msgId: assistantMsgId });
    chatError.value = "";
    resetChatScrollPin();

    assistantMsg.agentFailed = false;
    assistantMsg.agentRecoverable = false;
    assistantMsg.agentFailureReason = undefined;
    assistantMsg.agentFailureDetail = undefined;
    assistantMsg.agentAborted = false;
    assistantMsg.agentAbortReason = undefined;
    assistantMsg.agentContinueCount = undefined;
    prepareAssistantForResume(assistantMsg);
    assistantMsg.activityExpanded = true;
    assistantMsg.activityDetailed = false;

    beginAgentRunSession(sessionId);
    const runGen = runManager.start(sessionId, assistantMsg.id, assistantMsg, false, "connecting_local");
    stallRecovery.startAgentUiTick();
    const run = runManager.get(sessionId);
    const connectStatus = formatLiveStatus(run?.live ?? { phase: "connecting_local" });
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
    const resumeImageSources = await resolveImagesForAgentTurn(
      projectPath.value.trim(),
      chatMessages.value.slice(0, assistantIdx),
    );
    const resumeImagesForRequest = resumeImageSources.length
      ? await compressImageDataUrlsForAgent(resumeImageSources)
      : undefined;
    const resumeHasImage = Boolean(resumeImagesForRequest?.length);
    const resolvedUserIntent = await resolveIntentForAgentRequest({
      prompt: resumePrompt,
      history,
      mode,
      hasImage: resumeHasImage,
      sessionId,
      assistantMsg,
    });

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
        taskWrittenFiles: resolveTaskWrittenFilesForResume({
          writtenFiles: assistantMsg.writtenFiles,
          tools: assistantMsg.tools,
        }),
        resolvedUserIntent,
        imageDataUrls: resumeImagesForRequest,
      },
      (event) => enqueueAgentEvent(event, assistantMsg, runGen, sessionId),
    );
    bindAgentRunInvoke(sessionId, assistantMsg, runGen, handle);
  }

  function beginAssistantRunSlot(
    sessionId: string,
    assistantMsg: VibeChatMessage,
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
    stallRecovery.startAgentUiTick();
    return gen;
  }



  async function runAgentTurn(
    userText: string,
    options?: {
      skipUserBubble?: boolean;
      resumeAssistantMsg?: VibeChatMessage;
      referencedFiles?: string[];
      imageDataUrls?: string[];
      userBubbleContent?: string;
      /** Pin the target session (avoids races if activeSessionId changes during async prep). */
      sessionId?: string;
      /** When executing a specific plan message, use its content as the prior assistant plan. */
      planAssistantContent?: string;
      maxTurns?: number;
      exploreDepth?: ExploreDepth;
      runProfileOverride?: AgentRunProfile;
      forceBuildMode?: boolean;
      noAutoResume?: boolean;
      suppressHmrRecovery?: boolean;
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
    applySessionAiConfig(sessionId);
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
    const agentMode = options?.forceBuildMode ? "build" : (askEscalation?.mode ?? uiMode);

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

    /** Same user turn + skipUserBubble: reuse a zero-progress assistant shell instead of stacking. */
    function takeOrCreateAssistantSlot(): VibeChatMessage {
      if (options?.skipUserBubble) {
        const last = chatMessages.value[chatMessages.value.length - 1];
        if (last?.role === "assistant" && canReuseZeroProgressAssistantSlot(last)) {
          resetAssistantMessageForNewRun(last, agentMode);
          patchAssistantMsg(last.id, {
            content: "",
            chatMode: agentMode,
            tools: [],
            roundGroups: [],
            turnTraces: undefined,
            statusLog: undefined,
            writtenFiles: undefined,
            turnFileDiffs: undefined,
            totalTurns: undefined,
            agentAborted: false,
            agentAbortReason: undefined,
            agentFailed: false,
            agentRecoverable: false,
            agentFailureReason: undefined,
            agentFailureDetail: undefined,
            agentRecoveryDismissed: undefined,
            agentContinueCount: undefined,
            activityExpanded: true,
            activityDetailed: false,
            ...assistantTransientUiClearPatch(),
          }, sessionId);
          return last;
        }
      }
      const created: VibeChatMessage = {
        id: genId(),
        role: "assistant",
        content: "",
        chatMode: agentMode,
        tools: [],
        roundGroups: [],
        activityExpanded: true,
        activityDetailed: false,
      };
      chatMessages.value.push(created);
      return created;
    }

    let assistantMsg: VibeChatMessage | undefined;
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

        assistantMsg = takeOrCreateAssistantSlot();
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
        assistantMsg = takeOrCreateAssistantSlot();
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

    if (!assistantMsg) return false;

    if (options?.noAutoResume) {
      assistantMsg.agentRecoveryDismissed = true;
    }

    let planAssistantContent = options?.planAssistantContent;
    const lastAssistant = planAssistantContent ?? findLastAssistantContent();
    const runProfile =
      options?.runProfileOverride ??
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
        : options?.maxTurns
          ?? (runProfile.triggerSource === "auto_bug_fix" ? AUTO_BUG_FIX_MAX_TURNS : resolveAgentMaxTurns(agentMode, runProfile));

    const runGen = runManager.has(sessionId)
      ? runManager.getGeneration(sessionId)
      : beginAssistantRunSlot(
          sessionId,
          assistantMsg,
          "connecting_local",
          hasImagesForRequest,
          hasImagesForRequest ? "上传图片中…" : undefined,
        );
    const resolvedUserIntent = await resolveIntentForAgentRequest({
      prompt,
      history,
      mode: agentMode,
      hasImage: Boolean(compressedImagesForRequest?.length),
      sessionId,
      assistantMsg,
    });
    // await 期间如果 interruptSessionRun 被调用，run 已被移除，不要起 SSE 连接
    if (!runManager.isValid(sessionId, runGen)) {
      return false;
    }
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
      resolvedUserIntent,
    };
    if (!options?.suppressHmrRecovery) {
      persistAgentRunForHmr({
        request: agentRequest as unknown as Record<string, unknown>,
        projectPath: projectPath.value.trim(),
        sessionId: sessionId || undefined,
      });
    }
    const handle = runVibeAgentSse(
      agentRequest,
      (event) => enqueueAgentEvent(event, assistantMsg, runGen, sessionId),
    );
    bindAgentRunInvoke(sessionId, assistantMsg, runGen, handle);
    return true;
  }

  function shouldShowMessageBubble(msg: VibeChatMessage): boolean {
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

  function canContinueExploreMessage(msg: VibeChatMessage): boolean {
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

  function canExecutePlanMessage(msg: VibeChatMessage): boolean {
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

  async function runAutoBugFixAgent(params: {
    prompt: string;
    userBubbleContent: string;
    runProfile: AgentRunProfile;
    sessionId: string;
  }): Promise<{ ok: boolean; assistantMsgId?: string }> {
    chatMode.value = "build";
    const sessionId = params.sessionId.trim();
    const ok = await runAgentTurn(params.prompt, {
      sessionId,
      userBubbleContent: params.userBubbleContent,
      runProfileOverride: params.runProfile,
      forceBuildMode: true,
      noAutoResume: true,
      suppressHmrRecovery: true,
    });
    if (!ok) return { ok: false };
    for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
      const msg = chatMessages.value[i];
      if (msg?.role === "assistant") return { ok: true, assistantMsgId: msg.id };
    }
    return { ok: true };
  }

  const {
    touchAgentProgress,
    startAgentUiTick,
    stopAgentUiTick,
    isAssistantStalled,
    cancelAutoResume,
    startAutoResumeCountdown,
    scheduleAutoResume,
    maybeAutoResumeLastRecoverableAssistant,
    prepareAssistantForSilentContinue,
    trySilentContinue,
    applyRecoverableAgentFailure,
    forceRecoverStalledRun,
  } = stallRecovery;

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
    recoverableAgentErrorHint: (msg: VibeChatMessage, reason: string) => recoverableAgentErrorHint(msg, reason),
    forceRecoverStalledRun,
    handleAgentEvent,
    runAgentTurn,
    runAutoBugFixAgent,
    resumeAgentRun,
    stopAgent,
    pauseAgent,
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
