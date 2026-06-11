import { ref, computed, nextTick, reactive } from "vue";
import {
  AGENT_SILENT_CONTINUE_DELAY_MS,
  AGENT_SILENT_CONTINUE_MAX,
  agentStallRecoveryReason,
  agentConnectStallMessage,
  buildAgentMaxTurnsExhaustedMessage,
  buildAgentResumePrompt,
  buildSilentContinueStatusLog,
  canResumeAgentRun as canResumeAgentRunBase,
  hasRecoverableAgentProgress,
  inferAgentRecoveryFlags,
  isAgentMaxTurnsExhausted,
  isAgentConnectPhase,
  isAgentConnectStalled,
  isAgentRunStalled,
  isRecoverableAgentError,
  recoverableAgentErrorHint as recoverableAgentErrorHintBase,
  resolveAgentCompletedTurns,
  resolveAgentFailureBubbleContent,
  shouldSilentAutoContinue,
  resolveAutoResumeSeconds,
} from "../services/agentRecovery";
import {
  buildAgentRoundGroupViews,
  recordAgentRoundStreamDelta,
  type AgentRoundGroup,
  type AgentRoundGroupView,
} from "../services/agentRoundGroups";
import {
  buildCursorAgentFeed,
  computeExplorationStats,
  cursorActionClass,
  formatCursorActionLabel,
  formatExplorationSummary,
  getRecentFeedActions,
  getRunningFeedAction,
  buildCursorAgentTimeline,
  shouldUseCompactAgentFeed as shouldUseCompactAgentFeedByCount,
  type CursorAgentTimeline,
  type CursorFeedProcessBlock,
} from "../services/agentCursorFeed";
import { type AgentLogLineItem } from "../components/AgentActivityLogStream.vue";
import {
  finalizeAssistantBubbleContent,
  filterDuplicateFeedThoughts,
} from "../services/agentMessageDisplay";
import { isScrollNearBottom, scrollElementToBottom } from "../utils/scrollViewport";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: string;
  agentPhase?: string;
  agentTurn?: number;
  agentMaxTurns?: number;
  agentModel?: string;
  agentDetail?: string;
  streamChars?: number;
  contextChars?: number;
  agentWaitStartedAt?: number;
  reverting?: boolean;
  applying?: boolean;
  agentAborted?: boolean;
  agentFailed?: boolean;
  agentRecoverable?: boolean;
  agentFailureReason?: string;
  agentRecoveryDismissed?: boolean;
  agentContinueCount?: number;
  activityExpanded?: boolean;
  activityDetailed?: boolean;
  tools?: Array<{
    id: string;
    name?: string;
    icon?: string;
    title?: string;
    label?: string;
    detail?: string;
    summary?: string;
    ok?: boolean;
    running?: boolean;
    turn?: number;
    fullResult?: unknown;
    args?: unknown;
  }>;
  roundGroups?: AgentRoundGroup[];
  statusLog?: string[];
  turnTraces?: unknown[];
  turnFileDiffs?: Record<string, { before: string; after: string; deleted?: boolean }>;
  writtenFiles?: string[];
  reverted?: boolean;
  rejected?: boolean;
  chatMode?: string;
  agentContext?: { model?: string };
  totalTurns?: number;
  imageCount?: number;
  _expandedDiffs?: Record<string, boolean>;
}

export interface AgentStatusData {
  phase: string;
  turn?: number;
  maxTurns?: number;
  openFile?: string;
  model?: string;
  toolTitle?: string;
  toolDetail?: string;
  detail?: string;
  streamChars?: number;
  contextChars?: number;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryError?: string;
}

const STREAM_DELTA_FLUSH_MS = 16;
const STREAM_SCROLL_THROTTLE_MS = 120;

