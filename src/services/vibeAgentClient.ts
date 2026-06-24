import { backendUrl } from "./backendBase";

const DEV_SIDECAR_ORIGIN = "http://127.0.0.1:37891";
const AGENT_CONNECT_TIMEOUT_MS = 45_000;
const AGENT_CONNECT_TIMEOUT_WITH_IMAGES_MS = 120_000;

function resolveConnectTimeoutMs(request: VibeAgentRunRequest): number {
  return request.imageDataUrls?.length ? AGENT_CONNECT_TIMEOUT_WITH_IMAGES_MS : AGENT_CONNECT_TIMEOUT_MS;
}

function isConnectTimeoutError(error: unknown, timedOut: boolean): boolean {
  if (!timedOut) return false;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

/** Agent SSE must not go through Vite's dev proxy (it buffers until the response ends). */
function agentRunUrl(): string {
  const envBase = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");
  if (envBase) return `${envBase}/backend/vibe/agent/run`;
  if (import.meta.env.DEV) return `${DEV_SIDECAR_ORIGIN}/backend/vibe/agent/run`;
  return backendUrl("/backend/vibe/agent/run");
}

export type VibeChatMode = "ask" | "build" | "plan";

export type VibeChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

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
  runProfile?: {
    kind: "interactive" | "execute_plan";
    targetFiles?: string[];
    userIntent?: string;
  };
}

export type VibeAgentSseEvent =
  | {
      type: "status";
      data: {
        phase: string;
        turn?: number;
        maxTurns?: number;
        openFile?: string;
        model?: string;
        retryAttempt?: number;
        retryMaxAttempts?: number;
        retryError?: string;
        detail?: string;
        contextMessages?: number;
        contextChars?: number;
        streamChars?: number;
        streamChunks?: number;
        toolCallCount?: number;
        elapsedMs?: number;
      };
    }
  | { type: "tool_start"; data: { id: string; name: string; args: Record<string, unknown> } }
  | { type: "tool_end"; data: { id: string; name: string; ok: boolean; summary: string; result?: string } }
  | { type: "message"; data: { text: string } }
  | { type: "message_delta"; data: { delta: string } }
  | { type: "file_diff"; data: { path: string; before: string; after: string; deleted?: boolean; created?: boolean } }
  | {
      type: "agent_context";
      data: {
        mode: VibeChatMode;
        systemPrompt: string;
        history: Array<{ role: string; content: string }>;
        projectContext?: string;
        maxTurns?: number;
        model?: string;
        openFile?: string;
      };
    }
  | {
      type: "turn_trace";
      data: { turn: number; maxTurns?: number; assistantText: string; hasToolCalls: boolean };
    }
  | {
      type: "turn_request";
      data: {
        turn: number;
        maxTurns?: number;
        model?: string;
        contextMessages: number;
        contextChars: number;
        messages: Array<{ role: string; content: string; toolCalls?: string }>;
      };
    }
  | {
      type: "turn_response";
      data: {
        turn: number;
        maxTurns?: number;
        assistantText: string;
        toolCalls: Array<{ id: string; name: string; arguments: string }>;
        hasToolCalls: boolean;
        isFinal: boolean;
      };
    }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: { writtenFiles: string[]; pendingFiles: string[]; turns: number; truncated?: boolean } }
  | { type: "unknown"; data: unknown };

