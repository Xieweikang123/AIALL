import { type Ref } from "vue";
import { debugLog } from "../utils/debugLog";
import {
  AGENT_SILENT_CONTINUE_MAX,
  resolveSilentContinueDelayMs,
  agentStallRecoveryReason,
  agentConnectStallMessage,
  buildSilentContinueStatusLog,
  canResumeAgentRun,
  hasRecoverableAgentProgress,
  isAgentClassifyStalled,
  isAgentConnectPhase,
  isAgentConnectStalled,
  isAgentRunStalled,
  isAgentRuntimeReferenceError,
  isHmrInterruptReason,
  isRecoverableAgentError,
  applyMissingFinalAnswerDiagnosis,
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  resolveAutoResumeSeconds,
  resolveModelWaitStallMs,
  shouldSilentAutoContinue,
  formatAgentTransportErrorMessage,
} from "../services/agentRecovery";
import { clearPendingAgentRun } from "../services/agentHmrRecovery";
import { syncRoundGroupsPatch } from "../utils/vibeHelpers";
import type { VibeChatMessage } from "../types/vibeChat";
import type { createAgentSessionRunManager } from "./agentSessionRuns";

type SessionRunManager = ReturnType<typeof createAgentSessionRunManager<VibeChatMessage>>;

export interface UseAgentStallRecoveryDeps {
  runManager: SessionRunManager;
  chatMessages: Ref<VibeChatMessage[]>;
  activeSessionId: Ref<string>;
  chatSending: Ref<boolean>;
  chatError: Ref<string>;
  projectPath: Ref<string>;
  projectOpened: Ref<boolean>;
  configReady: Ref<boolean>;
  stalledAssistantMsg: Ref<VibeChatMessage | null>;
  autoResumeSecondsLeft: Ref<number>;
  autoResumeTargetId: Ref<string>;
  agentUiTick: Ref<number>;
  bumpLiveRevision: () => void;
  patchAssistantMsg: (
    msgId: string,
    patch: Partial<VibeChatMessage>,
    sessionId?: string,
  ) => void;
  isRunVisible: (sessionId: string) => boolean;
  resolveOriginalUserPrompt: (msgId: string) => string | undefined;
  appendStatusLog: (msg: VibeChatMessage, line: string) => void;
  clearStreamDeltaBuffer: () => void;
  shouldMinimizeRunUiPatch: (msg: VibeChatMessage) => boolean;
  buildRunUiFullPatch: (msg: VibeChatMessage) => Partial<VibeChatMessage>;
  finishRunSession: (sessionId: string, silent?: boolean) => void;
  maybePersistChat: (sessionId: string) => void;
  maybeScrollChat: (sessionId: string) => void;
  updateAgentRunSessionStatus: (
    sessionId: string,
    status: "completed" | "failed" | "interrupted",
  ) => void;
  resumeAgentRun: (assistantMsgId: string, options?: { silent?: boolean }) => Promise<void>;
  getActiveRun: () => ReturnType<SessionRunManager["get"]>;
  findRunningAssistantMsgForSession: (sessionId: string) => VibeChatMessage | null;
  findRunningAssistantMsg: () => VibeChatMessage | null;
}