export function useAgentRun(options: {
  chatSending: ReturnType<typeof ref<boolean>>;
  activeAssistantMsgId: ReturnType<typeof computed<string>>;
  patchAssistantMsg: (id: string, patch: Partial<ChatMessage>) => void;
  schedulePersistChat: () => void;
  scrollStatusLogToBottom: (msgId: string) => void;
  appendStatusLog: (msg: ChatMessage, line: string) => void;
}) {
  const { chatSending, activeAssistantMsgId, patchAssistantMsg, schedulePersistChat, scrollStatusLogToBottom, appendStatusLog } = options;

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

  let streamDeltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
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
      const extra = detail?.trim();
      return extra ? `正在扫描项目上下文… · ${extra}` : "正在扫描项目上下文…";
    }
    if (phase === "compacting_context") {
      const extra = detail?.trim();
      return extra ? `正在压缩并准备模型上下文… · ${extra}` : "正在压缩并准备模型上下文…";
    }
    if (phase === "vision_first_turn") {
      const extra = detail?.trim();
      return extra ? `正在查看附图并描述所见… · ${extra}` : "正在查看附图并描述所见…";
    }
    if (phase === "vision_first_turn_done") {
      const extra = detail?.trim();
      return extra ? `读图完成，开始定位与修改… · ${extra}` : "读图完成，开始定位与修改…";
    }
    if (phase === "vision_first_turn_skipped") {
      const extra = detail?.trim();
      return extra ? `读图描述不足，继续执行任务… · ${extra}` : "读图描述不足，继续执行任务…";
    }
    if (phase === "sending_request") {
      const extra = detail?.trim();
      return extra ? `正在发送模型请求… · ${extra}` : "正在发送模型请求…";
    }
    if (phase === "preparing" || phase === "starting") {
      const extra = detail?.trim();
      if (openFile) {
        return extra ? `正在组装 Agent 上下文与工具定义（当前文件：${openFile}）… · ${extra}` : `正在组装 Agent 上下文与工具定义（当前文件：${openFile}）…`;
      }
      return extra ? `正在组装 Agent 上下文与工具定义… · ${extra}` : "正在组装 Agent 上下文与工具定义…";
    }
    if (phase === "streaming_model") {
      if (compact) {
        const extra = detail?.trim();
        return extra ? `模型输出中… · ${extra}` : "模型输出中…";
      }
      const modelHint = model ? ` · ${model}` : "";
      const turnHint = turn ? `（第 ${turn} 轮${modelHint}）` : modelHint;
      const extra = detail?.trim();
      return extra ? `模型输出中${turnHint} · ${extra}` : `模型输出中${turnHint}`;
    }
    if (phase === "planning_tools") {
      if (compact) {
        const extra = detail?.trim();
        return extra ? `模型规划工具… · ${extra}` : "模型规划工具…";
      }
      const modelHint = model ? ` · ${model}` : "";
      const turnHint = turn ? `（第 ${turn} 轮${modelHint}）` : modelHint;
      const extra = detail?.trim();
      return extra ? `模型规划工具${turnHint} · ${extra}` : `模型规划工具${turnHint}`;
    }
    if (phase === "waiting_model" || phase === "thinking") {
      if (compact) {
        const extra = detail?.trim();
        return extra ? `正在等待模型响应… · ${extra}` : "正在等待模型响应…";
      }
      const modelHint = model ? ` · ${model}` : "";
      const turnHint = turn
        ? maxTurns
          ? `（第 ${turn}/${maxTurns} 轮${modelHint}）`
          : `（第 ${turn} 轮${modelHint}）`
        : modelHint;
      const extra = detail?.trim();
      return extra ? `正在等待模型响应${turnHint}… · ${extra}` : `正在等待模型响应${turnHint}…`;
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
      const extra = detail?.trim();
      return extra ? `模型请求失败${reason}，正在重试${turnHint}${retryHint}… · ${extra}` : `模型请求失败${reason}，正在重试${turnHint}${retryHint}…`;
    }
    if (phase === "executing_tool") {
      return toolDetail ? `正在执行：${toolTitle}（${toolDetail}）` : `正在执行：${toolTitle}…`;
    }
    if (phase === "executing_tools") return "正在执行工具调用…";
    if (phase === "summarizing_tools") return "正在整理工具结果，准备下一轮推理…";
    if (phase === "continuing") {
      const extra = detail?.trim();
      return extra ? `任务较长，自动续跑下一段… · ${extra}` : "任务较长，自动续跑下一段…";
    }
    if (phase === "finished") return "";
    if (phase === "aborted") return "已停止运行";
    return "";
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
      checkAgentStall();
    }, 1000);
  }

  function stopAgentUiTick() {
    if (agentUiTickTimer) {
      clearInterval(agentUiTickTimer);
      agentUiTickTimer = null;
    }
  }

  function checkAgentStall() {
    if (!chatSending.value) return;
    // This would need to find the running assistant msg
    // Simplified for now
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
      return msg.content?.trim() || "";
    }
    if (canResumeAgentRunBase(msg as any)) return resolveAgentFailureBubbleContent(msg as any);
    return finalizeAssistantBubbleContent(msg as any);
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
    const bubble = messageDisplayContent(msg);
    const items = buildCursorAgentFeed({
      groups: agentRoundGroupViews(msg),
      isRunning: isAgentRunning(msg),
      agentPhase: msg.agentPhase,
      agentDetail,
      answerPreview: bubble,
      streaming: Boolean(msg.streaming && isAgentRunning(msg)),
    });
    return filterDuplicateFeedThoughts(items, bubble, {
      suppressAllWhenBubble: isAgentRunning(msg),
    });
  }

  function cursorAgentTimeline(msg: ChatMessage): CursorAgentTimeline {
    const detailed = isActivityDetailed(msg);
    return buildCursorAgentTimeline(cursorAgentFeed(msg), messageDisplayContent(msg), {
      keepVisible: detailed ? 8 : 6,
      collapseAfter: detailed ? 10 : 5,
      compactWhileRunning: isAgentRunning(msg) && detailed,
      streaming: isAgentRunning(msg),
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
    if (msg.status) {
      if (
        msg.agentWaitStartedAt &&
        (msg.agentPhase === "waiting_model" ||
          msg.agentPhase === "sending_request" ||
          msg.agentPhase === "retrying_model") &&
        !msg.agentDetail
      ) {
        const elapsed = Math.max(0, Math.floor((Date.now() - msg.agentWaitStartedAt) / 1000));
        return `${msg.status} · 已等待 ${elapsed}s`;
      }
      return msg.status;
    }
    return msg.agentPhase ? formatAgentStatus({ phase: msg.agentPhase, detail: msg.agentDetail }, true) : "正在运行…";
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
        scrollStatusLogToBottom(msgId);
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
    if (!chatSending.value) return;
    if (streamScrollTimer) return;
    streamScrollTimer = setTimeout(() => {
      streamScrollTimer = null;
      // scrollChatToBottom would be called here
    }, STREAM_SCROLL_THROTTLE_MS);
  }

  function flushPendingStreamDelta() {
    if (streamDeltaFlushTimer) {
      clearTimeout(streamDeltaFlushTimer);
      streamDeltaFlushTimer = null;
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
    });
    if (isAgentRunning(assistantMsg)) scrollStatusLogToBottom(msgId);
    scheduleStreamScroll();
  }

  function enqueueStreamDelta(msgId: string, assistantMsg: ChatMessage, delta: string) {
    if (!pendingStreamDelta || pendingStreamDelta.msgId !== msgId) {
      flushPendingStreamDelta();
      pendingStreamDelta = { msgId, assistantMsg, pending: "" };
    }
    pendingStreamDelta.pending += delta;
    if (streamDeltaFlushTimer) return;
    streamDeltaFlushTimer = setTimeout(() => {
      streamDeltaFlushTimer = null;
      flushPendingStreamDelta();
    }, STREAM_DELTA_FLUSH_MS);
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

  function startAutoResumeCountdown(assistantMsgId: string, errorMessage: string, chatMessages: ChatMessage[]) {
    const msg = chatMessages.find((m) => m.id === assistantMsgId);
    if (!msg || !canResumeAgentRunBase(msg as any)) return;

    autoResumeTargetId.value = assistantMsgId;
    autoResumeSecondsLeft.value = resolveAutoResumeSeconds(
      errorMessage || msg.agentFailureReason || "",
    );
    autoResumeTimer = setInterval(() => {
      if (autoResumeSecondsLeft.value <= 1) {
        const targetId = autoResumeTargetId.value;
        cancelAutoResume();
        // resumeAgentRun would be called here
        return;
      }
      autoResumeSecondsLeft.value -= 1;
    }, 1000);
  }

  function scheduleAutoResume(assistantMsgId: string, errorMessage: string, chatSending: boolean, configReady: boolean, projectOpened: boolean) {
    cancelAutoResume();
    if (!assistantMsgId || !configReady || !projectOpened) return;

    const run = () => {
      if (!assistantMsgId || chatSending || !configReady || !projectOpened) return;
      // startAutoResumeCountdown would be called here
    };

    if (chatSending) {
      queueMicrotask(run);
      return;
    }
    run();
  }

  function prepareAssistantForSilentContinue(assistantMsg: ChatMessage) {
    for (const tool of assistantMsg.tools || []) {
      if (tool.running) tool.running = false;
    }
    assistantMsg.streaming = false;
    assistantMsg.agentPhase = undefined;
    assistantMsg.status = "";
  }

  function shouldShowMessageBubble(msg: ChatMessage): boolean {
    if (msg.role === "user") {
      return Boolean(msg.content?.trim());
    }
    if (hasAgentActivity(msg)) return false;
    return Boolean(messageDisplayContent(msg));
  }

  function truncateDiffPreview(text: string, max = 1200): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n…（共 ${text.length} 字符）`;
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function computeDiffHtml(before: string, after: string, maxLines = 80): { htmlBefore: string; htmlAfter: string } {
    const aLines = before.split("\n");
    const bLines = after.split("\n");
    const maxLen = Math.max(aLines.length, bLines.length);
    const aResult: string[] = [];
    const bResult: string[] = [];
    for (let i = 0; i < maxLen && (aResult.length < maxLines || bResult.length < maxLines); i++) {
      const aLine = i < aLines.length ? aLines[i] : undefined;
      const bLine = i < bLines.length ? bLines[i] : undefined;
      if (aLine === undefined) {
        aResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine!)}</span>`);
        bResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine!)}</span>`);
      } else if (bLine === undefined) {
        aResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
        bResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
      } else if (aLine === bLine) {
        aResult.push(`<span class="diff-line">${escapeHtml(aLine)}</span>`);
        bResult.push(`<span class="diff-line">${escapeHtml(bLine)}</span>`);
      } else {
        aResult.push(`<span class="diff-line diff-del">${escapeHtml(aLine)}</span>`);
        bResult.push(`<span class="diff-line diff-add">${escapeHtml(bLine)}</span>`);
      }
    }
    const tail = maxLen > maxLines ? `\n<span class="diff-overflow">… 共 ${aLines.length} / ${bLines.length} 行</span>` : "";
    return {
      htmlBefore: aResult.join("\n") + tail,
      htmlAfter: bResult.join("\n") + tail,
    };
  }

  return {
    autoResumeSecondsLeft,
    autoResumeTargetId,
    agentUiTick,
    chainJumpVisible,
    formatAgentStatus,
    touchAgentProgress,
    startAgentUiTick,
    stopAgentUiTick,
    setAgentStatus,
    isAgentRunning,
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
    prepareAssistantForSilentContinue,
    shouldShowMessageBubble,
    truncateDiffPreview,
    escapeHtml,
    computeDiffHtml,
  };
}
