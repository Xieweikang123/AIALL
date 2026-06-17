import { ref, nextTick, reactive, type ComputedRef, type Ref } from "vue";
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
  agentStallRecoveryReason,
  agentConnectStallMessage,
  buildAgentMaxTurnsExhaustedMessage,
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
  recoverableAgentErrorHint,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
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
import { resolveImagesForAgentTurn } from "../services/vibeChatImageStore";
import { looksLikeModificationPlan, findLastAssistantContentInMessages } from "../services/agentContinuation";
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
  mergeAssistantTurnText,
  resolveAssistantBubbleContent,
  resolveAgentTimelineAnswer,
  isAgentTimelineAnswerStreaming,
} from "../services/agentMessageDisplay";
import { isScrollNearBottom, scrollElementToBottom } from "../utils/scrollViewport";
import {
  appendStatusDetail,
  formatCharCount,
  formatToolMeta,
  genId,
  syncRoundGroupsPatch,
} from "../utils/vibeHelpers";

export type ChatMessage = VibeChatMessage;

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
  patchAssistantMsg: (id: string, patch: Partial<ChatMessage>) => void;
  schedulePersistChat: () => void;
  persistChatNow: (path?: string, options?: { flushStore?: boolean }) => void;
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
  } = deps;

  let agentAbortHandle: { abort: () => void } | null = null;
  let agentRunGeneration = 0;
  let agentUiTickTimer: ReturnType<typeof setInterval> | null = null;
  let autoResumeTimer: ReturnType<typeof setInterval> | null = null;
  let agentLastProgressAt = 0;
  let agentConnectStartedAt = 0;
  let agentConnectHasImages = false;

  const autoResumeSecondsLeft = ref(0);
  const autoResumeTargetId = ref("");
  const agentUiTick = ref(0);
  const stalledAssistantMsg = ref<ChatMessage | null>(null);
  const planExecutionActive = ref(false);

  let streamDeltaRaf: number | null = null;
  let streamScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingStreamDelta: { msgId: string; assistantMsg: ChatMessage; pending: string } | null = null;

  const statusLogScrollRefs = new Map<string, HTMLElement>();
  const chainScrollPinned = new Map<string, boolean>();
  const chainJumpVisible = reactive<Record<string, boolean>>({});

  function formatAgentStatus(data: AgentStatusData, compact = false): string {
    const { phase, turn, maxTurns, openFile, model, toolTitle, toolDetail, detail } = data;

    if (phase === "connecting_local") return "正在连接本地服务（127.0.0.1:37891）…";
    if (phase === "stream_connected") return "本地服务已连接，等待 Agent 启动…";
    if (phase === "connected") return "本地 Agent 服务已就绪，正在启动任务…";
    if (phase === "reconnecting") {
      const retryHint = data.retryAttempt && data.retryMaxAttempts
        ? `（第 ${data.retryAttempt}/${data.retryMaxAttempts - 1} 次）`
        : "";
      return `正在重连${retryHint}…`;
    }
    if (phase === "building_context") {
      return appendStatusDetail("正在扫描项目上下文…", detail);
    }
    if (phase === "compacting_context") {
      return appendStatusDetail("正在压缩并准备模型上下文…", detail);
    }
    if (phase === "vision_first_turn") {
      return appendStatusDetail("正在查看附图并描述所见…", detail);
    }
    if (phase === "vision_first_turn_done") {
      return appendStatusDetail("读图完成，开始定位与修改…", detail);
    }
    if (phase === "vision_first_turn_skipped") {
      return appendStatusDetail("读图描述不足，继续执行任务…", detail);
    }
    if (phase === "sending_request") {
      return appendStatusDetail("正在发送模型请求…", detail);
    }
    if (phase === "preparing" || phase === "starting") {
      if (chatMode.value === "ask") {
        return openFile
          ? appendStatusDetail(`正在准备问答上下文（当前文件：${openFile}）…`, detail)
          : appendStatusDetail("正在准备问答上下文…", detail);
      }
      if (chatMode.value === "plan") {
        return openFile
          ? appendStatusDetail(`正在准备规划上下文（当前文件：${openFile}）…`, detail)
          : appendStatusDetail("正在准备规划上下文…", detail);
      }
      return openFile
        ? appendStatusDetail(`正在组装 Agent 上下文与工具定义（当前文件：${openFile}）…`, detail)
        : appendStatusDetail("正在组装 Agent 上下文与工具定义…", detail);
    }
    if (phase === "streaming_model") {
      if (compact) return appendStatusDetail("模型输出中…", detail);
      const modelHint = model ? ` · ${model}` : "";
      const turnHint = turn ? `（第 ${turn} 轮${modelHint}）` : modelHint;
      return appendStatusDetail(`模型输出中${turnHint}`, detail);
    }
    if (phase === "planning_tools") {
      if (compact) return appendStatusDetail("模型规划工具…", detail);
      const modelHint = model ? ` · ${model}` : "";
      const turnHint = turn ? `（第 ${turn} 轮${modelHint}）` : modelHint;
      return appendStatusDetail(`模型规划工具${turnHint}`, detail);
    }
    if (phase === "waiting_model" || phase === "thinking") {
      if (compact) return appendStatusDetail("正在等待模型响应…", detail);
      const modelHint = model ? ` · ${model}` : "";
      const turnHint = turn
        ? maxTurns
          ? `（第 ${turn}/${maxTurns} 轮${modelHint}）`
          : `（第 ${turn} 轮${modelHint}）`
        : modelHint;
      return appendStatusDetail(`正在等待模型响应${turnHint}…`, detail);
    }
    if (phase === "retrying_model") {
      const modelHint = model ? ` · ${model}` : "";
      const turnHint = turn
        ? maxTurns
          ? `（第 ${turn}/${maxTurns} 轮${modelHint}）`
          : `（第 ${turn} 轮${modelHint}）`
        : modelHint;
      const retryHint =
        data.retryAttempt && data.retryMaxAttempts
          ? `，第 ${data.retryAttempt}/${data.retryMaxAttempts - 1} 次重试`
          : "";
      const reason = data.retryError ? `：${data.retryError}` : "";
      return appendStatusDetail(`模型请求失败${reason}，正在重试${turnHint}${retryHint}…`, detail);
    }
    if (phase === "executing_tool") {
      return toolDetail ? `正在执行：${toolTitle}（${toolDetail}）` : `正在执行：${toolTitle}…`;
    }
    if (phase === "executing_tools") return "正在执行工具调用…";
    if (phase === "summarizing_tools") return "正在整理工具结果，准备下一轮推理…";
    if (phase === "continuing") return appendStatusDetail("任务较长，自动续跑下一段…", detail);
    if (phase === "finished") return "";
    if (phase === "aborted") return "已停止运行";
    return "";
  }

  function appendStatusLog(msg: ChatMessage, line: string) {
    const text = line.trim();
    if (!text) return;
    if (!msg.statusLog) msg.statusLog = [];
    const last = msg.statusLog[msg.statusLog.length - 1];
    if (last !== text) msg.statusLog.push(text);
  }

  function refreshStalledAssistantMsg() {
    if (!chatSending.value || agentLastProgressAt <= 0) {
      stalledAssistantMsg.value = null;
      return;
    }
    if (!isAgentRunStalled(agentLastProgressAt, chatSending.value)) {
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

  function findRunningAssistantMsg(): ChatMessage | null {
    if (!chatSending.value) return null;
    const id = activeAssistantMsgId.value;
    if (!id) return null;
    return chatMessages.value.find((m) => m.id === id) ?? null;
  }

  function touchAgentProgress() {
    agentLastProgressAt = Date.now();
  }

  function startAgentUiTick() {
    stopAgentUiTick();
    touchAgentProgress();
    agentConnectStartedAt = Date.now();
    agentUiTickTimer = setInterval(() => {
      agentUiTick.value += 1;
      refreshStalledAssistantMsg();
      checkAgentStall();
    }, 1000);
  }

  function stopAgentUiTick() {
    if (agentUiTickTimer) {
      clearInterval(agentUiTickTimer);
      agentUiTickTimer = null;
    }
    stalledAssistantMsg.value = null;
  }

  function checkAgentStall() {
    if (!chatSending.value) return;
    const msg = findRunningAssistantMsg();
    if (!msg) return;

    if (
      isAgentConnectStalled(agentConnectStartedAt, msg.agentPhase, true) &&
      isAgentConnectPhase(msg.agentPhase)
    ) {
      abortAgentConnectStall(msg);
      return;
    }

    if (agentLastProgressAt <= 0) return;
    if (!isAgentRunStalled(agentLastProgressAt, true)) return;
    if (!hasRecoverableAgentProgress(msg)) return;
    recoverAgentRunFromStall(msg, agentStallRecoveryReason());
  }

  function abortAgentConnectStall(msg: ChatMessage) {
    agentAbortHandle?.abort();
    agentAbortHandle = null;
    chatSending.value = false;
    agentConnectStartedAt = 0;
    agentLastProgressAt = 0;
    clearPendingAgentRun();
    stopAgentUiTick();
    const reason = agentConnectStallMessage(agentConnectHasImages);
    chatError.value = reason;
    msg.agentFailed = true;
    msg.agentRecoverable = true;
    msg.agentFailureReason = reason;
    patchAssistantMsg(msg.id, {
      agentFailed: true,
      agentRecoverable: true,
      agentFailureReason: reason,
      agentPhase: undefined,
      status: reason,
    });
    if (activeSessionId.value && projectPath.value.trim()) {
      updateVibeChatSessionStatus(projectPath.value.trim(), activeSessionId.value, "failed");
    }
    persistChatNow();
  }

  function setAgentStatus(msg: ChatMessage, phase: string, extra?: Partial<AgentStatusData>, options?: { log?: boolean }) {
    const prevPhase = msg.agentPhase;
    msg.agentPhase = phase;
    if (extra?.detail !== undefined) msg.agentDetail = extra.detail;
    if (extra?.streamChars !== undefined) msg.streamChars = extra.streamChars;
    if (extra?.contextChars !== undefined) msg.contextChars = extra.contextChars;
    if (extra?.turn) msg.agentTurn = extra.turn;
    if (extra?.maxTurns) msg.agentMaxTurns = extra.maxTurns;
    if (extra?.model) msg.agentModel = extra.model;
    if (phase === "waiting_model" || phase === "sending_request" || phase === "retrying_model") {
      if (!msg.agentWaitStartedAt) msg.agentWaitStartedAt = Date.now();
    } else if (phase === "streaming_model" || phase === "planning_tools" || phase === "executing_tool") {
      msg.agentWaitStartedAt = undefined;
    }
    const statusText = formatAgentStatus({ phase, ...extra, turn: msg.agentTurn, maxTurns: msg.agentMaxTurns, model: msg.agentModel || extra?.model });
    msg.status = statusText;
    const shouldLog = options?.log ?? phase !== prevPhase;
    if (shouldLog) appendStatusLog(msg, statusText);
  }

  function isAgentRunning(msg: ChatMessage): boolean {
    return Boolean(chatSending.value && msg.id === activeAssistantMsgId.value);
  }

  function hasAgentActivity(msg: ChatMessage): boolean {
    return Boolean(
      msg.agentContext ||
        msg.roundGroups?.length ||
        msg.statusLog?.length ||
        msg.turnTraces?.length ||
        msg.status ||
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
    return buildAgentRoundGroupViews({
      roundGroups: msg.roundGroups as any,
      turnTraces: msg.turnTraces as any,
      statusLog: msg.statusLog,
      tools: msg.tools as any,
      activeTurn: isAgentRunning(msg) ? msg.agentTurn : undefined,
      activePhase: isAgentRunning(msg) ? msg.agentPhase : undefined,
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
    if (canResumeAgentRun(msg)) return resolveAgentFailureBubbleContent(msg);
    return finalizeAssistantBubbleContent(msg);
  }

  function findLastAssistantContent(): string | undefined {
    return findLastAssistantContentInMessages(chatMessages.value, (msg) =>
      messageDisplayContent(msg as ChatMessage),
    );
  }

  function agentAnswerPreview(msg: ChatMessage): string {
    const hasRunningTool = Boolean(msg.tools?.some((t: { running?: boolean }) => t.running));
    return resolveAgentTimelineAnswer(
      { content: msg.content, roundGroups: msg.roundGroups, turnTraces: msg.turnTraces, agentTurn: msg.agentTurn },
      messageDisplayContent(msg),
      isAgentRunning(msg),
      hasRunningTool,
    );
  }

  function cursorAgentFeed(msg: ChatMessage) {
    void agentUiTick.value;
    let agentDetail = msg.agentDetail || msg.status;
    if (
      isAgentRunning(msg) &&
      isAgentConnectPhase(msg.agentPhase) &&
      agentConnectStartedAt > 0
    ) {
      const elapsed = Math.max(0, Math.floor((Date.now() - agentConnectStartedAt) / 1000));
      const base =
        msg.agentDetail ||
        (msg.agentPhase === "connecting_local" ? "连接本地服务" : "启动 Agent");
      agentDetail = `${base} · ${elapsed}s`;
    }
    const bubble = agentAnswerPreview(msg);
    const hasRunningTool = Boolean(msg.tools?.some((t: { running?: boolean }) => t.running));
    const items = buildCursorAgentFeed({
      groups: agentRoundGroupViews(msg),
      isRunning: isAgentRunning(msg),
      agentPhase: msg.agentPhase,
      agentDetail,
      answerPreview: bubble,
      streaming: isAgentTimelineAnswerStreaming(
        { roundGroups: msg.roundGroups, agentTurn: msg.agentTurn },
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
    if (!isAgentRunning(msg)) return null;
    if (cursorCompactRunningAction(msg)) return null;
    const timelineAnswer = cursorAgentTimeline(msg).answer;
    if (timelineAnswer && (msg.streaming || msg.agentPhase === "streaming_model" || msg.agentPhase === "planning_tools")) {
      return null;
    }

    if (msg.agentPhase === "streaming_model" || msg.agentPhase === "planning_tools") {
      return msg.streamChars && msg.streamChars > 0
        ? `思考中 · 已生成 ${msg.streamChars} 字`
        : "思考中…";
    }

    const parts: string[] = [];
    const waitingModel =
      msg.agentPhase === "waiting_model" ||
      msg.agentPhase === "sending_request" ||
      msg.agentPhase === "retrying_model";
    if (msg.agentPhase === "compacting_context") parts.push("压缩上下文…");
    else if (msg.agentPhase === "summarizing_tools") parts.push("整理工具结果…");
    else if (msg.agentPhase === "executing_tool" || msg.agentPhase === "executing_tools") return null;
    else if (waitingModel) parts.push("等待模型响应…");
    else parts.push("整合信息中…");

    if (msg.agentTurn) parts.push(`第 ${msg.agentTurn} 轮`);
    if (msg.agentWaitStartedAt && waitingModel) {
      const elapsed = Math.max(0, Math.floor((Date.now() - msg.agentWaitStartedAt) / 1000));
      parts.push(`已等待 ${elapsed}s`);
      if (elapsed > 45) parts.push("模型较慢，可取消后 @ 具体文件重试");
    } else if (msg.agentDetail?.trim()) {
      parts.push(msg.agentDetail.trim());
    }
    return parts.join(" · ");
  }

  function agentStatusDisplay(msg: ChatMessage): string {
    void agentUiTick.value;
    let statusText = "";
    if (msg.status) {
      if (
        msg.agentWaitStartedAt &&
        (msg.agentPhase === "waiting_model" ||
          msg.agentPhase === "sending_request" ||
          msg.agentPhase === "retrying_model") &&
        !msg.agentDetail
      ) {
        const elapsed = Math.max(0, Math.floor((Date.now() - msg.agentWaitStartedAt) / 1000));
        statusText = `${msg.status} · 已等待 ${elapsed}s`;
      } else {
        statusText = msg.status;
      }
    } else {
      statusText = msg.agentPhase ? formatAgentStatus({ phase: msg.agentPhase, detail: msg.agentDetail }, true) : "正在运行…";
    }

    const tokenInfo: string[] = [];
    if (msg.streamChars && msg.streamChars > 0) {
      tokenInfo.push(`${msg.streamChars} 字输出`);
    }
    if (msg.contextChars && msg.contextChars > 0) {
      tokenInfo.push(`${formatCharCount(msg.contextChars)} 上下文`);
    }
    if (tokenInfo.length > 0) {
      statusText += ` · ${tokenInfo.join(" · ")}`;
    }

    return statusText;
  }

  function agentRunningHint(msg: ChatMessage): string {
    if (msg.streamChars && msg.streamChars > 0) return `${msg.streamChars} 字`;
    if (msg.agentDetail) return msg.agentDetail;
    if (msg.agentTurn && msg.agentMaxTurns) return `${msg.agentTurn}/${msg.agentMaxTurns}`;
    if (msg.agentTurn) return `第 ${msg.agentTurn} 轮`;
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
    assistantMsg.streaming = true;
    patchAssistantMsg(msgId, {
      streaming: true,
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

    const run = () => {
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
          trySilentContinue(m, reason);
        }
        return;
      }
    }
  }

  function prepareAssistantForSilentContinue(assistantMsg: ChatMessage) {
    for (const tool of assistantMsg.tools || []) {
      if (tool.running) tool.running = false;
    }
    assistantMsg.streaming = false;
    assistantMsg.agentPhase = undefined;
    assistantMsg.status = "";
  }

  function trySilentContinue(assistantMsg: ChatMessage, reason: string): boolean {
    if (!shouldSilentAutoContinue(reason)) return false;
    const count = assistantMsg.agentContinueCount ?? 0;
    if (count >= AGENT_SILENT_CONTINUE_MAX) return false;
    if (!configReady.value || !projectOpened.value) return false;
    if (!resolveOriginalUserPrompt(assistantMsg.id)) return false;

    prepareAssistantForSilentContinue(assistantMsg);
    assistantMsg.agentContinueCount = count + 1;
    chatError.value = "";
    appendStatusLog(assistantMsg, buildSilentContinueStatusLog(reason, assistantMsg.agentContinueCount));
    patchAssistantMsg(assistantMsg.id, {
      agentContinueCount: assistantMsg.agentContinueCount,
      streaming: false,
      agentPhase: undefined,
      status: "",
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      activityExpanded: true,
      activityDetailed: true,
      tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
      ...syncRoundGroupsPatch(assistantMsg),
    });

    window.setTimeout(() => {
      if (!chatSending.value) void resumeAgentRun(assistantMsg.id, { silent: true });
    }, AGENT_SILENT_CONTINUE_DELAY_MS);
    return true;
  }

  function handleRecoverableInterruption(
    assistantMsg: ChatMessage,
    reason: string,
    options?: { logStatus?: boolean },
  ) {
    if (trySilentContinue(assistantMsg, reason)) return;
    applyRecoverableAgentFailure(assistantMsg, reason, options);
  }

  function applyRecoverableAgentFailure(
    assistantMsg: ChatMessage,
    message: string,
    options?: { logStatus?: boolean },
  ) {
    const recoverable = isRecoverableAgentError(message);
    assistantMsg.agentFailed = true;
    assistantMsg.agentRecoverable = recoverable;
    assistantMsg.agentFailureReason = message;
    assistantMsg.agentRecoveryDismissed = false;
    assistantMsg.streaming = false;

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
      streaming: false,
      activityExpanded: recoverable ? true : assistantMsg.activityExpanded,
      totalTurns: assistantMsg.totalTurns,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      ...syncRoundGroupsPatch(assistantMsg),
    });

    cancelAutoResume();
  }

  function recoverAgentRunFromStall(assistantMsg: ChatMessage, reason: string) {
    agentRunGeneration += 1;
    clearStreamDeltaBuffer();
    stopAgentUiTick();
    agentAbortHandle?.abort();
    agentAbortHandle = null;
    agentLastProgressAt = 0;
    chatSending.value = false;
    handleRecoverableInterruption(assistantMsg, reason);
    persistChatNow();
    void scrollChatToBottom();
  }

  function forceRecoverStalledRun(assistantMsgId: string) {
    const msg = chatMessages.value.find((m) => m.id === assistantMsgId);
    if (!msg || msg.role !== "assistant") return;
    if (chatSending.value && msg.id === activeAssistantMsgId.value) {
      recoverAgentRunFromStall(msg, agentStallRecoveryReason());
      return;
    }
    if (canResumeAgentRun(msg)) {
      void resumeAgentRun(assistantMsgId);
    }
  }

  function resolveCompletedTurns(reported: number, msg: ChatMessage): number {
    if (reported > 0) return reported;
    return resolveAgentCompletedTurns(msg);
  }

  function dequeuePendingPromptAndRun() {
    if (!pendingPromptQueue.value.length) return;
    const next = pendingPromptQueue.value.shift()!;
    persistPendingQueue();
    void runAgentTurn(next, { skipUserBubble: true });
  }

  function handleAgentEvent(event: VibeAgentSseEvent, assistantMsg: ChatMessage, runGen: number) {
    if (runGen !== agentRunGeneration) return;
    const msgId = assistantMsg.id;

    const isProgressEvent =
      event.type === "status" ||
      event.type === "turn_request" ||
      event.type === "turn_response" ||
      event.type === "turn_trace" ||
      event.type === "tool_start" ||
      event.type === "tool_end" ||
      event.type === "file_diff" ||
      event.type === "message_delta" ||
      event.type === "message" ||
      event.type === "agent_context" ||
      event.type === "error";
    if (isProgressEvent) touchAgentProgress();

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
      if (turnText) {
        assistantMsg.content = mergeAssistantTurnText(assistantMsg.content || "", turnText);
      }
      assistantMsg.streaming = false;
      if (event.data.isFinal) {
        assistantMsg.agentPhase = undefined;
        assistantMsg.status = "";
      }
      patchAssistantMsg(msgId, {
        ...syncRoundGroupsPatch(assistantMsg),
        content: assistantMsg.content,
        streaming: assistantMsg.streaming,
        ...(event.data.isFinal ? { agentPhase: undefined, status: "" } : {}),
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
      if (phase && !isAgentConnectPhase(phase)) {
        agentConnectStartedAt = 0;
      }
      const prevPhase = assistantMsg.agentPhase;
      setAgentStatus(assistantMsg, phase, event.data, { log: phase !== prevPhase });
      assistantMsg.roundGroups = recordAgentRoundStatus(
        assistantMsg.roundGroups,
        phase,
        assistantMsg.status || "",
        assistantMsg.agentTurn ?? event.data.turn,
        assistantMsg.agentMaxTurns ?? event.data.maxTurns,
      );
      patchAssistantMsg(msgId, {
        agentPhase: assistantMsg.agentPhase,
        status: assistantMsg.status,
        agentDetail: assistantMsg.agentDetail,
        streamChars: assistantMsg.streamChars,
        contextChars: assistantMsg.contextChars,
        agentWaitStartedAt: assistantMsg.agentWaitStartedAt,
        statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
        agentTurn: assistantMsg.agentTurn,
        agentMaxTurns: assistantMsg.agentMaxTurns,
        agentModel: assistantMsg.agentModel,
        ...syncRoundGroupsPatch(assistantMsg),
        ...(phase === "finished" ? { agentPhase: undefined, streaming: false, agentWaitStartedAt: undefined } : {}),
      });
      if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
      if (phase === "aborted") {
        clearStreamDeltaBuffer();
        assistantMsg.agentAborted = true;
        const abortTurn = assistantMsg.agentTurn ?? 1;
        assistantMsg.roundGroups = recordAgentRoundResponse(
          assistantMsg.roundGroups,
          abortTurn,
          { assistantText: "", toolCalls: [], hasToolCalls: false, isFinal: false },
          assistantMsg.agentMaxTurns,
        );
        patchAssistantMsg(msgId, {
          agentAborted: true,
          ...syncRoundGroupsPatch(assistantMsg),
        });
        stopAgentUiTick();
        chatSending.value = false;
        // Update session status to interrupted
        if (activeSessionId.value && projectPath.value.trim()) {
          updateVibeChatSessionStatus(projectPath.value.trim(), activeSessionId.value, "interrupted");
        }
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
      setAgentStatus(assistantMsg, "executing_tool", {
        toolTitle: meta.title,
        toolDetail: meta.detail,
        turn: assistantMsg.agentTurn,
        maxTurns: assistantMsg.agentMaxTurns,
      });
      patchAssistantMsg(msgId, {
        tools: [...assistantMsg.tools],
        status: assistantMsg.status,
        statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
        agentPhase: assistantMsg.agentPhase,
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
      const pending = assistantMsg.tools?.some((t) => t.running);
      setAgentStatus(assistantMsg, pending ? "executing_tools" : "summarizing_tools", {
        turn: assistantMsg.agentTurn,
        maxTurns: assistantMsg.agentMaxTurns,
      });
      patchAssistantMsg(msgId, {
        tools: assistantMsg.tools ? [...assistantMsg.tools] : undefined,
        status: assistantMsg.status,
        statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
        agentPhase: assistantMsg.agentPhase,
      });
      if (isAgentRunning(assistantMsg)) scrollStatusLogToBottomInternal(msgId);
      void scrollChatToBottom();
      return;
    }

    if (event.type === "message_delta") {
      const delta = event.data.delta || "";
      if (!delta) return;
      enqueueStreamDelta(msgId, assistantMsg, delta);
      return;
    }

    if (event.type === "message") {
      clearStreamDeltaBuffer();
      const cleanText = stripTextToolCallMarkup(stripToolSummaryFromAssistantContent(event.data.text));
      assistantMsg.content = mergeAssistantTurnText(assistantMsg.content || "", cleanText);
      assistantMsg.streaming = false;
      assistantMsg.status = "";
      assistantMsg.agentPhase = undefined;
      patchAssistantMsg(msgId, {
        content: cleanText,
        streaming: false,
        status: "",
        agentPhase: undefined,
      });
      persistChatNow();
      void scrollChatToBottom();
      return;
    }

    if (event.type === "error") {
      clearStreamDeltaBuffer();
      stopAgentUiTick();
      agentLastProgressAt = 0;
      chatSending.value = false;
      planExecutionActive.value = false;
      if (trySilentContinue(assistantMsg, event.data.message)) {
        persistChatNow();
        void scrollChatToBottom();
        return;
      }
      applyRecoverableAgentFailure(assistantMsg, event.data.message);
      persistChatNow();
      void scrollChatToBottom();

      const recoverable = isRecoverableAgentError(event.data.message);
      if (!recoverable && pendingPromptQueue.value.length) {
        dequeuePendingPromptAndRun();
      }
      return;
    }

    if (event.type === "done") {
      clearStreamDeltaBuffer();
      stopAgentUiTick();
      agentLastProgressAt = 0;
      chatSending.value = false;
      planExecutionActive.value = false;
      agentAbortHandle = null;
      assistantMsg.streaming = false;
      clearPendingAgentRun();

      if (assistantMsg.agentFailed) {
        const completedTurns = resolveCompletedTurns(event.data.turns, assistantMsg);
        if (!assistantMsg.totalTurns) assistantMsg.totalTurns = completedTurns;
        patchAssistantMsg(msgId, {
          streaming: false,
          totalTurns: assistantMsg.totalTurns,
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
      if (!wasAborted && !assistantMsg.agentFailed && activeSessionId.value && projectPath.value.trim()) {
        updateVibeChatSessionStatus(projectPath.value.trim(), activeSessionId.value, "completed");
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

      if (incompleteRun) {
        if (trySilentContinue(assistantMsg, "连接中断（运行未完成）")) {
          if (!assistantMsg.totalTurns) {
            assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
          }
          patchAssistantMsg(msgId, {
            streaming: false,
            totalTurns: assistantMsg.totalTurns,
            ...syncRoundGroupsPatch(assistantMsg),
          });
          persistChatNow();
          void scrollChatToBottom();
          return;
        }
        handleRecoverableInterruption(assistantMsg, "连接中断（运行未完成）", { logStatus: true });
        if (!assistantMsg.totalTurns) {
          assistantMsg.totalTurns = resolveAgentCompletedTurns(assistantMsg);
        }
        patchAssistantMsg(msgId, {
          streaming: false,
          totalTurns: assistantMsg.totalTurns,
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
        if (trySilentContinue(assistantMsg, reason)) {
          assistantMsg.totalTurns = completedTurns;
          patchAssistantMsg(msgId, { totalTurns: completedTurns, ...syncRoundGroupsPatch(assistantMsg) });
          persistChatNow();
          void scrollChatToBottom();
          return;
        }
        handleRecoverableInterruption(assistantMsg, reason, { logStatus: true });
        assistantMsg.totalTurns = completedTurns;
        patchAssistantMsg(msgId, { totalTurns: completedTurns, ...syncRoundGroupsPatch(assistantMsg) });
        persistChatNow();
        void scrollChatToBottom();
        if (pendingPromptQueue.value.length) {
        dequeuePendingPromptAndRun();
        }
        return;
      }

      assistantMsg.totalTurns = completedTurns;
      appendStatusLog(
        assistantMsg,
        wasAborted ? `已停止（共 ${completedTurns} 轮）` : `完成（共 ${completedTurns} 轮）`,
      );

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
      assistantMsg.agentFailed = false;
      assistantMsg.agentRecoverable = false;
      assistantMsg.agentFailureReason = undefined;
      assistantMsg.agentRecoveryDismissed = true;
      assistantMsg.agentContinueCount = undefined;

      assistantMsg.status = "";
      assistantMsg.agentPhase = undefined;
      assistantMsg.content = finalizeAssistantBubbleContent({
        ...assistantMsg,
        wasAborted,
        writtenFiles: fileAction.writtenFiles,
      });
      assistantMsg.activityExpanded = Boolean(assistantMsg.content?.trim());
      patchAssistantMsg(msgId, {
        status: "",
        agentPhase: undefined,
        streaming: false,
        activityExpanded: assistantMsg.activityExpanded,
        content: assistantMsg.content,
        totalTurns: assistantMsg.totalTurns,
        statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
        ...syncRoundGroupsPatch(assistantMsg),
        writtenFiles: assistantMsg.writtenFiles,
        pendingApproval: assistantMsg.pendingApproval,
        agentAborted: assistantMsg.agentAborted || undefined,
        agentFailed: undefined,
        agentRecoverable: undefined,
        agentFailureReason: undefined,
        agentRecoveryDismissed: true,
        agentContinueCount: undefined,
      });
      persistChatNow(undefined, { flushStore: true });

      if (fileAction.writtenFiles?.length) {
        if (assistantMsg.turnFileDiffs) {
          clearTurnFileDiffsFromStore(assistantMsg.turnFileDiffs);
        }
        void handleAgentWrittenFiles(fileAction.writtenFiles);
      }
      void scrollChatToBottom();

      if (pendingPromptQueue.value.length) {
        dequeuePendingPromptAndRun();
      }
    }
  }

  function interruptAgentRun(options?: { logStatus?: boolean }) {
    cancelAutoResume();
    clearPendingAgentRun();
    agentRunGeneration += 1;
    agentLastProgressAt = 0;
    const running = findRunningAssistantMsg();
    if (running) {
      running.agentAborted = true;
      running.streaming = false;
      if (options?.logStatus !== false) {
        appendStatusLog(running, "已被新指令打断");
        setAgentStatus(running, "aborted", undefined, { log: false });
      }
      patchAssistantMsg(running.id, {
        agentAborted: true,
        streaming: false,
        status: running.status,
        statusLog: running.statusLog ? [...running.statusLog] : undefined,
      });
    }
    clearStreamDeltaBuffer();
    stopAgentUiTick();
    agentAbortHandle?.abort();
    agentAbortHandle = null;
    chatSending.value = false;
  }

  function stopAgent() {
    interruptAgentRun();
  }

  function tryResumeHmrInterruptedRun(): void {
    const pending = popPendingAgentRun();
    if (!pending) return;
    // 如果已经有活跃的 Agent 运行，不恢复
    if (chatSending.value || agentAbortHandle) return;
    // 如果项目路径不匹配，不恢复
    const currentProject = projectPath.value.trim();
    if (pending.projectPath && pending.projectPath !== currentProject) return;
    const prompt = (pending.request?.prompt as string) || "";
    if (!prompt) return;
    // 如果配置尚未就绪，不恢复
    if (!configReady.value || !projectOpened.value) return;

    // 恢复运行：显示提示并自动重发
    chatError.value = "检测到之前因页面刷新中断的 Agent 运行，正在恢复…";
    void runAgentTurn(prompt);
  }

  async function resumeAgentRun(assistantMsgId: string, options?: { silent?: boolean }) {
    cancelAutoResume();
    if (chatSending.value || !configReady.value || !projectOpened.value) return;

    const assistantIdx = chatMessages.value.findIndex((m) => m.id === assistantMsgId);
    if (assistantIdx < 0) return;

    const assistantMsg = chatMessages.value[assistantIdx];
    if (!options?.silent && !canResumeAgentRun(assistantMsg)) return;
    if (options?.silent && !hasRecoverableAgentProgress(assistantMsg)) return;

    const originalPrompt = resolveOriginalUserPrompt(assistantMsgId);
    if (!originalPrompt) return;

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

    reloadAiConfig();
    clearStreamDeltaBuffer();
    chatSending.value = true;
    chatError.value = "";
    resetChatScrollPin();
    startAgentUiTick();

    assistantMsg.agentFailed = false;
    assistantMsg.agentRecoverable = false;
    assistantMsg.agentFailureReason = undefined;
    assistantMsg.agentRecoveryDismissed = true;
    assistantMsg.agentAborted = false;
    assistantMsg.streaming = false;
    const resumedContent = resolveAssistantBubbleContent({ ...assistantMsg, content: "" });
    if (resumedContent) assistantMsg.content = resumedContent;
    assistantMsg.activityExpanded = true;
    assistantMsg.activityDetailed = true;
    assistantMsg.agentPhase = "connecting_local";
    assistantMsg.status = formatAgentStatus({ phase: "connecting_local" });
    appendStatusLog(
      assistantMsg,
      options?.silent
        ? `继续执行（自动续跑 ${assistantMsg.agentContinueCount ?? 1}/${AGENT_SILENT_CONTINUE_MAX}）…`
        : "正在恢复运行…",
    );
    assistantMsg.roundGroups = recordAgentRoundStatus(
      assistantMsg.roundGroups,
      "connecting_local",
      assistantMsg.status || "",
    );
    patchAssistantMsg(assistantMsgId, {
      agentFailed: false,
      agentRecoverable: false,
      agentFailureReason: undefined,
      agentRecoveryDismissed: true,
      content: assistantMsg.content,
      agentAborted: false,
      streaming: false,
      activityExpanded: true,
      activityDetailed: true,
      agentPhase: assistantMsg.agentPhase,
      status: assistantMsg.status,
      statusLog: assistantMsg.statusLog ? [...assistantMsg.statusLog] : undefined,
      ...syncRoundGroupsPatch(assistantMsg),
    });
    persistChatNow();
    await scrollChatToBottom(true);

    const history = shapeAgentHistoryForProfile(
      buildAgentHistoryForResume(assistantMsgId),
      runProfile,
      resumePrompt,
    );

    agentAbortHandle?.abort();
    agentAbortHandle = null;
    const runGen = ++agentRunGeneration;
    agentAbortHandle = runVibeAgentSse(
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
      (event) => handleAgentEvent(event, assistantMsg, runGen),
    );
  }

  async function runAgentTurn(
    userText: string,
    options?: {
      skipUserBubble?: boolean;
      resumeAssistantMsg?: ChatMessage;
      referencedFiles?: string[];
      imageDataUrls?: string[];
      userBubbleContent?: string;
      /** When executing a specific plan message, use its content as the prior assistant plan. */
      planAssistantContent?: string;
    },
  ) {
    const rawPrompt = userText.trim();
    const project = projectPath.value.trim();
    const imageSources = options && 'imageDataUrls' in options
      ? (options.imageDataUrls ?? [])
      : await resolveImagesForAgentTurn(project, chatMessages.value);
    const compressedImages = imageSources.length
      ? await compressImageDataUrlsForAgent(imageSources)
      : undefined;
    const hasImages = Boolean(compressedImages?.length);
    if ((!rawPrompt && !hasImages) || !configReady.value || !projectOpened.value) return;

    agentConnectHasImages = hasImages;

    const lastAssistant = options?.planAssistantContent ?? findLastAssistantContent();
    const mode = chatMode.value;
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
        hasImages,
      }),
      runProfile,
    );

    reloadAiConfig();
    clearStreamDeltaBuffer();
    chatSending.value = true;
    chatError.value = "";
    resetChatScrollPin();
    startAgentUiTick();

    const history = buildAgentHistory(rawPrompt, runProfile);

    let assistantMsg: ChatMessage;
    if (options?.resumeAssistantMsg) {
      assistantMsg = options.resumeAssistantMsg;
    } else {
      if (!options?.skipUserBubble) {
        chatMessages.value.push({
          id: genId(),
          role: "user",
          content: options?.userBubbleContent ?? stripReferenceAttachments(rawPrompt),
          imageDataUrls: compressedImages?.length ? [...compressedImages] : undefined,
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
        agentPhase: "connecting_local",
        agentDetail: hasImages ? "上传图片中…" : undefined,
        status: formatAgentStatus({
          phase: "connecting_local",
          detail: hasImages ? "上传图片中…" : undefined,
        }),
      };
      chatMessages.value.push(assistantMsg);
      assistantMsg.roundGroups = recordAgentRoundStatus(
        assistantMsg.roundGroups,
        "connecting_local",
        assistantMsg.status || "",
      );
      persistChatNow();
      await scrollChatToBottom(true);
    }

    agentAbortHandle?.abort();
    agentAbortHandle = null;
    const runGen = ++agentRunGeneration;
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
      imageDataUrls: compressedImages?.length ? compressedImages : undefined,
    };
    // 持久化请求状态，以便 HMR 重载后恢复
    persistAgentRunForHmr({
      request: agentRequest as unknown as Record<string, unknown>,
      projectPath: agentRequest.projectPath,
      sessionId: activeSessionId.value || undefined,
    });
    agentAbortHandle = runVibeAgentSse(
      agentRequest,
      (event) => handleAgentEvent(event, assistantMsg, runGen),
    );
  }

  function shouldShowMessageBubble(msg: ChatMessage): boolean {
    if (msg.role === "user") {
      return Boolean(msg.content?.trim());
    }
    if (hasAgentActivity(msg)) return false;
    return Boolean(messageDisplayContent(msg));
  }

  function canExecutePlanMessage(msg: ChatMessage): boolean {
    if (msg.role !== "assistant") return false;
    if (chatMode.value !== "plan") return false;
    if (chatSending.value || msg.streaming || isAgentRunning(msg)) return false;
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
    shouldShowMessageBubble,
    canExecutePlanMessage,
    executePlanFromMessage,
    planExecutionActive,
    scheduleStreamScroll,
    getAgentAbortHandle: () => agentAbortHandle,
  };
}