export function useAgentStallRecovery(deps: UseAgentStallRecoveryDeps) {
  const {
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
  } = deps;

  let agentUiTickTimer: ReturnType<typeof setInterval> | null = null;
  let autoResumeTimer: ReturnType<typeof setInterval> | null = null;
  let agentLastProgressAt = 0;
  let autoResumeSchedulePending = false;
  let silentContinueTimer: number | null = null;

  function isAutoResumePending(): boolean {
    return autoResumeSchedulePending || Boolean(autoResumeTargetId.value);
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

    if (isAgentClassifyStalled(run.connectStartedAt, live.phase, true)) {
      recoverAgentRunFromStall(sessionId, msg, "意图分类请求长时间无响应（可能已卡住）");
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
      const LIVE_REFRESH_PHASES = new Set([
        "connecting_local",
        "stream_connected",
        "connected",
        "reconnecting",
        "building_context",
        "compacting_context",
        "classifying_intent",
        "waiting_model",
        "sending_request",
        "retrying_model",
        "executing_tool",
        "executing_tools",
        "planning_tools",
        "summarizing_tools",
        "streaming_model",
      ]);
      for (const run of runManager.listRuns()) {
        if (LIVE_REFRESH_PHASES.has(run.live.phase)) {
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

  function isAssistantStalled(msg: VibeChatMessage): boolean {
    return Boolean(stalledAssistantMsg.value && stalledAssistantMsg.value.id === msg.id);
  }

  function abortAgentConnectStall(sessionId: string, msg: VibeChatMessage) {
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
      if (m.role !== "assistant") continue;
      const reason = m.agentFailureReason || m.agentAbortReason || "";
      if (isHmrInterruptReason(reason) && canResumeAgentRun(m)) {
        clearPendingAgentRun();
        void resumeAgentRun(m.id, { silent: true });
        return;
      }
      if (canResumeAgentRun(m)) {
        if (reason && shouldSilentAutoContinue(reason)) {
          trySilentContinue(activeSessionId.value, m, reason);
        } else {
          scheduleAutoResume(m.id, reason);
        }
        return;
      }
    }
  }

  function prepareAssistantForSilentContinue(assistantMsg: VibeChatMessage) {
    for (const tool of assistantMsg.tools || []) {
      if (tool.running) tool.running = false;
    }
  }

  function trySilentContinue(sessionId: string, assistantMsg: VibeChatMessage, reason: string): boolean {
    if (isAgentRuntimeReferenceError(reason)) {
      debugLog(`[stall-recover] trySilent: runtime reference error — no silent continue`);
      return false;
    }
    if (!shouldSilentAutoContinue(reason)) { debugLog(`[stall-recover] trySilent: shouldSilentAutoContinue=false`); return false; }
    const originalPrompt = resolveOriginalUserPrompt(assistantMsg.id) ?? "";
    if (originalPrompt.includes("[AUTO_BUG_FIX]")) {
      debugLog(`[stall-recover] trySilent: auto bug fix run — no silent continue`);
      return false;
    }
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

    const silentContinueDelayMs = resolveSilentContinueDelayMs(reason);
    silentContinueTimer = window.setTimeout(() => {
      silentContinueTimer = null;
      void resumeAgentRun(assistantMsg.id, { silent: true });
    }, silentContinueDelayMs);
    return true;
  }

  function handleRecoverableInterruption(
    sessionId: string,
    assistantMsg: VibeChatMessage,
    reason: string,
    options?: { logStatus?: boolean; noAutoResume?: boolean },
  ) {
    if (trySilentContinue(sessionId, assistantMsg, reason)) return;
    applyRecoverableAgentFailure(assistantMsg, reason, { ...options, noAutoResume: true });
  }

  function applyRecoverableAgentFailure(
    assistantMsg: VibeChatMessage,
    message: string,
    options?: { logStatus?: boolean; noAutoResume?: boolean },
  ) {
    const normalizedMessage = formatAgentTransportErrorMessage(message);
    const recoverable = isRecoverableAgentError(normalizedMessage);
    assistantMsg.agentFailed = true;
    assistantMsg.agentRecoverable = recoverable;
    assistantMsg.agentFailureReason = normalizedMessage;
    assistantMsg.agentRecoveryDismissed = false;
    if (normalizedMessage === "运行中断（未生成最终回复）") {
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
        recoverable ? `连接中断：${normalizedMessage}（可恢复运行）` : `错误：${normalizedMessage}`,
      );
    }
    if (recoverable) {
      assistantMsg.activityExpanded = true;
      assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
    }

    chatError.value = recoverable
      ? recoverableAgentErrorHint(assistantMsg, normalizedMessage)
      : normalizedMessage;

    patchAssistantMsg(assistantMsg.id, {
      agentFailed: true,
      agentRecoverable: recoverable,
      agentFailureReason: normalizedMessage,
      agentFailureDetail: assistantMsg.agentFailureDetail,
      agentRecoveryDismissed: false,
      content: assistantMsg.content,
      activityExpanded: recoverable ? true : assistantMsg.activityExpanded,
      totalTurns: assistantMsg.totalTurns,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      ...syncRoundGroupsPatch(assistantMsg),
    });

    if (recoverable && !options?.noAutoResume) {
      scheduleAutoResume(assistantMsg.id, message);
    }
  }

  function recoverAgentRunFromStall(sessionId: string, assistantMsg: VibeChatMessage, reason: string) {
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

  function cleanupStallRecoveryTimers() {
    // 组件卸载时强制清除定时器（HMR 场景），不受活跃 run 限制
    if (agentUiTickTimer) {
      clearInterval(agentUiTickTimer);
      agentUiTickTimer = null;
    }
    stalledAssistantMsg.value = null;
    cancelAutoResume();
    if (silentContinueTimer) {
      clearTimeout(silentContinueTimer);
      silentContinueTimer = null;
    }
  }

  function resetAgentLastProgressAt() {
    agentLastProgressAt = 0;
  }

  return {
    isAutoResumePending,
    touchAgentProgress,
    startAgentUiTick,
    stopAgentUiTick,
    refreshStalledAssistantMsg,
    isAssistantStalled,
    cancelAutoResume,
    startAutoResumeCountdown,
    scheduleAutoResume,
    maybeAutoResumeLastRecoverableAssistant,
    prepareAssistantForSilentContinue,
    trySilentContinue,
    handleRecoverableInterruption,
    applyRecoverableAgentFailure,
    recoverAgentRunFromStall,
    forceRecoverStalledRun,
    cleanupStallRecoveryTimers,
    resetAgentLastProgressAt,
  };
}
