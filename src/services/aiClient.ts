import { backendUrl } from "./backendBase";
import { Channel } from "@tauri-apps/api/core";
import { isTauriEnv, tauriInvoke } from "./tauriInvoke";
import { lsGet, lsSetJson } from "../utils/localStorageSafe";

export interface AiTestRequest {
  endpoint: string;
  apiKey?: string;
  model: string;
  prompt: string;
  imageDataUrl?: string;
  stream: boolean;
  onStreamChunk?: (chunkText: string) => void;
}

export interface AiTestResult {
  ok: boolean;
  status: number;
  rawText: string;
  parsed?: unknown;
  error?: string;
}

export interface AiModelsRequest {
  endpoint: string;
  apiKey?: string;
  forceRefresh?: boolean;
}

export interface AiModelsResult {
  ok: boolean;
  status: number;
  models: string[];
  rawText: string;
  error?: string;
  fromCache?: boolean;
}

interface CachedModelsPayload {
  cachedAt: number;
  models: string[];
  rawText: string;
}

const MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
const MODELS_CACHE_PREFIX = "ai-models-cache:";
const memoryModelsCache = new Map<string, CachedModelsPayload>();

export interface AiTtsRequest {
  endpoint: string;
  apiKey?: string;
  model: string;
  input: string;
  voice: string;
  format: "mp3" | "wav" | "opus";
}

export interface AiTtsResult {
  ok: boolean;
  status: number;
  audioBlob?: Blob;
  error?: string;
}

type ChatMessage =
  | { role: string; content: string }
  | {
      role: string;
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

function buildPayload(model: string, prompt: string, stream: boolean, imageDataUrl?: string) {
  const message: ChatMessage = imageDataUrl
    ? {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      }
    : { role: "user", content: prompt };

  return {
    endpoint: "",
    apiKey: "",
    model,
    messages: [message],
    stream,
  };
}

function cleanHtmlError(html: string): string {
  const trimmed = html.trim();
  if (!/<[a-z/!]/i.test(trimmed)) {
    return trimmed.slice(0, 500);
  }
  const titleMatch = trimmed.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return `服务商返回错误 HTML 页面 (${titleMatch[1].replace(/\s+/g, " ").trim()})`;
  }
  const h1Match = trimmed.match(/<h1>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1]) {
    return `服务商返回错误: ${h1Match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()}`;
  }
  return "服务商返回了 HTML 错误页面 (可能由于网络拦截、Cloudflare 防护或服务商宕机)";
}

export function formatAiHttpError(status: number, rawText: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string }; message?: string };
    detail = String(parsed.error?.message || parsed.message || "").trim();
  } catch {
    detail = cleanHtmlError(rawText);
  }

  const base = detail ? `请求失败，HTTP ${status}：${detail}` : `请求失败，HTTP ${status}`;
  if (status === 401) {
    return `${base}\n鉴权失败：请到「AI 配置」填写正确的 API Key，点击「保存配置」后再试。`;
  }
  if (status === 403) {
    return `${base}\n访问被拒绝：请检查 API Key 权限或模型是否可用。`;
  }
  return base;
}

function parseStreamContentFromLine(line: string): string {
  const cleanLine = line.trim();
  if (!cleanLine.startsWith("data:")) return "";
  const dataPart = cleanLine.slice(5).trim();
  if (!dataPart || dataPart === "[DONE]") return "";

  try {
    const payload = JSON.parse(dataPart) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
    };
    const choice = payload.choices?.[0];
    return choice?.delta?.content || choice?.message?.content || "";
  } catch {
    return "";
  }
}

async function readAiStreamResponse(
  response: Response,
  onStreamChunk?: (chunkText: string) => void,
): Promise<{ ok: boolean; status: number; rawText: string; error?: string }> {
  if (!response.ok) {
    const rawText = await response.text();
    return {
      ok: false,
      status: response.status,
      rawText,
      error: formatAiHttpError(response.status, rawText),
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, status: response.status, rawText: "", error: "无法读取响应流" };
  }

  const decoder = new TextDecoder("utf-8");
  let pending = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";

    for (const line of lines) {
      const chunkText = parseStreamContentFromLine(line);
      if (chunkText) {
        fullText += chunkText;
        onStreamChunk?.(chunkText);
      }
    }
  }

  pending += decoder.decode();
  if (pending.trim()) {
    const tailChunk = parseStreamContentFromLine(pending);
    if (tailChunk) {
      fullText += tailChunk;
      onStreamChunk?.(tailChunk);
    }
  }

  return { ok: true, status: response.status, rawText: fullText };
}

