import type { AgentStatusData } from "../types/vibeChat";
import type { VibeChatMode } from "../../shared/agentTypes";
import { appendStatusDetail, formatContextChars } from "../utils/vibeHelpers";
import { agentConnectingStatusText } from "./agentConnectCopy";

/** Ephemeral Agent progress — lives on SessionAgentRun only, never persisted. */
export type AgentRunLiveState = {
  phase: string;
  detail?: string;
  turn?: number;
  maxTurns?: number;
  model?: string;
  contextChars?: number;
  contextMessages?: number;
  streamChars?: number;
  waitStartedAt?: number;
  elapsedMs?: number;
  toolTitle?: string;
  toolDetail?: string;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryError?: string;
};

export type AgentRunStage =
  | "thinking"
  | "retrieving"
  | "modifying"
  | "verifying"
  | "waiting_confirmation"
  | "recoverable";

/** Coarse UI stage labels keep the run rail scannable while the detail remains phase-specific. */
export function resolveAgentRunStage(
  live: Pick<AgentRunLiveState, "phase" | "toolTitle" | "toolDetail">,
): AgentRunStage {
  const phase = live.phase.trim().toLowerCase();
  if (phase === "aborted") return "recoverable";
  if (phase === "pending_approval" || phase === "waiting_confirmation") {
    return "waiting_confirmation";
  }

  const toolText = `${live.toolTitle || ""} ${live.toolDetail || ""}`.toLowerCase();
  if (/(test|lint|check|verify|build|typecheck|测试|检查|验证|构建|编译)/i.test(toolText)) {
    return "verifying";
  }
  if (/(write|edit|patch|create|delete|rename|apply|写入|修改|创建|删除|重命名|应用)/i.test(toolText)) {
    return "modifying";
  }

  if (
    phase === "building_context" ||
    phase === "compacting_context" ||
    phase.startsWith("vision_") ||
    phase === "preparing" ||
    phase === "starting"
  ) {
    return "retrieving";
  }
  if (phase === "executing_tool" || phase === "executing_tools") return "retrieving";
  return "thinking";
}

export function agentRunStageLabel(stage: AgentRunStage): string {
  switch (stage) {
    case "retrieving":
      return "检索中";
    case "modifying":
      return "修改中";
    case "verifying":
      return "验证中";
    case "recoverable":
      return "可恢复";
    default:
      return "思考中";
  }
}

export function createInitialLiveState(phase = "preparing"): AgentRunLiveState {
  return { phase };
}

const MODEL_WAIT_PHASES = new Set(["waiting_model", "sending_request", "retrying_model", "classifying_intent", "compacting_context"]);
const WAIT_CLEAR_PHASES = new Set(["streaming_model", "planning_tools", "executing_tool"]);

export function patchLiveFromStatusEvent(
  prev: AgentRunLiveState,
  phase: string,
  extra?: Partial<AgentStatusData> & { toolTitle?: string; toolDetail?: string },
): AgentRunLiveState {
  const next: AgentRunLiveState = {
    ...prev,
    phase,
    detail: extra?.detail !== undefined ? extra.detail : prev.detail,
    turn: extra?.turn ?? prev.turn,
    maxTurns: extra?.maxTurns ?? prev.maxTurns,
    model: extra?.model ?? prev.model,
    contextChars: extra?.contextChars ?? prev.contextChars,
    contextMessages: extra?.contextMessages ?? prev.contextMessages,
    streamChars: extra?.streamChars ?? prev.streamChars,
    elapsedMs:
      typeof extra?.elapsedMs === "number" && extra.elapsedMs > 0
        ? extra.elapsedMs
        : prev.elapsedMs,
    toolTitle: extra?.toolTitle ?? prev.toolTitle,
    toolDetail: extra?.toolDetail ?? prev.toolDetail,
    retryAttempt: extra?.retryAttempt ?? prev.retryAttempt,
    retryMaxAttempts: extra?.retryMaxAttempts ?? prev.retryMaxAttempts,
    retryError: extra?.retryError ?? prev.retryError,
  };

  if (MODEL_WAIT_PHASES.has(phase)) {
    if (!next.waitStartedAt) next.waitStartedAt = Date.now();
  } else if (WAIT_CLEAR_PHASES.has(phase)) {
    next.waitStartedAt = undefined;
    next.elapsedMs = undefined;
  }

  return next;
}

export type FormatAgentLiveStatusOptions = {
  chatMode: VibeChatMode;
  openFile?: string;
  compact?: boolean;
};

