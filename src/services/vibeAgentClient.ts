import { isTauriEnv, runAgentChannel } from "./tauriInvoke";
import { backendUrl } from "./backendBase";
import { getAuthHeaders } from "./serverAuth";
import { runAgentServerSse } from "./webAgentTransport";
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
  /** Enable verbose debug payloads (real systemPrompt + per-turn messages). */
  debug?: boolean;
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

/**
 * Web 模式：POST 到 agent-server 的 /api/agent/run，流式读 SSE 事件。
 * Agent 在服务器上跑完整工具闭环（读写文件 / Git），浏览器只是遥控器。
 */
function runWebAgentSse(
  request: VibeAgentRunRequest,
  onEvent: (event: VibeAgentSseEvent) => void,
): ReturnType<typeof runAgentChannel> {
  const abortCtrl = new AbortController();
  const url = backendUrl("/api/agent/run");
  // 服务器模式：key 由服务端配置注入（任务 C），浏览器不下发明文 key。
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
    },
    (ev) => onEvent(ev as VibeAgentSseEvent),
    abortCtrl.signal,
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: "error", data: { message } });
  });
  return {
    promise,
    abort: () => {
      abortCtrl.abort();
      void fetch(backendUrl("/api/agent/cancel"), {
        method: "POST",
        headers: getAuthHeaders(),
      }).catch(() => {});
    },
  };
}