export async function testAiModel(request: AiTestRequest): Promise<AiTestResult> {
  // Tauri: only non-streaming case
  if (isTauriEnv() && !request.stream) {
    try {
      const payload = buildPayload(request.model, request.prompt, false, request.imageDataUrl);
      const result = await tauriInvoke<{ ok: boolean; data?: any; error?: string }>("ai_test", {
        endpoint: request.endpoint,
        apiKey: request.apiKey || null,
        body: payload,
      });
      if (!result.ok) {
        return { ok: false, status: 0, rawText: "", error: result.error || "AI 测试失败" };
      }
      const rawText = JSON.stringify(result.data);
      return { ok: true, status: 200, rawText, parsed: result.data };
    } catch (e: unknown) {
      return { ok: false, status: 0, rawText: "", error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (isTauriEnv() && request.stream) {
    try {
      const payload = buildPayload(request.model, request.prompt, true, request.imageDataUrl);
      const channel = new Channel<string>();
      channel.onmessage = (chunk) => {
        if (chunk) request.onStreamChunk?.(chunk);
      };
      const result = await tauriInvoke<{ ok: boolean; status?: number; rawText?: string; error?: string }>(
        "ai_test_stream",
        {
          endpoint: request.endpoint,
          apiKey: request.apiKey || null,
          body: payload,
          onChunk: channel,
        },
      );
      if (!result.ok) {
        return {
          ok: false,
          status: result.status ?? 0,
          rawText: result.rawText ?? "",
          error: result.error || "AI 流式测试失败",
        };
      }
      const rawText = result.rawText ?? "";
      return { ok: true, status: result.status ?? 200, rawText };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知网络错误";
      return { ok: false, status: 0, rawText: "", error: errorMessage };
    }
  }

  try {
    const payload = buildPayload(request.model, request.prompt, request.stream, request.imageDataUrl);
    payload.endpoint = request.endpoint;
    payload.apiKey = request.apiKey || "";

    const response = await fetch(backendUrl("/backend/ai/test"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (request.stream && response.body) {
      const streamResult = await readAiStreamResponse(response, request.onStreamChunk);
      return {
        ok: streamResult.ok,
        status: streamResult.status,
        rawText: streamResult.rawText,
        error: streamResult.error,
      };
    }

    const rawText = await response.text();
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }

    return {
      ok: response.ok,
      status: response.status,
      rawText,
      parsed,
      error: response.ok ? undefined : formatAiHttpError(response.status, rawText),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知网络错误";
    const hint = "当前请求走本地后端转发，请检查接口地址、网络连通性和后端日志。";
    return {
      ok: false,
      status: 0,
      rawText: "",
      error: `${errorMessage}\n${hint}`,
    };
  }
}

function resolveModelsEndpoint(endpoint: string): string {
  const input = endpoint.trim();
  if (!input) return input;

  try {
    const url = new URL(input);
    const path = url.pathname;

    if (path.endsWith("/chat/completions")) {
      url.pathname = path.replace(/\/chat\/completions$/, "/models");
      return url.toString();
    }

    if (path.endsWith("/models")) {
      return url.toString();
    }

    const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;
    url.pathname = normalizedPath ? `${normalizedPath}/models` : "/models";
    return url.toString();
  } catch {
    if (input.endsWith("/chat/completions")) {
      return input.replace(/\/chat\/completions$/, "/models");
    }
    if (input.endsWith("/models")) {
      return input;
    }
    return `${input.replace(/\/$/, "")}/models`;
  }
}

function buildModelsCacheKey(modelsEndpoint: string, apiKey?: string): string {
  const keyPart = `${modelsEndpoint}|${apiKey || ""}`;
  return `${MODELS_CACHE_PREFIX}${keyPart}`;
}

function readModelsCache(cacheKey: string): CachedModelsPayload | undefined {
  const now = Date.now();

  const memoryHit = memoryModelsCache.get(cacheKey);
  if (memoryHit && now - memoryHit.cachedAt <= MODELS_CACHE_TTL_MS) {
    return memoryHit;
  }

  const raw = lsGet(cacheKey);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as CachedModelsPayload;
    if (!parsed || typeof parsed.cachedAt !== "number" || !Array.isArray(parsed.models)) return;
    if (now - parsed.cachedAt > MODELS_CACHE_TTL_MS) return;
    memoryModelsCache.set(cacheKey, parsed);
    return parsed;
  } catch {
    return;
  }
}

function writeModelsCache(cacheKey: string, payload: CachedModelsPayload) {
  memoryModelsCache.set(cacheKey, payload);
  lsSetJson(cacheKey, payload);
}

export async function fetchAvailableModels(request: AiModelsRequest): Promise<AiModelsResult> {
  try {
    const modelsEndpoint = resolveModelsEndpoint(request.endpoint);
    const cacheKey = buildModelsCacheKey(modelsEndpoint, request.apiKey);

    if (!request.forceRefresh) {
      const cached = readModelsCache(cacheKey);
      if (cached) {
        return {
          ok: true,
          status: 200,
          models: cached.models,
          rawText: cached.rawText,
          fromCache: true,
        };
      }
    }

    // Tauri path
    if (isTauriEnv()) {
      try {
        const result = await tauriInvoke<{ ok: boolean; data?: any; error?: string }>("ai_models", {
          endpoint: modelsEndpoint,
          apiKey: request.apiKey || null,
        });
        if (!result.ok) {
          return { ok: false, status: 0, models: [], rawText: "", error: result.error || "获取模型失败", fromCache: false };
        }
        const source = result.data?.data || result.data?.models || [];
        const modelNames = (Array.isArray(source) ? source : []).map((m: any) => m.id || "").filter(Boolean) as string[];
        const rawText = JSON.stringify(result.data);
        if (modelNames.length) {
          writeModelsCache(cacheKey, { cachedAt: Date.now(), models: modelNames, rawText });
        }
        return { ok: true, status: 200, models: modelNames, rawText, fromCache: false };
      } catch (e: unknown) {
        return { ok: false, status: 0, models: [], rawText: "", error: e instanceof Error ? e.message : String(e), fromCache: false };
      }
    }

    const response = await fetch(backendUrl("/backend/ai/models"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: modelsEndpoint,
        apiKey: request.apiKey || "",
      }),
    });

    const rawText = await response.text();
    let modelNames: string[] = [];

    try {
      const parsed = JSON.parse(rawText) as {
        data?: Array<{ id?: string }>;
        models?: Array<{ id?: string }>;
      };
      const source = parsed.data || parsed.models || [];
      modelNames = source.map((item) => item.id || "").filter(Boolean);
    } catch {
      modelNames = [];
    }

    if (response.ok && modelNames.length) {
      writeModelsCache(cacheKey, {
        cachedAt: Date.now(),
        models: modelNames,
        rawText,
      });
    }

    return {
      ok: response.ok,
      status: response.status,
      models: modelNames,
      rawText,
      error: response.ok ? undefined : `获取模型失败，HTTP ${response.status}`,
      fromCache: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知网络错误";
    return {
      ok: false,
      status: 0,
      models: [],
      rawText: "",
      error: `${errorMessage}\n请检查接口地址与网络连通性。`,
      fromCache: false,
    };
  }
}

function resolveTtsEndpoint(endpoint: string): string {
  const input = endpoint.trim();
  if (!input) return input;

  try {
    const url = new URL(input);
    const path = url.pathname;

    if (path.endsWith("/chat/completions")) {
      return url.toString();
    }

    if (path.endsWith("/audio/speech")) {
      url.pathname = path.replace(/\/audio\/speech$/, "/chat/completions");
      return url.toString();
    }

    const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;
    url.pathname = normalizedPath ? `${normalizedPath}/chat/completions` : "/chat/completions";
    return url.toString();
  } catch {
    if (input.endsWith("/chat/completions")) return input;
    if (input.endsWith("/audio/speech")) return input.replace(/\/audio\/speech$/, "/chat/completions");
    return `${input.replace(/\/$/, "")}/chat/completions`;
  }
}

export async function testTtsModel(request: AiTtsRequest): Promise<AiTtsResult> {
  const httpFallback = async (): Promise<AiTtsResult> => {
    const ttsEndpoint = resolveTtsEndpoint(request.endpoint);
    const response = await fetch(backendUrl("/backend/ai/tts"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: ttsEndpoint,
        apiKey: request.apiKey || "",
        model: request.model,
        input: request.input,
        voice: request.voice,
        format: request.format,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText || `TTS 请求失败，HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(errorText) as {
          error?: { message?: string };
          message?: string;
        };
        errorMessage = parsed.error?.message || parsed.message || errorMessage;
      } catch {
        // 保持原始错误文本。
      }
      return {
        ok: false,
        status: response.status,
        error: errorMessage,
      };
    }

    const audioBlob = await response.blob();
    return {
      ok: true,
      status: response.status,
      audioBlob,
    };
  };

  if (!isTauriEnv()) {
    return httpFallback();
  }

  try {
    const ttsEndpoint = resolveTtsEndpoint(request.endpoint);
    const result = await tauriInvoke<{ ok: boolean; mime?: string; data?: string; error?: string; status?: number }>(
      "ai_tts",
      {
        endpoint: ttsEndpoint,
        apiKey: request.apiKey || null,
        body: {
          model: request.model,
          input: request.input,
          voice: request.voice,
          format: request.format,
        },
      },
    );

    if (!result.ok) {
      return { ok: false, status: result.status || 0, error: result.error || "TTS 请求失败" };
    }

    const byteString = atob(result.data || "");
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const audioBlob = new Blob([ab], { type: result.mime || "audio/mpeg" });
    return { ok: true, status: 200, audioBlob };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知网络错误";
    return {
      ok: false,
      status: 0,
      error: `${errorMessage}\n请检查 TTS 接口地址与网络连通性。`,
    };
  }
}
