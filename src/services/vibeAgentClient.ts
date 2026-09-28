import { isTauriEnv, runAgentChannel } from "./tauriInvoke";
import { backendUrl } from "./backendBase";
import { getAuthHeaders } from "./serverAuth";
import { runAgentServerSse, type WebAgentSseEvent } from "./webAgentTransport";
import type { ResolvedUserIntent } from "./intentClassifierTypes";
import type { VibeAgentEvent, VibeChatMode, VibeChatHistoryMessage } from "../../shared/agentTypes";

export type { VibeChatMode, VibeChatHistoryMessage };

export type VibeAgentSseEvent = VibeAgentEvent | { type: "unknown"; data: unknown };

export interface VibeAgentRunRequest {
  prompt: string;
  history?: VibeChatHistoryMessage[];
  projectPath: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  mode?: VibeChatMode;
  maxTurns?: number;
  openFilePath?: string;
  imageDataUrls?: string[];
  /** 与 AI 配置「网页抓取代理」一致，供 web_search / web_extract 使用 */
  webProxyUrl?: string;
  runProfile?: {
    kind: "interactive" | "execute_plan";
    targetFiles?: string[];
    userIntent?: string;
    triggerSource?: "auto_bug_fix";
  };
  /** Paths already written in earlier segments of the same assistant turn (resume). */
  taskWrittenFiles?: string[];
  /** Merged rule + AI intent (Tauri desktop). */
  resolvedUserIntent?: ResolvedUserIntent;
  /**
   * 遗留调试标志。真实 systemPrompt 与每轮 messages 现在**恒常下发**（轨迹抽屉
   * 是注入提示词的唯一查看面），后端不再据此门控；字段保留只为兼容旧调用方。
   */
  debug?: boolean;
  /** Chat session id — enables server-side run checkpoints. */
  sessionId?: string;
  /** Sticky one-line session goal injected into the agent system prompt. */
  sessionGoal?: string;
  /** Assistant bubble id for checkpoint merge on reload. */
  assistantMsgId?: string;
  /** Per-invocation run id (uuid). */
  runId?: string;
}

export function shouldRetryAgentFetch(
  error: unknown,
  serverEventsReceived: boolean,
  retryCount: number,
  maxRetries = 3,
): boolean {
  return isRetryableNetworkError(error) && !serverEventsReceived && retryCount < maxRetries;
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.message === "Aborted") return false;
    const msg = error.message.toLowerCase();
    if (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network error") ||
      msg.includes("econnreset") ||
      msg.includes("socket hang up") ||
      msg.includes("fetch failed")
    ) {
      return true;
    }
  }
  return false;
}

export function runVibeAgentSse(request: VibeAgentRunRequest, onEvent: (event: VibeAgentSseEvent) => void) {
  if (isTauriEnv()) {
    return runAgentChannel(request, onEvent);
  }
  return runWebAgentSse(request, onEvent);
}

const SSE_STREAM_ENDED_NO_SIGNAL = "连接中断（流已结束但未收到完成信号）";

/**
 * Web 模式：POST 到 agent-server 的 /api/agent/run，流式读 SSE 事件。
 * Agent 在服务器上跑完整工具闭环（读写文件 / Git），浏览器只是遥控器。
 *
 * 终止守卫：SSE 流正常结束（读循环 break）不等于服务端发了 `done`/`error`。
 * 连接被中途掐断、代理超时、服务端进程被杀时，promise 会**正常 resolve 但没有
 * 任何终止事件**。若不兜底，前端 runManager 里的槽永远不被移除：界面一直显示
 * 「思考中」、恢复横幅不出现、chatSending 卡住。这里在流 resolve 后若一次
 * 终止事件都没见过，就补发一条可恢复的 error，让既有恢复链路接管。
 * （桌面版 Tauri channel 由 Rust 保证每个出口都发终止事件，无此缺口。）
 */
