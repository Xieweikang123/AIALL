import { ref, nextTick, reactive, type ComputedRef, type Ref } from "vue";
import { debugLog } from "../utils/debugLog";
import {
  buildAgentPromptForProfile,
  enrichAgentUserPrompt,
  resolveAgentMaxTurns,
  resolveAgentResumeRunProfile,
  resolveResumeMaxTurns,
  resolveAgentRunProfile,
  shapeAgentHistoryForProfile,
  type AgentRunProfile,
} from "../services/agentRunProfile";
import {
  AGENT_SILENT_CONTINUE_DELAY_MS,
  AGENT_SILENT_CONTINUE_MAX,
  AGENT_MODEL_WAIT_STALL_MS,
  AGENT_CONTINUE_MODEL_WAIT_STALL_MS,
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
import { looksLikeModificationPlan, findLastAssistantContentInMessages } from "../services/agentContinuation";
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
  buildAgentRoundGroupViews,
  recordAgentRoundNarrative,
  recordAgentRoundRequest,
  recordAgentRoundResponse,
  recordAgentRoundStatus,
  recordAgentRoundStreamDelta,
  recordAgentRoundToolStart,
  type AgentRoundGroupView,
} from "../services/agentRoundGroups";
import {
  buildCursorAgentFeed,
  computeExplorationStats,
  computeLineDelta,
  cursorActionClass,
  formatCursorActionLabel,
  formatExplorationSummary,
  getRecentFeedActions,
  getRunningFeedAction,
  buildCursorAgentTimeline,
  shouldUseCompactAgentFeed as shouldUseCompactAgentFeedByCount,
  type CursorAgentTimeline,
} from "../services/agentCursorFeed";
import type { AgentLogLineItem } from "../types/agentLog";
import type { AgentStatusData, TurnFileDiff, VibeChatMessage } from "../types/vibeChat";
import {
  finalizeAssistantBubbleContent,
  filterDuplicateFeedThoughts,
  hasAgentFinalAnswer,
  hasAgentRunStructure,
  mergeAssistantTurnText,
  resolveLiveAgentAnswerPreview,
  resolveAgentTimelineAnswer,
  isAgentTimelineAnswerStreaming,
} from "../services/agentMessageDisplay";
import { parseMemoryProposalToolResult } from "../services/projectMemoryProposal";
import { parseSkillProposalToolResult } from "../services/projectSkillProposal";
import { isAgentSseProgressEvent } from "../services/agentSseEventHandlers";
import { isScrollNearBottom, scrollElementToBottom } from "../utils/scrollViewport";
import {
  assistantTransientUiClearPatch,
  formatCharCount,
  formatToolMeta,
  genId,
  syncRoundGroupsPatch,
} from "../utils/vibeHelpers";
import {
  createInitialLiveState,
  formatAgentLiveStatus,
  patchLiveFromStatusEvent,
  type AgentRunLiveState,
} from "../services/agentRunLiveState";
import { createAgentSessionRunManager } from "./agentSessionRuns";

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
  onMemoryProposal?: (msgId: string, proposal: import("../services/projectMemoryProposal").MemoryProposalPayload) => void;
  onSkillProposal?: (msgId: string, proposal: import("../services/projectSkillProposal").SkillProposalPayload) => void;
};