function safeJsonParse(input: string): unknown | undefined {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
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
  const controller = new AbortController();
  let doneReceived = false;
  let retryCount = 0;
  let serverEventsReceived = false;
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [1000, 2000, 4000];
  let connectTimedOut = false;

  const connect = async (): Promise<void> => {
    onEvent({ type: "status", data: { phase: retryCount > 0 ? "reconnecting" : "connecting_local", ...(retryCount > 0 ? { retryAttempt: retryCount, retryMaxAttempts: MAX_RETRIES + 1 } : {}) } });

    connectTimedOut = false;
    const connectTimeoutMs = resolveConnectTimeoutMs(request);
    const connectTimer = setTimeout(() => {
      connectTimedOut = true;
      controller.abort();
    }, connectTimeoutMs);

    const url = agentRunUrl();
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(connectTimer);
    }

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      onEvent({
        type: "error",
        data: { message: text || `Agent 请求失败，HTTP ${response.status}` },
      });
      if (!doneReceived) {
        onEvent({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
      }
      return;
    }

    onEvent({ type: "status", data: { phase: "stream_connected" } });

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let pending = "";
    let currentEvent = "message";
    let currentDataLines: string[] = [];

    const flush = () => {
      if (!currentDataLines.length) return;
      serverEventsReceived = true;
      const dataStr = currentDataLines.join("\n");
      const parsed = safeJsonParse(dataStr);
      const type = currentEvent || "message";

      if (type === "status") onEvent({ type: "status", data: (parsed || {}) as VibeAgentSseEvent extends { type: "status"; data: infer D } ? D : never });
      else if (type === "tool_start") onEvent({ type: "tool_start", data: (parsed || {}) as any });
      else if (type === "tool_end") onEvent({ type: "tool_end", data: (parsed || {}) as any });
      else if (type === "message") onEvent({ type: "message", data: (parsed || {}) as any });
      else if (type === "message_delta") onEvent({ type: "message_delta", data: (parsed || {}) as any });
      else if (type === "file_diff") onEvent({ type: "file_diff", data: (parsed || {}) as any });
      else if (type === "agent_context") onEvent({ type: "agent_context", data: (parsed || {}) as any });
      else if (type === "turn_trace") onEvent({ type: "turn_trace", data: (parsed || {}) as any });
      else if (type === "turn_request") onEvent({ type: "turn_request", data: (parsed || {}) as any });
      else if (type === "turn_response") onEvent({ type: "turn_response", data: (parsed || {}) as any });
      else if (type === "error") onEvent({ type: "error", data: (parsed || {}) as any });
      else if (type === "done") {
        doneReceived = true;
        onEvent({ type: "done", data: (parsed || {}) as any });
      }
      else onEvent({ type: "unknown", data: parsed ?? dataStr });

      currentEvent = "message";
      currentDataLines = [];
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) {
          flush();
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          currentDataLines.push(line.slice(5).trimStart());
        }
      }
      // Do not yield with setTimeout(0): when the main thread is busy, the read loop
      // would stall and miss done/events. Event pacing is handled in useAgentRun (rAF queue).
    }

    pending += decoder.decode();
    if (pending.trim()) {
      currentDataLines.push(pending.trim());
      flush();
    }
  };

  (async () => {
    while (true) {
      try {
        await connect();
        if (!doneReceived) {
          if (serverEventsReceived) {
            onEvent({
              type: "error",
              data: { message: "连接中断（流已结束但未收到完成信号）" },
            });
          }
          onEvent({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
        }
        return;
      } catch (error) {
        if (controller.signal.aborted) {
          if (!doneReceived) {
            if (connectTimedOut) {
              onEvent({
                type: "error",
                data: {
                  message: request.imageDataUrls?.length
                    ? "连接本地 Agent 超时（可能因图片过大或 sidecar 未运行）"
                    : "连接本地 Agent 超时，请确认 sidecar 已启动（npm run sidecar）",
                },
              });
            } else {
              onEvent({ type: "status", data: { phase: "aborted" } });
            }
            onEvent({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
          }
          return;
        }

        if (isConnectTimeoutError(error, connectTimedOut)) {
          onEvent({
            type: "error",
            data: {
              message: request.imageDataUrls?.length
                ? "连接本地 Agent 超时（可能因图片过大或 sidecar 未运行）"
                : "连接本地 Agent 超时，请确认 sidecar 已启动（npm run sidecar）",
            },
          });
          if (!doneReceived) {
            onEvent({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
          }
          return;
        }

        if (shouldRetryAgentFetch(error, serverEventsReceived, retryCount, MAX_RETRIES)) {
          retryCount++;
          const delay = RETRY_DELAYS[retryCount - 1];
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delay);
            controller.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
          });
          continue;
        }

        const message = error instanceof Error ? error.message : "未知错误";
        onEvent({ type: "error", data: { message } });
        if (!doneReceived) {
          onEvent({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
        }
        return;
      }
    }
  })();

  return {
    abort: () => controller.abort(),
  };
}