/** Single formatter for live run status text (frontend-owned display strings). */
export function formatAgentLiveStatus(
  live: AgentRunLiveState,
  options: FormatAgentLiveStatusOptions,
): string {
  const { chatMode, openFile, compact = false } = options;
  const { phase, turn, maxTurns, model, toolTitle, toolDetail, detail } = live;

  if (phase === "connecting_local") return agentConnectingStatusText();
  if (phase === "stream_connected") return "本地服务已连接，等待 Agent 启动…";
  if (phase === "connected") return "本地 Agent 服务已就绪，正在启动任务…";
  if (phase === "reconnecting") {
    const retryHint =
      live.retryAttempt && live.retryMaxAttempts
        ? `（第 ${live.retryAttempt}/${live.retryMaxAttempts - 1} 次）`
        : "";
    return `正在重连${retryHint}…`;
  }
  if (phase === "classifying_intent") {
    const elapsed = resolveModelWaitElapsedSeconds(live);
    const timer = elapsed !== null && elapsed >= 1 ? ` · ${elapsed}s` : "";
    return appendStatusDetail(`正在分析用户意图${timer}…`, detail);
  }
  if (phase === "clarify_continue") {
    return appendStatusDetail("步骤澄清后继续执行…", detail);
  }
  if (phase === "intent_classified") {
    return appendStatusDetail("意图已识别，准备执行…", detail);
  }
  if (phase === "ambiguous_term_clarification") {
    return appendStatusDetail("用户表述不明确，正在澄清…", detail);
  }
  if (phase === "building_context") {
    return appendStatusDetail("正在扫描项目上下文…", detail);
  }
  if (phase === "compacting_context") {
    const parts: string[] = [];
    if (live.contextMessages) parts.push(`${live.contextMessages} 条消息`);
    if (live.contextChars) parts.push(formatContextChars(live.contextChars));
    const size = parts.length ? `（${parts.join(" · ")}）` : "";
    return appendStatusDetail(`正在整理上下文${size}…`, detail);
  }
  if (phase === "vision_first_turn") {
    return appendStatusDetail("正在查看附图并描述所见…", detail);
  }
  if (phase === "vision_first_turn_done") {
    return appendStatusDetail("读图完成，开始定位与修改…", detail);
  }
  if (phase === "vision_anchor_prefgrep") {
    return appendStatusDetail("读图完成，正在按锚点搜索源码…", detail);
  }
  if (phase === "vision_first_turn_skipped") {
    return appendStatusDetail("读图描述不足，继续执行任务…", detail);
  }
  if (phase === "vision_first_turn_retry") {
    return appendStatusDetail("读图描述不明确，正在重试…", detail);
  }
  if (phase === "vision_consultative_locate_single_turn") {
    return appendStatusDetail("正在按描述在截图中定位元素…", detail);
  }
  if (phase === "vision_fallback") {
    return detail?.trim() ? detail.trim() : "当前模型不支持图片输入，已降级为纯文本请求";
  }
  if (phase === "sending_request") {
    return "正在发送模型请求…";
  }
  if (phase === "preparing" || phase === "starting") {
    if (chatMode === "explore") {
      return appendStatusDetail("正在了解项目…", detail);
    }
    if (chatMode === "ask") {
      return openFile
        ? appendStatusDetail(`正在准备问答上下文（当前文件：${openFile}）…`, detail)
        : appendStatusDetail("正在准备问答上下文…", detail);
    }
    if (chatMode === "plan") {
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
    const elapsed = resolveModelWaitElapsedSeconds(live);
    const timer = elapsed !== null && elapsed >= 2 ? ` · ${elapsed}s` : "";
    return appendStatusDetail(`正在等待模型响应${turnHint}${timer}…`, detail);
  }
  if (phase === "retrying_model") {
    const modelHint = model ? ` · ${model}` : "";
    const turnHint = turn
      ? maxTurns
        ? `（第 ${turn}/${maxTurns} 轮${modelHint}）`
        : `（第 ${turn} 轮${modelHint}）`
      : modelHint;
    const retryHint =
      live.retryAttempt && live.retryMaxAttempts
        ? `，第 ${live.retryAttempt}/${live.retryMaxAttempts - 1} 次重试`
        : "";
    const reason = live.retryError ? `：${live.retryError}` : "";
    const elapsed = resolveModelWaitElapsedSeconds(live);
    const timer = elapsed !== null && elapsed >= 2 ? ` · ${elapsed}s` : "";
    return appendStatusDetail(`模型请求失败${reason}，正在重试${turnHint}${retryHint}${timer}…`, detail);
  }
  if (phase === "executing_tool") {
    return toolDetail ? `正在执行：${toolTitle}（${toolDetail}）` : `正在执行：${toolTitle}…`;
  }
  if (phase === "executing_tools") return "正在执行工具调用…";
  if (phase === "summarizing_tools") return "正在整理工具结果，准备下一轮推理…";
  if (phase === "explore_segment_cap") return appendStatusDetail("探索内容较多，正在继续下一段…", detail);
  if (phase === "plan_segment_cap") return appendStatusDetail("规划内容较多，正在继续下一段…", detail);
  if (phase === "consultative_segment_cap") return appendStatusDetail("分析内容较多，正在继续下一段…", detail);
  if (phase === "turn_cap_final_summary") return appendStatusDetail("已达轮次上限，正在汇总结果…", detail);
  if (phase === "continuing") return appendStatusDetail("任务较长，自动续跑下一段…", detail);
  if (phase === "finished") return "";
  if (phase === "aborted") return "已停止运行";
  if (phase.endsWith("_retry")) {
    const reason = live.retryError ? `：${live.retryError}` : "";
    return appendStatusDetail(`正在重试${reason}…`, detail);
  }
  return "";
}

export function resolveLiveContextChars(live?: AgentRunLiveState): number {
  return live?.contextChars ?? 0;
}

/** Elapsed whole seconds while waiting for model; prefers client clock over stale server 0. */
export function resolveModelWaitElapsedSeconds(
  live: AgentRunLiveState,
  now = Date.now(),
): number | null {
  if (!live.waitStartedAt) return null;
  const fromClock = Math.max(0, Math.floor((now - live.waitStartedAt) / 1000));
  const fromServer =
    typeof live.elapsedMs === "number" && live.elapsedMs > 0
      ? Math.floor(live.elapsedMs / 1000)
      : null;
  return fromServer === null ? fromClock : Math.max(fromClock, fromServer);
}