const STREAM_SCROLL_THROTTLE_MS = 120;

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
    onMemoryProposal,
    onSkillProposal,
  } = deps;

  const runManager = createAgentSessionRunManager<ChatMessage>();

  function findRunForMsg(msgOrId: ChatMessage | string) {
    const msgId = typeof msgOrId === "string" ? msgOrId : msgOrId.id;
    return runManager.findByAssistantMsgId(msgId);
  }

  function getLiveForMsg(msg: ChatMessage): AgentRunLiveState | undefined {
    return findRunForMsg(msg)?.live;
  }

  function formatLiveStatus(live: AgentRunLiveState, compact = false): string {
    return formatAgentLiveStatus(live, { chatMode: chatMode.value, compact });
  }

  /** @deprecated Prefer formatLiveStatus(run.live) — kept for legacy call sites. */
  function formatAgentStatus(data: AgentStatusData, compact = false): string {
    return formatAgentLiveStatus(
      patchLiveFromStatusEvent(createInitialLiveState(), data.phase, data),
      { chatMode: chatMode.value, compact },
    );
  }

  function isRunVisible(sessionId: string): boolean {
    return sessionId === activeSessionId.value;
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

  const autoResumeSecondsLeft = ref(0);
  const autoResumeTargetId = ref("");
  const runningAssistantMsgId = ref("");
  const agentUiTick = ref(0);
  const stalledAssistantMsg = ref<ChatMessage | null>(null);
  const planExecutionActive = ref(false);

  let streamDeltaRaf: number | null = null;
  let streamScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingStreamDelta: { msgId: string; assistantMsg: ChatMessage; pending: string } | null = null;

  const statusLogScrollRefs = new Map<string, HTMLElement>();
  const chainScrollPinned = new Map<string, boolean>();
  const chainJumpVisible = reactive<Record<string, boolean>>({});

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
    const waitThreshold =
      (msg.agentContinueCount ?? 0) > 0
        ? AGENT_CONTINUE_MODEL_WAIT_STALL_MS
        : AGENT_MODEL_WAIT_STALL_MS;
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
      refreshStalledAssistantMsg();
      checkAgentStall();
    }, 1000);
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
    if (extra?.streamChars !== undefined) msg.streamChars = extra.streamChars;
    if (extra?.contextChars !== undefined) msg.contextChars = extra.contextChars;
    if (extra?.turn) msg.agentTurn = extra.turn;
    if (extra?.maxTurns) msg.agentMaxTurns = extra.maxTurns;
    if (extra?.model) msg.agentModel = extra.model;
    const statusText = formatLiveStatus(run.live);
    const shouldLog = options?.log ?? phase !== prevPhase;
    if (shouldLog) appendStatusLog(msg, statusText);
  }

  function isAgentRunning(msg: ChatMessage): boolean {
    return Boolean(findRunForMsg(msg));
  }

  function hasAgentActivity(msg: ChatMessage): boolean {
    return Boolean(
      msg.agentContext ||
        msg.roundGroups?.length ||
        msg.statusLog?.length ||
        msg.turnTraces?.length ||
        msg.agentFailed ||
        msg.agentRecoverable ||
        msg.tools?.length ||
        msg.agentTurn ||
        msg.totalTurns,
    );
  }

  function isActivityExpanded(msg: ChatMessage): boolean {
    if (isAgentRunning(msg)) return true;
    return msg.activityExpanded === true;
  }

  function isActivityDetailed(msg: ChatMessage): boolean {
    return msg.activityDetailed === true;
  }

  function agentRoundGroupViews(msg: ChatMessage): AgentRoundGroupView[] {
    void agentUiTick.value;
    const live = getLiveForMsg(msg);
    return buildAgentRoundGroupViews({
      roundGroups: msg.roundGroups as any,
      turnTraces: msg.turnTraces as any,
      statusLog: msg.statusLog,
      tools: msg.tools as any,
      activeTurn: isAgentRunning(msg) ? (live?.turn ?? msg.agentTurn) : undefined,
      activePhase: isAgentRunning(msg) ? live?.phase : undefined,
    });
  }

  function messageDisplayContent(msg: ChatMessage): string {
    if (msg.role === "user") {
      const text = stripReferenceAttachments(msg.content || "").trim();
      if (text) return text;
      if (resolveUserMessageImages(msg).length) return "";
      if (msg.imageCount && msg.imageCount > 0) return `（已发送 ${msg.imageCount} 张图片）`;
      return msg.content?.trim() || "";
    }
    if (canResumeAgentRun(msg) || inferAgentRecoveryFlags(msg)?.agentRecoverable) {
      return resolveAgentFailureBubbleContent(msg);
    }
    if (isAgentRunning(msg)) {
      const live = getLiveForMsg(msg);
      return resolveLiveAgentAnswerPreview({
        ...msg,
        agentTurn: live?.turn ?? msg.agentTurn,
        agentPhase: live?.phase,
      });
    }
    return finalizeAssistantBubbleContent(msg);
  }

  function findLastAssistantContent(): string | undefined {
    return findLastAssistantContentInMessages(chatMessages.value, (msg) =>
      messageDisplayContent(msg as ChatMessage),
    );
  }

  function agentAnswerPreview(msg: ChatMessage): string {
    const hasRunningTool = Boolean(msg.tools?.some((t: { running?: boolean }) => t.running));
    const live = getLiveForMsg(msg);
    return resolveAgentTimelineAnswer(
      {
        content: msg.content,
        roundGroups: msg.roundGroups,
        turnTraces: msg.turnTraces,
        agentTurn: live?.turn ?? msg.agentTurn,
      },
      messageDisplayContent(msg),
      isAgentRunning(msg),
      hasRunningTool,
    );
  }

  function cursorAgentFeed(msg: ChatMessage) {
    void agentUiTick.value;
    const run = findRunForMsg(msg);
    const live = run?.live;
    let agentDetail = live?.detail?.trim() || "";
    const connectStartedAt = run?.connectStartedAt ?? 0;
    if (
      isAgentRunning(msg) &&
      live &&
      isAgentConnectPhase(live.phase) &&
      connectStartedAt > 0
    ) {
      const elapsed = Math.max(0, Math.floor((Date.now() - connectStartedAt) / 1000));
      const base =
        live.detail?.trim() ||
        (live.phase === "connecting_local" ? "连接本地服务" : "启动 Agent");
      agentDetail = `${base} · ${elapsed}s`;
    }
    const bubble = agentAnswerPreview(msg);
    const hasRunningTool = Boolean(msg.tools?.some((t: { running?: boolean }) => t.running));
    const items = buildCursorAgentFeed({
      groups: agentRoundGroupViews(msg),
      isRunning: isAgentRunning(msg),
      agentPhase: live?.phase,
      agentDetail,
      answerPreview: bubble,
      streaming: isAgentTimelineAnswerStreaming(
        { roundGroups: msg.roundGroups, agentTurn: live?.turn ?? msg.agentTurn },
        isAgentRunning(msg),
        hasRunningTool,
      ),
    });
    return filterDuplicateFeedThoughts(items, bubble);
  }

  function cursorAgentTimeline(msg: ChatMessage): CursorAgentTimeline {
    const detailed = isActivityDetailed(msg);
    const hasRunningTool = Boolean(msg.tools?.some((t: { running?: boolean }) => t.running));
    return buildCursorAgentTimeline(cursorAgentFeed(msg), agentAnswerPreview(msg), {
      keepVisible: detailed ? 8 : 6,
      collapseAfter: detailed ? 10 : 5,
      compactWhileRunning: isAgentRunning(msg) && detailed,
      streaming: isAgentTimelineAnswerStreaming(
        { roundGroups: msg.roundGroups, agentTurn: msg.agentTurn },
        isAgentRunning(msg),
        hasRunningTool,
      ),
    });
  }

  function cursorCompactExplorationSummary(msg: ChatMessage): string {
    const stats = computeExplorationStats((msg.tools ?? []) as any);
    return formatExplorationSummary(stats, isAgentRunning(msg));
  }

  function cursorCompactRunningAction(msg: ChatMessage) {
    const action = getRunningFeedAction(cursorAgentFeed(msg));
    return action?.step ?? null;
  }

  function cursorCompactRecentActions(msg: ChatMessage) {
    void agentUiTick.value;
    return getRecentFeedActions(cursorAgentFeed(msg)).recent;
  }

  function compactLogItems(msg: ChatMessage): AgentLogLineItem[] {
    void agentUiTick.value;
    return cursorCompactRecentActions(msg).map((item) => ({
      key: item.key,
      label: formatCursorActionLabel(item.step),
      state: cursorActionClass(item.step) as AgentLogLineItem["state"],
    }));
  }

  function cursorCompactHiddenCount(msg: ChatMessage): number {
    void agentUiTick.value;
    return getRecentFeedActions(cursorAgentFeed(msg)).hiddenCount;
  }

  function cursorCompactLiveStatus(msg: ChatMessage): string | null {
    void agentUiTick.value;
    const run = findRunForMsg(msg);
    const live = run?.live;
    if (!run || !live) return null;
    if (cursorCompactRunningAction(msg)) return null;
    const timelineAnswer = cursorAgentTimeline(msg).answer;
    if (timelineAnswer && (live.phase === "streaming_model" || live.phase === "planning_tools")) {
      return null;
    }

    if (live.phase === "streaming_model" || live.phase === "planning_tools") {
      const chars = live.streamChars ?? msg.streamChars ?? 0;
      return chars > 0 ? `思考中 · 已生成 ${chars} 字` : "思考中…";
    }

    const parts: string[] = [];
    const waitingModel =
      live.phase === "waiting_model" ||
      live.phase === "sending_request" ||
      live.phase === "retrying_model";
    if (live.phase === "compacting_context") parts.push("压缩上下文…");
    else if (live.phase === "summarizing_tools") parts.push("整理工具结果…");
    else if (live.phase === "executing_tool" || live.phase === "executing_tools") return null;
    else if (waitingModel) parts.push("等待模型响应…");
    else parts.push("整合信息中…");

    const turn = live.turn ?? msg.agentTurn;
    if (turn) parts.push(`第 ${turn} 轮`);
    if (live.waitStartedAt && waitingModel) {
      const elapsed = Math.max(0, Math.floor((Date.now() - live.waitStartedAt) / 1000));
      parts.push(`已等待 ${elapsed}s`);
      if (elapsed > 45) parts.push("模型较慢，可取消后 @ 具体文件重试");
    } else if (live.detail?.trim()) {
      parts.push(live.detail.trim());
    }
    return parts.join(" · ");
  }

  function agentStatusDisplay(msg: ChatMessage): string {
    void agentUiTick.value;
    const compactStatus = cursorCompactLiveStatus(msg);
    if (compactStatus) return compactStatus;

    const run = findRunForMsg(msg);
    const live = run?.live;
    if (!live) return "";

    if (live.phase === "executing_tool" || live.phase === "executing_tools") {
      const running = msg.tools?.find((tool) => tool.running);
      if (running?.title) {
        return running.detail ? `${running.title} · ${running.detail}` : `${running.title}…`;
      }
      if (live.toolTitle) {
        return live.toolDetail ? `${live.toolTitle} · ${live.toolDetail}` : `${live.toolTitle}…`;
      }
      return "执行工具…";
    }

    let statusText = formatLiveStatus(live, true);
    const waitingModel =
      live.phase === "waiting_model" ||
      live.phase === "sending_request" ||
      live.phase === "retrying_model";
    if (live.waitStartedAt && waitingModel) {
      const elapsed = Math.max(0, Math.floor((Date.now() - live.waitStartedAt) / 1000));
      if (elapsed >= 15) {
        statusText = `${statusText} · ${elapsed}s`;
      }
      if (elapsed > 45) {
        statusText += " · 可 @ 文件缩小范围";
      }
    }

    const contextChars = live.contextChars ?? msg.contextChars ?? 0;
    if (waitingModel && contextChars > 36_000) {
      statusText += " · 上下文较大";
    }

    return statusText;
  }

  function buildAgentRunningStatusTextForMsg(msg: ChatMessage): string {
    return buildAgentRunningStatusText(msg, agentStatusDisplay(msg));
  }

  function agentAbortDisplayReason(msg: ChatMessage): string {
    return msg.agentAbortReason?.trim() || msg.agentFailureReason?.trim() || "运行已中断";
  }

  function agentRunningHint(msg: ChatMessage): string {
    const live = getLiveForMsg(msg);
    const streamChars = live?.streamChars ?? msg.streamChars ?? 0;
    if (streamChars > 0) return `${streamChars} 字`;
    if (live?.detail?.trim()) return live.detail.trim();
    const turn = live?.turn ?? msg.agentTurn;
    const maxTurns = live?.maxTurns ?? msg.agentMaxTurns;
    if (turn && maxTurns) return `${turn}/${maxTurns}`;
    if (turn) return `第 ${turn} 轮`;
    return "运行中…";
  }

  function activitySummary(msg: ChatMessage): string {
    const toolCount = msg.tools?.length ?? 0;
    const parts: string[] = [];
    if (msg.totalTurns) parts.push(`${msg.totalTurns} 轮`);
    if (toolCount > 0) {
      const failed = msg.tools?.filter((t) => !t.ok).length ?? 0;
      parts.push(failed > 0 ? `${toolCount} 个工具（${failed} 失败）` : `${toolCount} 个工具`);
    }
    if (msg.turnFileDiffs && Object.keys(msg.turnFileDiffs).length) {
      parts.push(`${Object.keys(msg.turnFileDiffs).length} 个文件变更`);
    }
    return parts.length ? parts.join(" · ") : "查看执行过程";
  }

  function cursorActivitySummary(msg: ChatMessage): string {
    const actions = msg.tools?.length ?? 0;
    const last = msg.tools?.[msg.tools.length - 1];
    if (last && !last.running) {
      return `展开过程 · ${actions} 步 · ${formatCursorActionLabel(last as any)}`;
    }
    if (actions > 0) return `展开过程 · ${actions} 步`;
    if (msg.totalTurns) return `展开过程 · ${msg.totalTurns} 轮`;
    return "展开过程";
  }

  function toggleActivityExpanded(msg: ChatMessage) {
    msg.activityExpanded = !msg.activityExpanded;
    patchAssistantMsg(msg.id, { activityExpanded: msg.activityExpanded });
    schedulePersistChat();
  }

  function collapseAgentActivity(msg: ChatMessage) {
    msg.activityExpanded = false;
    patchAssistantMsg(msg.id, { activityExpanded: false });
    schedulePersistChat();
  }

  function toggleActivityDetailed(msg: ChatMessage) {
    msg.activityDetailed = true;
    patchAssistantMsg(msg.id, { activityDetailed: true });
    schedulePersistChat();
  }

  function collapseActivityDetailed(msg: ChatMessage) {
    msg.activityDetailed = false;
    patchAssistantMsg(msg.id, { activityDetailed: false });
    schedulePersistChat();
  }

  function shouldUseCompactAgentFeed(msg: ChatMessage): boolean {
    const stepCount = msg.tools?.length ?? 0;
    return shouldUseCompactAgentFeedByCount(stepCount, isAgentRunning(msg), isActivityDetailed(msg));
  }

  function hasAgentDebugDetails(msg: ChatMessage): boolean {
    return Boolean(
      msg.agentContext ||
        msg.roundGroups?.some((group) => group.turn > 0 && (group.request || group.response || group.modelSteps.length)),
    );
  }

  function roundGroupSetupLabel(group: AgentRoundGroupView): string {
    return group.turn === 0 ? "准备阶段" : `第 ${group.turn} 轮`;
  }

  function modelStepPhaseLabel(phase: string): string {
    switch (phase) {
      case "compacting_context": return "上下文";
      case "sending_request": return "请求";
      case "waiting_model":
      case "retrying_model": return "等待";
      case "streaming_model": return "输出";
      case "planning_tools": return "规划";
      case "summarizing_tools": return "整理";
      default: return "";
    }
  }

  function statusLogPhaseClass(text: string): string {
    if (text.includes("连接") || text.includes("已连接")) return "phase-connecting";
    if (text.includes("扫描") || text.includes("项目上下文") || text.includes("准备问答") || text.includes("组装")) return "phase-context";
    if (text.includes("压缩") || text.includes("准备模型上下文")) return "phase-compacting";
    if (text.includes("发送模型请求") || text.includes("等待模型") || text.includes("重试")) return "phase-model";
    if (text.includes("模型输出") || text.includes("规划工具")) return "phase-streaming";
    if (text.includes("执行") && text.includes("工具")) return "phase-tool";
    if (text.includes("整理")) return "phase-summarize";
    if (text.includes("停止")) return "phase-aborted";
    return "phase-default";
  }

  function cleanStatusLogText(text: string): string {
    return text
      .replace(/^正在/, "")
      .replace(/…$/, "")
      .replace(/\.\.\.\s*$/, "")
      .trim();
  }

  function bindStatusLogScroll(el: HTMLElement | null, msgId: string) {
    if (el) {
      statusLogScrollRefs.set(msgId, el);
      if (!chainScrollPinned.has(msgId)) chainScrollPinned.set(msgId, true);
      if (chatSending.value && msgId === activeAssistantMsgId.value) {
        scrollStatusLogToBottomInternal(msgId);
      } else {
        onChainViewportScroll(msgId);
      }
    } else {
      statusLogScrollRefs.delete(msgId);
      chainScrollPinned.delete(msgId);
      delete chainJumpVisible[msgId];
    }
  }

  function onChainViewportScroll(msgId: string) {
    const el = statusLogScrollRefs.get(msgId);
    if (!el) return;
    const nearBottom = isScrollNearBottom(el);
    chainScrollPinned.set(msgId, nearBottom);
    chainJumpVisible[msgId] = !nearBottom && el.scrollHeight > el.clientHeight + 8;
  }

  function jumpChainToLatest(msgId: string) {
    const el = statusLogScrollRefs.get(msgId);
    if (!el) return;
    scrollElementToBottom(el, "smooth");
    chainScrollPinned.set(msgId, true);
    chainJumpVisible[msgId] = false;
  }

  function scrollStatusLogToBottomInternal(msgId: string) {
    void nextTick(() => {
      const el = statusLogScrollRefs.get(msgId);
      if (!el) return;
      if (chainScrollPinned.get(msgId) ?? true) {
        el.scrollTop = el.scrollHeight;
      }
      onChainViewportScroll(msgId);
    });
  }

  function scheduleStreamScroll() {
    if (!chatSending.value || !isChatPinnedToBottom()) return;
    if (streamScrollTimer) return;
    streamScrollTimer = setTimeout(() => {
      streamScrollTimer = null;
      void scrollChatToBottom();
    }, STREAM_SCROLL_THROTTLE_MS);
  }

  function flushPendingStreamDelta() {
    if (streamDeltaRaf !== null) {
      cancelAnimationFrame(streamDeltaRaf);
      streamDeltaRaf = null;
    }
    if (!pendingStreamDelta?.pending) return;

    const { msgId, assistantMsg } = pendingStreamDelta;
    const delta = pendingStreamDelta.pending;
    pendingStreamDelta.pending = "";

    const turn = assistantMsg.agentTurn ?? 1;
    assistantMsg.roundGroups = recordAgentRoundStreamDelta(
      assistantMsg.roundGroups,
      turn,
      delta,
      assistantMsg.agentMaxTurns,
    );
    assistantMsg.streamChars = (assistantMsg.streamChars || 0) + delta.length;
    const run = findRunForMsg(assistantMsg);
    if (run) run.live.streamChars = assistantMsg.streamChars;
    patchAssistantMsg(msgId, {
      streamChars: assistantMsg.streamChars,
      ...syncRoundGroupsPatch(assistantMsg),
    });
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
    scheduleStreamScroll();
  }

  function enqueueStreamDelta(msgId: string, assistantMsg: ChatMessage, delta: string) {
    if (!pendingStreamDelta || pendingStreamDelta.msgId !== msgId) {
      flushPendingStreamDelta();
      pendingStreamDelta = { msgId, assistantMsg, pending: "" };
    }
    pendingStreamDelta.pending += delta;
    if (streamDeltaRaf !== null) return;
    streamDeltaRaf = requestAnimationFrame(() => {
      streamDeltaRaf = null;
      flushPendingStreamDelta();
    });
  }

  function clearStreamDeltaBuffer() {
    flushPendingStreamDelta();
    pendingStreamDelta = null;
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
      activityDetailed: true,
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

  function handleAgentEvent(
    event: VibeAgentSseEvent,
    assistantMsg: ChatMessage,
    runGen: number,
    sessionId: string,
  ) {
    if (!runManager.isValid(sessionId, runGen)) return;
    const msgId = assistantMsg.id;
    const patchMsg = (patch: Partial<ChatMessage>) => patchAssistantMsg(msgId, patch, sessionId);

    const isProgressEvent = isAgentSseProgressEvent(event.type);
    if (isProgressEvent) touchAgentProgress(sessionId);

    if (event.type === "agent_context") {
      assistantMsg.agentContext = event.data;
      patchAssistantMsg(msgId, { agentContext: event.data });
      return;
    }

    if (event.type === "turn_request") {
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
      patchAssistantMsg(msgId, syncRoundGroupsPatch(assistantMsg));
      if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
      return;
    }

    if (event.type === "turn_response") {
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
      }
      patchAssistantMsg(msgId, {
        ...syncRoundGroupsPatch(assistantMsg),
        content: assistantMsg.content,
      });
      if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
      return;
    }

    if (event.type === "turn_trace") {
      if (!assistantMsg.turnTraces) assistantMsg.turnTraces = [];
      assistantMsg.turnTraces.push({ ...event.data });
      assistantMsg.roundGroups = recordAgentRoundNarrative(
        assistantMsg.roundGroups,
        event.data.turn,
        event.data.assistantText,
        event.data.maxTurns,
      );
      patchAssistantMsg(msgId, {
        turnTraces: [...assistantMsg.turnTraces],
        ...syncRoundGroupsPatch(assistantMsg),
      });
      if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
      return;
    }

    if (event.type === "status") {
      const { phase } = event.data;
      const run = runManager.get(sessionId);
      if (!run) return;
      const prevPhase = run.live.phase;
      setAgentStatus(sessionId, assistantMsg, phase, event.data, { log: phase !== prevPhase });
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
      return;
    }

    if (event.type === "tool_start") {
      if (!assistantMsg.tools) assistantMsg.tools = [];
      const meta = formatToolMeta(event.data.name, event.data.args);
      const toolTurn = assistantMsg.agentTurn ?? 1;
      assistantMsg.tools.push({
        id: event.data.id,
        ...meta,
        args: { ...event.data.args },
        summary: "",
        ok: true,
        running: true,
        turn: toolTurn,
      });
      assistantMsg.roundGroups = recordAgentRoundToolStart(assistantMsg.roundGroups, event.data.id, toolTurn);
      setAgentStatus(sessionId, assistantMsg, "executing_tool", {
        toolTitle: meta.title,
        toolDetail: meta.detail,
        turn: assistantMsg.agentTurn,
        maxTurns: assistantMsg.agentMaxTurns,
      });
      patchAssistantMsg(msgId, {
        tools: [...assistantMsg.tools],
        statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
        ...syncRoundGroupsPatch(assistantMsg),
      });
      if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
      void scrollChatToBottom();
      return;
    }

    if (event.type === "file_diff") {
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
      return;
    }

    if (event.type === "tool_end") {
      const step = assistantMsg.tools?.find((t) => t.id === event.data.id);
      if (step) {
        step.running = false;
        step.ok = event.data.ok;
        step.summary = event.data.summary;
        if (event.data.result) step.fullResult = event.data.result;
      }
      if (event.data.result) {
        const proposal = parseMemoryProposalToolResult(event.data.result);
        if (proposal) onMemoryProposal?.(msgId, proposal);
        const skillProposal = parseSkillProposalToolResult(event.data.result);
        if (skillProposal) onSkillProposal?.(msgId, skillProposal);
      }
      const pending = assistantMsg.tools?.some((t) => t.running);
      setAgentStatus(sessionId, assistantMsg, pending ? "executing_tools" : "summarizing_tools", {
        turn: assistantMsg.agentTurn,
        maxTurns: assistantMsg.agentMaxTurns,
      });
      patchAssistantMsg(msgId, {
        tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
        statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      });
      if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
      void scrollChatToBottom();
      return;
    }

    if (event.type === "message_delta") {
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
        patchAssistantMsg(msgId, {
          streamChars: assistantMsg.streamChars,
        });
      }
      enqueueStreamDelta(msgId, assistantMsg, delta);
      return;
    }

    if (event.type === "message") {
      clearStreamDeltaBuffer();
      const cleanText = stripTextToolCallMarkup(stripToolSummaryFromAssistantContent(event.data.text));
      assistantMsg.content = mergeAssistantTurnText(assistantMsg.content || "", cleanText);
      patchAssistantMsg(msgId, {
        content: assistantMsg.content,
      });
      schedulePersistDuringRun(sessionId);
      void scrollChatToBottom();
      return;
    }

    if (event.type === "error") {
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
      return;
    }

    if (event.type === "done") {
      if (isRunVisible(sessionId)) clearStreamDeltaBuffer();
      planExecutionActive.value = false;
      runManager.setAbortHandle(sessionId, null);
      clearPendingAgentRun();

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

      if (!wasAborted && hadProgress && !hasAgentFinalAnswer(assistantMsg)) {
        handleRecoverableInterruption(sessionId, assistantMsg, "运行中断（未生成最终回复）", {
          logStatus: true,
        });
        assistantMsg.content = resolveAgentFailureBubbleContent(assistantMsg);
        finishRunSession(sessionId);
        patchAssistantMsg(msgId, {
          content: assistantMsg.content,
          agentFailed: assistantMsg.agentFailed,
          agentRecoverable: assistantMsg.agentRecoverable,
          agentFailureReason: assistantMsg.agentFailureReason,
          agentRecoveryDismissed: assistantMsg.agentRecoveryDismissed,
          totalTurns: assistantMsg.totalTurns,
          statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
          activityExpanded: true,
          ...syncRoundGroupsPatch(assistantMsg),
        });
        persistChatNow(undefined, { flushStore: true });
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

      assistantMsg.activityExpanded = Boolean(assistantMsg.content?.trim());
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
      void scrollChatToBottom();

      finishRunSession(sessionId);

      onAgentRunSettled?.(assistantMsg);

      if (pendingPromptQueue.value.length) {
        dequeuePendingPromptAndRun();
      }
    }
  }

  function interruptSessionRun(sessionId: string, options?: { logStatus?: boolean; reason?: string }) {
    debugLog(`[interrupt] interruptSessionRun sessionId=${sessionId}, reason=${options?.reason}`);
    const run = runManager.get(sessionId);
    if (!run) { debugLog(`[interrupt] no run found for session ${sessionId}`); return; }
    cancelAutoResume();
    clearPendingAgentRun();
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
    if (!configReady.value || !projectOpened.value) { debugLog(`[resume] early return: configReady=${configReady.value}, projectOpened=${projectOpened.value}`); return; }

    const assistantIdx = chatMessages.value.findIndex((m) => m.id === assistantMsgId);
    if (assistantIdx < 0) { debugLog(`[resume] early return: assistant not found id=${assistantMsgId}`); return; }

    const assistantMsg = chatMessages.value[assistantIdx];
    if (!options?.silent && !canResumeAgentRun(assistantMsg)) { debugLog(`[resume] early return: canResumeAgentRun=false`); return; }
    if (options?.silent && !hasRecoverableAgentProgress(assistantMsg)) { debugLog(`[resume] early return: silent but no recoverable progress`); return; }

    const originalPrompt = resolveOriginalUserPrompt(assistantMsgId);
    if (!originalPrompt) { debugLog(`[resume] early return: originalPrompt empty`); return; }

    debugLog(`[resume] proceeding: sessionId=${sessionId}, silent=${!!options?.silent}`);

    if (runManager.has(sessionId)) {
      interruptSessionRun(sessionId, { logStatus: true, reason: "已被新指令打断" });
    }

    const failureReason =
      assistantMsg.agentFailureReason ||
      inferAgentRecoveryFlags(assistantMsg)?.agentFailureReason ||
      "连接中断";
    const resumePrompt = buildAgentResumePrompt(assistantMsg, originalPrompt, failureReason);
    const mode = assistantMsg.chatMode ?? chatMode.value;
    const runProfile = resolveAgentResumeRunProfile(
      assistantMsg,
      originalPrompt,
      mode,
      findLastAssistantContent(),
    );

    const savedEndpoint = aiConfig.value.endpoint;
    const savedApiKey = aiConfig.value.apiKey;
    const savedModel = aiConfig.value.model;
    reloadAiConfig();
    if (!aiConfig.value.endpoint) aiConfig.value.endpoint = savedEndpoint;
    if (!aiConfig.value.apiKey) aiConfig.value.apiKey = savedApiKey;
    if (!aiConfig.value.model) aiConfig.value.model = savedModel;
    clearStreamDeltaBuffer();
    beginAgentRunSession(sessionId);
    chatError.value = "";
    resetChatScrollPin();
    const runGen = runManager.start(sessionId, assistantMsg.id, assistantMsg, false, "connecting_local");
    startAgentUiTick();
    const connectStatus = formatLiveStatus(runManager.get(sessionId)!.live);

    assistantMsg.agentFailed = false;
    assistantMsg.agentRecoverable = false;
    assistantMsg.agentFailureReason = undefined;
    assistantMsg.agentAborted = false;
    assistantMsg.agentAbortReason = undefined;
    assistantMsg.agentContinueCount = undefined;
    if (hasAgentRunStructure(assistantMsg) && !hasAgentFinalAnswer(assistantMsg)) {
      assistantMsg.content = "";
    }
    assistantMsg.activityExpanded = true;
    assistantMsg.activityDetailed = true;
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
      content: assistantMsg.content,
      agentAborted: false,
      agentAbortReason: undefined,
      agentContinueCount: undefined,
      activityExpanded: true,
      activityDetailed: true,
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
        maxTurns: resolveResumeMaxTurns(mode, runProfile, resolveAgentCompletedTurns(assistantMsg)),
        openFilePath: activeFilePath.value || undefined,
        runProfile: runProfile.kind === "execute_plan" ? runProfile : undefined,
      },
      (event) => handleAgentEvent(event, assistantMsg, runGen, sessionId),
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

  /** Only attach images explicitly passed for this turn — never inherit from earlier user messages. */
  function resolveTurnImageSources(
    options?: { imageDataUrls?: string[] },
  ): string[] {
    if (options && "imageDataUrls" in options) {
      return options.imageDataUrls ?? [];
    }
    return [];
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
    const mode = chatMode.value;

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
          chatMode: mode,
          tools: [],
          roundGroups: [],
          activityExpanded: true,
          activityDetailed: true,
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
          chatMode: mode,
          tools: [],
          roundGroups: [],
          activityExpanded: true,
          activityDetailed: true,
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

    const lastAssistant = options?.planAssistantContent ?? findLastAssistantContent();
    const runProfile = resolveAgentRunProfile({
      prompt: rawPrompt,
      mode,
      lastAssistantContent: lastAssistant,
      referencedFiles: options?.referencedFiles,
    });
    planExecutionActive.value = mode === "plan" && runProfile.kind === "execute_plan";
    const prompt = buildAgentPromptForProfile(
      enrichAgentUserPrompt(rawPrompt, {
        lastAssistantContent: lastAssistant,
        hasImages: hasImagesForRequest,
      }),
      runProfile,
    );

    const history = buildAgentHistory(rawPrompt, runProfile);

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
      mode,
      maxTurns: resolveAgentMaxTurns(mode, runProfile),
      openFilePath: activeFilePath.value || undefined,
      runProfile: runProfile.kind === "execute_plan" ? runProfile : undefined,
      imageDataUrls: compressedImagesForRequest?.length ? compressedImagesForRequest : undefined,
    };
    // 持久化请求状态，以便 HMR 重载后恢复
    persistAgentRunForHmr({
      request: agentRequest as unknown as Record<string, unknown>,
      projectPath: agentRequest.projectPath,
      sessionId: sessionId || undefined,
    });
    const handle = runVibeAgentSse(
      agentRequest,
      (event) => handleAgentEvent(event, assistantMsg, runGen, sessionId),
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
    await runAgentTurn("改吧", {
      userBubbleContent: "执行方案",
      planAssistantContent: messageDisplayContent(msg),
    });
  }

  function getActiveLiveContextChars(): number {
    return getActiveRun()?.live.contextChars ?? 0;
  }

  return {
    autoResumeSecondsLeft,
    autoResumeTargetId,
    agentUiTick,
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
    isActivityExpanded,
    isActivityDetailed,
    agentRoundGroupViews,
    messageDisplayContent,
    cursorAgentFeed,
    cursorAgentTimeline,
    cursorCompactExplorationSummary,
    cursorCompactRunningAction,
    cursorCompactRecentActions,
    compactLogItems,
    cursorCompactHiddenCount,
    cursorCompactLiveStatus,
    agentStatusDisplay,
    buildAgentRunningStatusTextForMsg,
    agentRunningHint,
    activitySummary,
    cursorActivitySummary,
    toggleActivityExpanded,
    collapseAgentActivity,
    toggleActivityDetailed,
    collapseActivityDetailed,
    shouldUseCompactAgentFeed,
    hasAgentDebugDetails,
    roundGroupSetupLabel,
    modelStepPhaseLabel,
    statusLogPhaseClass,
    cleanStatusLogText,
    bindStatusLogScroll,
    onChainViewportScroll,
    jumpChainToLatest,
    scrollStatusLogToBottom: scrollStatusLogToBottomInternal,
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
    getActiveLiveContextChars,
  };
}