function runWebAgentSse(
  request: VibeAgentRunRequest,
  onEvent: (event: VibeAgentSseEvent) => void,
): ReturnType<typeof runAgentChannel> {
  const abortCtrl = new AbortController();
  const url = backendUrl("/api/agent/run");
  // 服务器模式：key 由服务端配置注入（任务 C），浏览器不下发明文 key。
  let sawTerminalEvent = false;
  const guardedOnEvent = (ev: WebAgentSseEvent) => {
    const type = ev?.type;
    if (type === "done" || type === "error" || type === "aborted") {
      sawTerminalEvent = true;
    }
    onEvent(ev as VibeAgentSseEvent);
  };
  const promise = runAgentServerSse(
    url,
    {
      prompt: request.prompt,
      history: request.history,
      projectPath: request.projectPath,
      endpoint: request.endpoint,
      apiKey: undefined,
      model: request.model,
      mode: request.mode,
      maxTurns: request.maxTurns,
      imageDataUrls: request.imageDataUrls,
      webProxyUrl: request.webProxyUrl,
      taskWrittenFiles: request.taskWrittenFiles,
      sessionId: request.sessionId,
      sessionGoal: request.sessionGoal,
      assistantMsgId: request.assistantMsgId,
      runId: request.runId,
      runProfile: request.runProfile,
      resolvedUserIntent: request.resolvedUserIntent,
      debug: request.debug,
    },
    guardedOnEvent,
    abortCtrl.signal,
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    sawTerminalEvent = true;
    onEvent({ type: "error", data: { message } });
  }).then(() => {
    // 流已结束却没见过 done/error → 收尾缺口，补发终止信号。
    if (!sawTerminalEvent && !abortCtrl.signal.aborted) {
      onEvent({ type: "error", data: { message: SSE_STREAM_ENDED_NO_SIGNAL } });
    }
  });
  return {
    promise,
    abort: () => {
      abortCtrl.abort();
      void cancelAgentRunBestEffort();
    },
  };
}

export type AgentActiveRunInfo = {
  ok?: boolean;
  active?: boolean;
  projectPath?: string;
  sessionId?: string;
  assistantMsgId?: string;
  runId?: string;
  error?: string;
};

/** Best-effort cancel for unload / disconnect — uses keepalive so the request can outlive the page. */
export function cancelAgentRunBestEffort(): void {
  if (isTauriEnv()) {
    void import("./tauriInvoke")
      .then(({ tauriInvoke }) => tauriInvoke("agent_cancel"))
      .catch(() => {});
    return;
  }
  try {
    void fetch(backendUrl("/api/agent/cancel"), {
      method: "POST",
      headers: getAuthHeaders(),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

/** Whether agent-server / desktop currently has an in-flight run. */
export async function fetchAgentActiveRun(): Promise<AgentActiveRunInfo> {
  if (isTauriEnv()) {
    try {
      const { tauriInvoke } = await import("./tauriInvoke");
      return await tauriInvoke<AgentActiveRunInfo>("agent_active_run");
    } catch (error) {
      return {
        ok: false,
        active: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  try {
    const response = await fetch(backendUrl("/api/agent/active"), {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      return { ok: false, active: false, error: `HTTP ${response.status}` };
    }
    return (await response.json()) as AgentActiveRunInfo;
  } catch (error) {
    return {
      ok: false,
      active: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Page remount / open project: if the server still has a run but this UI has no live SSE,
 * cancel it so it cannot keep writing the repo. Checkpoint merge handles recovery UI.
 */
export async function reclaimOrphanServerAgentRun(options?: {
  hasLocalActiveRun?: boolean;
}): Promise<{ cancelled: boolean; active?: AgentActiveRunInfo }> {
  if (options?.hasLocalActiveRun) {
    return { cancelled: false };
  }
  const active = await fetchAgentActiveRun();
  if (!active.ok || !active.active) {
    return { cancelled: false, active };
  }
  cancelAgentRunBestEffort();
  // Give the server a brief moment to observe cancel (non-blocking for callers that await).
  await new Promise((r) => setTimeout(r, 50));
  return { cancelled: true, active };
}
