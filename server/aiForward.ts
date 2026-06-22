import fs from "node:fs";

export function resolveChatEndpoint(endpoint: string): string {
  const input = endpoint.trim();
  if (!input) return input;
  if (input.endsWith("/chat/completions")) return input;
  if (input.endsWith("/completions")) return input.replace(/\/completions$/, "/chat/completions");
  if (input.endsWith("/audio/speech")) return input.replace(/\/audio\/speech$/, "/chat/completions");
  return `${input.replace(/\/+$/, "")}/chat/completions`;
}

export function buildHeaders(apiKey?: string): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export const DEFAULT_AI_MAX_RETRIES = 3;

/** Default agent runs use one extra retry for long multi-turn tasks. */
export const AGENT_AI_MAX_RETRIES = DEFAULT_AI_MAX_RETRIES + 1;

/** Abort fetch if the model does not send the first response byte within this window. */
export const MODEL_FIRST_BYTE_TIMEOUT_MS = 60_000;

/** Scale first-byte timeout for large agent contexts (up to +120s). */
export function resolveFirstByteTimeoutMs(contextChars = 0): number {
  const extraSeconds = Math.min(120, Math.floor(Math.max(0, contextChars) / 1500));
  return MODEL_FIRST_BYTE_TIMEOUT_MS + extraSeconds * 1000;
}

export function isRetryableAiError(input: {
  status?: number;
  error?: string;
  rawText?: string;
  fetchError?: unknown;
}): boolean {
  if (input.fetchError) {
    const err = input.fetchError;
    if (err instanceof Error && (err.name === "AbortError" || err.message === "Aborted")) {
      return false;
    }
    return true;
  }

  const status = input.status ?? 0;
  if ([408, 429, 502, 503, 504].includes(status)) return true;

  if ((input.error || "").includes("模型返回为空")) return true;
  if ((input.error || "").includes("模型响应超时")) return true;

  const haystack = `${input.error || ""} ${input.rawText || ""}`.toLowerCase();
  return /gateway error|请求超时|timeout|timed out|econnreset|etimedout|socket hang up|fetch failed|network error|overload|rate.?limit|too many requests|service unavailable|bad gateway/.test(
    haystack,
  );
}

function delayMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelayForAttempt(attempt: number): number {
  return Math.min(30_000, 2000 * 2 ** (attempt - 1));
}

export function formatAiHttpError(status: number, rawText: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string }; message?: string };
    detail = String(parsed.error?.message || parsed.message || "").trim();
  } catch {
    const trimmed = rawText.trim();
    if (trimmed) detail = trimmed.slice(0, 500);
  }

  const base = detail ? `请求失败，HTTP ${status}：${detail}` : `请求失败，HTTP ${status}`;
  if (status === 401) {
    return `${base}\n鉴权失败：请到「AI 配置」填写正确的 API Key，点击「保存配置」后再试。`;
  }
  if (status === 403) {
    return `${base}\n访问被拒绝：请检查 API Key 权限或模型是否可用。`;
  }
  if (status === 400) {
    const providerNote = /provider\s*\(/i.test(detail)
      ? "上游模型网关认为本次请求参数不合法。"
      : "请求参数可能不被当前模型或网关接受。";
    return `${base}\n${providerNote}常见原因：endpoint / 模型名配置错误、会话上下文过长、附带图片但模型不支持多模态、或 Agent 工具调用格式不兼容。请到「AI 配置」核对 API Key 与模型（如 mimo-v2.5-pro），或新建会话后重试。`;
  }
  return base;
}

/** Normalize message shapes for picky OpenAI-compatible gateways (e.g. Xiaomi). */
export function normalizeMessagesForChatApi(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      const toolCalls = message.tool_calls.filter((call) => call.id && call.function?.name);
      return {
        ...message,
        content: message.content == null ? "" : message.content,
        tool_calls: toolCalls,
      };
    }
    if (message.role === "tool") {
      return {
        ...message,
        content: message.content == null ? "" : String(message.content),
      };
    }
    return message;
  });
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

import type { ChatContentPart } from "./visionMessage";

