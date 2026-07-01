import { ref, computed, type Ref, type ComputedRef } from "vue";
import type { VibeChatMessage, AgentStatusData } from "../types/vibeChat";
import {
  createInitialLiveState,
  patchLiveFromStatusEvent,
  formatAgentLiveStatus,
  resolveModelWaitElapsedSeconds,
  type AgentRunLiveState,
} from "../services/agentRunLiveState";
import {
  finalizeAssistantBubbleContent,
  resolveAgentTimelineAnswer,
  type LiveAgentAnswerSource,
} from "../services/agentMessageDisplay";
import { extractPlanContentFromStoredMessage } from "../services/planFile";
import {
  buildAgentRoundGroupViewsForMessage,
  resolveAgentAnswerPreview,
} from "../services/agentMessageViewModel";
import {
  buildCompactStatusInput,
  buildCursorCompactLiveStatus,
} from "../services/agentCompactStatus";
import {
  resolveAgentFailureBubbleContent,
  canResumeAgentRun,
  hasRecoverableAgentProgress,
  inferAgentRecoveryFlags,
} from "../services/agentRecovery";
import { stripReferenceAttachments } from "../services/vibeChatStorage";
import {
  hasRunningTool,
  assistantTransientUiClearPatch,
  syncRoundGroupsPatch,
} from "../utils/vibeHelpers";
import { createAgentSessionRunManager, type SessionAgentRun } from "./agentSessionRuns";

export type ChatMessage = VibeChatMessage;

export interface UseAgentStateDeps {
  activeSessionId: Ref<string>;
  chatMessages: Ref<ChatMessage[]>;
  chatMode: Ref<string>;
  resolveUserMessageImages: (msg: ChatMessage) => string[];
}

export function useAgentState(deps: UseAgentStateDeps) {
  const { activeSessionId, chatMessages, chatMode, resolveUserMessageImages } = deps;

  const runManager = createAgentSessionRunManager<ChatMessage>();

  const agentUiTick = ref(0);
  const agentLiveRevision = ref(0);
  const stalledAssistantMsg = ref<ChatMessage | null>(null);
  const planExecutionActive = ref(false);

  const autoResumeSecondsLeft = ref(0);
  const autoResumeTargetId = ref("");
  const runningAssistantMsgId = ref("");

  function bumpLiveRevision() {
    agentLiveRevision.value += 1;
  }

  function findRunForMsg(msgOrId: ChatMessage | string): SessionAgentRun<ChatMessage> | undefined {
    const msgId = typeof msgOrId === "string" ? msgOrId : msgOrId.id;
    return runManager.findByAssistantMsgId(msgId);
  }

  function getLiveForMsg(msg: ChatMessage): AgentRunLiveState | undefined {
    return findRunForMsg(msg)?.live;
  }

  function resolveLiveAgentSource(msg: ChatMessage): LiveAgentAnswerSource {
    const run = findRunForMsg(msg);
    const live = run?.live ?? getLiveForMsg(msg);
    const source = run?.assistantMsgId === msg.id ? (run.assistantMsg as ChatMessage) : msg;
    return {
      content: source.content,
      roundGroups: source.roundGroups,
      turnTraces: source.turnTraces,
      agentTurn: live?.turn ?? msg.agentTurn,
      agentPhase: live?.phase ?? msg.agentPhase,
    };
  }

  function formatLiveStatus(live: AgentRunLiveState, compact = false): string {
    return formatAgentLiveStatus(live, { chatMode: chatMode.value as any, compact });
  }

  function isRunVisible(sessionId: string): boolean {
    return sessionId === activeSessionId.value;
  }

  function isAgentRunning(msg: ChatMessage): boolean {
    return Boolean(findRunForMsg(msg));
  }

  function isActivityDetailed(msg: ChatMessage): boolean {
    return msg.activityDetailed === true;
  }

  function messageDisplayContent(msg: ChatMessage): string {
    if (msg.role === "user") {
      const text = stripReferenceAttachments(msg.content || "").trim();
      if (text) return text;
      if (resolveUserMessageImages(msg).length) return "";
      if (msg.imageCount && msg.imageCount > 0) return `（已发送 ${msg.imageCount} 张图片）`;
      return msg.content?.trim() || "";
    }
    if (isAgentRunning(msg)) {
      return resolveAgentTimelineAnswer(
        resolveLiveAgentSource(msg),
        "",
        true,
        hasRunningTool(msg),
      );
    }
    if (canResumeAgentRun(msg)) {
      const inferred = inferAgentRecoveryFlags(msg);
      const reason =
        msg.agentFailureReason?.trim() || inferred?.agentFailureReason?.trim() || "";
      return `[Agent 运行失败] ${reason}`;
    }
    const base = finalizeAssistantBubbleContent(msg);
    if (msg.chatMode === "plan") {
      const recovered = extractPlanContentFromStoredMessage(msg, base);
      if (recovered.trim()) return recovered;
    }
    return base;
  }

  function buildCompactStatusForMessage(msg: ChatMessage) {
    const run = findRunForMsg(msg);
    const running = isAgentRunning(msg);
    const liveSource = resolveLiveAgentSource(msg);
    const roundGroupViews = buildAgentRoundGroupViewsForMessage(msg, {
      isRunning: running,
      live: run?.live,
    });
    const answerPreview = resolveAgentAnswerPreview(msg, {
      isRunning: running,
      live: run?.live,
      liveAgentSource: liveSource,
      messageDisplayContent,
    });
    return buildCompactStatusInput(msg, {
      isRunning: running,
      live: run?.live,
      connectStartedAt: run?.connectStartedAt,
      isActivityDetailed: isActivityDetailed(msg),
      roundGroupViews,
      answerPreview,
      liveAgentSource: liveSource,
      hasRunningTool: hasRunningTool(msg),
    });
  }

  function cursorCompactLiveStatus(msg: ChatMessage): string | null {
    void agentLiveRevision.value;
    void agentUiTick.value;
    return buildCursorCompactLiveStatus(buildCompactStatusForMessage(msg));
  }

  function agentStatusDisplay(msg: ChatMessage): string {
    void agentLiveRevision.value;
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
    if (waitingModel) {
      const elapsed = resolveModelWaitElapsedSeconds(live);
      if (elapsed !== null && elapsed >= 15) {
        statusText = `${statusText} · ${elapsed}s`;
      }
      if (elapsed !== null && elapsed > 45) {
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
    const display = agentStatusDisplay(msg).trim();
    const live = getLiveForMsg(msg);
    const model = live?.model || msg.agentModel || "";
    const shortModel = model ? ` · ${model.split("/").pop()}` : "";
    if (display) return `${display}${shortModel}`;
    if (live) return `${formatLiveStatus(live)}${shortModel}`;
    return agentRunningHint(msg);
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

  function ensureDeferredCapture(sessionId: string) {
    const run = runManager.get(sessionId);
    if (!run) return undefined;
    if (!run.deferredCapture) run.deferredCapture = { tools: [] };
    return run.deferredCapture;
  }

  function mergeDeferredCaptureIntoMsg(sessionId: string, msg: ChatMessage) {
    const run = runManager.get(sessionId);
    const captured = run?.deferredCapture;
    if (!captured?.tools.length) {
      if (run) run.deferredCapture = undefined;
      return;
    }
    if (!msg.tools) msg.tools = [];
    msg.tools.push(...captured.tools);
    run!.deferredCapture = undefined;
  }

  return {
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
  };
}
