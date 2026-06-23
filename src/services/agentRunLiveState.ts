import type { AgentStatusData } from "../types/vibeChat";
import type { VibeChatMode } from "./vibeAgentClient";
import { appendStatusDetail } from "../utils/vibeHelpers";

/** Ephemeral Agent progress — lives on SessionAgentRun only, never persisted. */
export type AgentRunLiveState = {
  phase: string;
  detail?: string;
  turn?: number;
  maxTurns?: number;
  model?: string;
  contextChars?: number;
  streamChars?: number;
  waitStartedAt?: number;
  toolTitle?: string;
  toolDetail?: string;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retryError?: string;
};

export function createInitialLiveState(phase = "preparing"): AgentRunLiveState {
  return { phase };
}

const MODEL_WAIT_PHASES = new Set(["waiting_model", "sending_request", "retrying_model"]);
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
    streamChars: extra?.streamChars ?? prev.streamChars,
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

  if (phase === "connecting_local") return "正在连接本地服务（127.0.0.1:37891）…";
  if (phase === "stream_connected") return "本地服务已连接，等待 Agent 启动…";
  if (phase === "connected") return "本地 Agent 服务已就绪，正在启动任务…";
  if (phase === "reconnecting") {
    const retryHint =
      live.retryAttempt && live.retryMaxAttempts
        ? `（第 ${live.retryAttempt}/${live.retryMaxAttempts - 1} 次）`
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
  if (phase === "vision_anchor_prefgrep") {
    return appendStatusDetail("读图完成，正在按锚点搜索源码…", detail);
  }
  if (phase === "vision_first_turn_skipped") {
    return appendStatusDetail("读图描述不足，继续执行任务…", detail);
  }
  if (phase === "vision_fallback") {
    return detail?.trim() ? detail.trim() : "当前模型不支持图片输入，已降级为纯文本请求";
  }
  if (phase === "sending_request") {
    return "正在发送模型请求…";
  }
  if (phase === "preparing" || phase === "starting") {
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
      live.retryAttempt && live.retryMaxAttempts
        ? `，第 ${live.retryAttempt}/${live.retryMaxAttempts - 1} 次重试`
        : "";
    const reason = live.retryError ? `：${live.retryError}` : "";
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

export function resolveLiveContextChars(live?: AgentRunLiveState): number {
  return live?.contextChars ?? 0;
}