export interface ChatCompletionMessage {
  role: string;
  content?: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionResult {
  ok: boolean;
  status: number;
  message?: ChatCompletionMessage;
  rawText: string;
  error?: string;
  /** "stop" | "length" | "tool_calls" | null — only populated from streaming path */
  finish_reason?: string | null;
}

export type ModelStreamProgress = {
  phase: "request_sent" | "waiting_first_byte" | "streaming" | "planning_tools";
  elapsedMs: number;
  streamChars: number;
  streamChunks: number;
  toolCallCount: number;
  toolNames: string[];
};

function parseStreamToolCalls(
  toolCallsMap: Map<number, { id: string; name: string; arguments: string }>,
  deltaToolCalls: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
) {
  for (const tc of deltaToolCalls) {
    const idx = tc.index ?? 0;
    if (!toolCallsMap.has(idx)) {
      toolCallsMap.set(idx, { id: "", name: "", arguments: "" });
    }
    const acc = toolCallsMap.get(idx)!;
    if (tc.id) acc.id = tc.id;
    if (tc.function?.name) acc.name = tc.function.name;
    if (tc.function?.arguments) acc.arguments += tc.function.arguments;
  }
}

function buildMessageFromStream(
  content: string,
  toolCallsMap: Map<number, { id: string; name: string; arguments: string }>,
): ChatCompletionMessage {
  const toolCalls = [...toolCallsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }))
    .filter((tc) => tc.id && tc.function.name);

  return {
    role: "assistant",
    content: toolCalls.length ? content || "" : content || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

function linkAbortSignal(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (!parent) return () => {};
  if (parent.aborted) {
    child.abort();
    return () => {};
  }
  const onAbort = () => child.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  return () => parent.removeEventListener("abort", onAbort);
}

async function chatCompletionWithToolsOnce(params: {
  endpoint: string;
  apiKey?: string;
  model: string;
  messages: ChatCompletionMessage[];
  tools: unknown[];
  signal?: AbortSignal;
  onContentDelta?: (delta: string) => void;
  onStreamProgress?: (progress: ModelStreamProgress) => void;
  firstByteTimeoutMs?: number;
}): Promise<ChatCompletionResult> {
  const chatEndpoint = resolveChatEndpoint(params.endpoint);
  const useStream = Boolean(params.onContentDelta);
  const startedAt = Date.now();
  let lastProgressAt = 0;

  const emitProgress = (progress: ModelStreamProgress, force = false) => {
    if (!params.onStreamProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < 350) return;
    lastProgressAt = now;
    params.onStreamProgress(progress);
  };

  const normalizedMessages = normalizeMessagesForChatApi(params.messages);
  const requestBody: Record<string, unknown> = {
    model: params.model,
    messages: normalizedMessages,
    stream: useStream,
  };
  if (params.tools.length > 0) {
    requestBody.tools = params.tools;
    requestBody.tool_choice = "auto";
  }

  emitProgress(
    {
      phase: "request_sent",
      elapsedMs: 0,
      streamChars: 0,
      streamChunks: 0,
      toolCallCount: 0,
      toolNames: [],
    },
    true,
  );

  const timeoutController = new AbortController();
  let timedOut = false;
  const firstByteTimeoutMs = params.firstByteTimeoutMs ?? MODEL_FIRST_BYTE_TIMEOUT_MS;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, firstByteTimeoutMs);
  const unlinkParent = linkAbortSignal(params.signal, timeoutController);

  let response: Response;
  try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [ai] fetch start: endpoint=${chatEndpoint} model=${params.model} timeout=${firstByteTimeoutMs}ms\n`); } catch {}
  try {
    response = await fetch(chatEndpoint, {
      method: "POST",
      headers: buildHeaders(params.apiKey),
      signal: timeoutController.signal,
      body: JSON.stringify(requestBody),
    });
  } catch (fetchError) {
    try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [ai] fetch ERROR: ${fetchError instanceof Error ? fetchError.message : String(fetchError)} timedOut=${timedOut}\n`); } catch {}
    clearTimeout(timeoutId);
    unlinkParent();
    if (params.signal?.aborted) {
      return { ok: false, status: 0, rawText: "", error: "已取消" };
    }
    if (timedOut) {
      return {
        ok: false,
        status: 0,
        rawText: "",
        error: `模型响应超时（等待首包超过 ${Math.round(firstByteTimeoutMs / 1000)}s）`,
      };
    }
    throw fetchError;
  } finally {
    clearTimeout(timeoutId);
    unlinkParent();
  }

  try { fs.appendFileSync(".debug.log", `[${new Date().toISOString()}] [ai] fetch done: status=${response.status}\n`); } catch {}

  emitProgress(
    {
      phase: "waiting_first_byte",
      elapsedMs: Date.now() - startedAt,
      streamChars: 0,
      streamChunks: 0,
      toolCallCount: 0,
      toolNames: [],
    },
    true,
  );

  if (!response.ok) {
    const rawText = await response.text();
    return {
      ok: false,
      status: response.status,
      rawText,
      error: formatAiHttpError(response.status, rawText),
    };
  }

  if (!useStream) {
    const rawText = await response.text();
    try {
      const parsed = JSON.parse(rawText) as {
        choices?: Array<{ message?: ChatCompletionMessage }>;
        error?: { message?: string };
      };
      const message = parsed.choices?.[0]?.message;
      if (!message) {
        return {
          ok: false,
          status: response.status,
          rawText,
          error: parsed.error?.message || "模型返回为空",
        };
      }
      return { ok: true, status: response.status, message, rawText };
    } catch {
      return { ok: false, status: response.status, rawText, error: "解析模型响应失败" };
    }
  }

  if (!response.body) {
    return { ok: false, status: response.status, rawText: "", error: "模型响应体为空" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let streamChunks = 0;
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
  let sawFirstChunk = false;
  let lastFinishReason: string | null = null;

  const reportStreamProgress = (phase: ModelStreamProgress["phase"], force = false) => {
    const toolNames = [...toolCallsMap.values()].map((tc) => tc.name).filter(Boolean);
    emitProgress(
      {
        phase,
        elapsedMs: Date.now() - startedAt,
        streamChars: content.length,
        streamChunks,
        toolCallCount: toolNames.length,
        toolNames,
      },
      force,
    );
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!sawFirstChunk) {
      sawFirstChunk = true;
      reportStreamProgress("streaming", true);
    }
    buffer += decoder.decode(value, { stream: true });
    streamChunks += 1;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
          error?: { message?: string };
        };

        if (parsed.error?.message) {
          return {
            ok: false,
            status: response.status,
            rawText: "",
            error: parsed.error.message,
          };
        }

        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          params.onContentDelta?.(delta.content);
          reportStreamProgress(delta.tool_calls?.length || toolCallsMap.size ? "planning_tools" : "streaming");
        }
        if (delta?.tool_calls?.length) {
          parseStreamToolCalls(toolCallsMap, delta.tool_calls);
          reportStreamProgress("planning_tools", true);
        }
        const fr = parsed.choices?.[0]?.finish_reason;
        if (fr) lastFinishReason = fr;
      } catch {
        // skip malformed SSE chunk
      }
    }
  }

  const message = buildMessageFromStream(content, toolCallsMap);
  if (!message.content && !message.tool_calls?.length) {
    return { ok: false, status: response.status, rawText: "", error: "模型返回为空", finish_reason: lastFinishReason };
  }

  return { ok: true, status: response.status, message, rawText: "", finish_reason: lastFinishReason };
}

export async function chatCompletionWithTools(params: {
  endpoint: string;
  apiKey?: string;
  model: string;
  messages: ChatCompletionMessage[];
  tools: unknown[];
  signal?: AbortSignal;
  onContentDelta?: (delta: string) => void;
  onStreamProgress?: (progress: ModelStreamProgress) => void;
  maxRetries?: number;
  firstByteTimeoutMs?: number;
  onAttemptStart?: (info: { attempt: number; maxAttempts: number }) => void;
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; error: string }) => void;
}): Promise<ChatCompletionResult> {
  const maxRetries = params.maxRetries ?? DEFAULT_AI_MAX_RETRIES;
  const maxAttempts = maxRetries + 1;
  let lastResult: ChatCompletionResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (params.signal?.aborted) {
      return { ok: false, status: 0, rawText: "", error: "已取消" };
    }

    if (attempt > 1) {
      params.onAttemptStart?.({ attempt, maxAttempts });
    }

    let streamStarted = false;
    const onContentDelta = params.onContentDelta
      ? (delta: string) => {
          streamStarted = true;
          params.onContentDelta?.(delta);
        }
      : undefined;

    try {
      const result = await chatCompletionWithToolsOnce({
        endpoint: params.endpoint,
        apiKey: params.apiKey,
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        signal: params.signal,
        onContentDelta,
        onStreamProgress: params.onStreamProgress,
        firstByteTimeoutMs: params.firstByteTimeoutMs,
      });

      if (result.ok) return result;

      lastResult = result;
      const retryable =
        !streamStarted &&
        isRetryableAiError({
          status: result.status,
          error: result.error,
          rawText: result.rawText,
        });
      if (!retryable || attempt >= maxAttempts) return result;

      const delay = retryDelayForAttempt(attempt);
      params.onRetry?.({
        attempt,
        maxAttempts,
        delayMs: delay,
        error: result.error || "模型请求失败",
      });
      await delayMs(delay, params.signal);
    } catch (fetchError) {
      if (
        fetchError instanceof Error &&
        (fetchError.name === "AbortError" || fetchError.message === "Aborted")
      ) {
        return { ok: false, status: 0, rawText: "", error: "已取消" };
      }

      const message = fetchError instanceof Error ? fetchError.message : "网络请求失败";
      if (
        !isRetryableAiError({ fetchError }) ||
        attempt >= maxAttempts
      ) {
        return { ok: false, status: 0, rawText: "", error: message };
      }

      const delay = retryDelayForAttempt(attempt);
      params.onRetry?.({
        attempt,
        maxAttempts,
        delayMs: delay,
        error: message,
      });
      await delayMs(delay, params.signal);
    }
  }

  return lastResult || { ok: false, status: 0, rawText: "", error: "模型请求失败" };
}
