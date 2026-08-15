import type { UserIntentHistoryMessage } from "../orchestration/agentIntentTypes";
import type { UserIntentAiPayload } from "./intentClassifierTypes";
import {
  buildIntentCacheKey,
  buildIntentClassifierSystemPrompt,
  buildIntentClassifierUserMessage,
  parseIntentClassifierResponse,
  resolveIntentClassifierModel,
  shouldUseAiIntentClassifier,
} from "./intentClassifierAi";
import { isTauriEnv, tauriInvoke } from "./tauriInvoke";
import { Channel } from "@tauri-apps/api/core";
import { streamChatHttp } from "./aiClient";

const INTENT_CLASSIFIER_FIRST_BYTE_MS = 60_000;
const INTENT_CLASSIFIER_TOTAL_TIMEOUT_MS = 90_000;
const INTENT_CLASSIFIER_MAX_RETRIES = 1;
const INTENT_CACHE_TTL_MS = 60_000;

const intentCache = new Map<string, { builtAt: number; payload: UserIntentAiPayload }>();

export interface ClassifyUserIntentWithAiClientResult {
  payload: UserIntentAiPayload | null;
  rawResponse?: string;
  messages?: Array<{ role: string; content: string }>;
  classifierModel?: string;
  /** Set when the classifier was invoked but produced no usable payload. */
  error?: string;
}

export type IntentClassifierStage = "sending" | "parsing" | "retrying";

export interface ClassifyUserIntentWithAiClientParams {
  prompt: string;
  history?: UserIntentHistoryMessage[];
  mode: "ask" | "build" | "plan" | "explore" | "auto";
  hasImage: boolean;
  endpoint: string;
  apiKey?: string;
  model: string;
  projectRoot?: string;
  skip?: boolean;
  signal?: AbortSignal;
  onStage?: (stage: IntentClassifierStage) => void;
}

async function chatCompletionStreamOnce(params: {
  endpoint: string;
  apiKey?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; content?: string; error?: string }> {
  if (params.signal?.aborted) {
    return { ok: false, error: "已取消" };
  }

  const body = {
    model: params.model,
    messages: params.messages,
    stream: true,
    temperature: 0,
  };

  if (isTauriEnv()) {
    return new Promise((resolve) => {
      let firstByteReceived = false;
      let settled = false;
      const settle = (value: { ok: boolean; content?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(firstByteTimer);
        clearTimeout(totalTimer);
        resolve(value);
      };
      const firstByteTimer = setTimeout(() => {
        settle({
          ok: false,
          error: `AI 分类请求超时（${INTENT_CLASSIFIER_FIRST_BYTE_MS / 1000}s 内无响应）`,
        });
      }, INTENT_CLASSIFIER_FIRST_BYTE_MS);
      const totalTimer = setTimeout(() => {
        settle({
          ok: false,
          error: `AI 分类请求超时（${INTENT_CLASSIFIER_TOTAL_TIMEOUT_MS / 1000}s 未完成）`,
        });
      }, INTENT_CLASSIFIER_TOTAL_TIMEOUT_MS);

      const channel = new Channel<string>();
      channel.onmessage = () => {
        if (!firstByteReceived) {
          firstByteReceived = true;
          clearTimeout(firstByteTimer);
        }
      };

      tauriInvoke<{ ok: boolean; status?: number; rawText?: string; error?: string }>(
        "ai_test_stream",
        {
          endpoint: params.endpoint,
          apiKey: params.apiKey || null,
          body,
          onChunk: channel,
        },
      )
        .then((result) => {
          if (!result.ok) {
            settle({ ok: false, error: result.error || "AI 分类失败" });
            return;
          }
          const content = result.rawText?.trim();
          settle(content ? { ok: true, content } : { ok: false, error: "模型返回为空" });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          settle({ ok: false, error: message });
        });
    });
  }

  // Web（服务器）模式：走 /backend/ai/test（服务端注入 key）。
  const result = await streamChatHttp({
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    model: params.model,
    messages: params.messages,
    signal: params.signal,
  });
  return { ok: result.ok, content: result.rawText, error: result.error };
}

export async function classifyUserIntentWithAiClient(
  params: ClassifyUserIntentWithAiClientParams,
): Promise<ClassifyUserIntentWithAiClientResult | null> {
  if (params.skip || !shouldUseAiIntentClassifier()) return null;
  const text = params.prompt.trim();
  if (!text) return null;

  const cacheKey = buildIntentCacheKey({
    projectRoot: params.projectRoot,
    prompt: params.prompt,
    mode: params.mode,
    history: params.history,
  });
  const cached = intentCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < INTENT_CACHE_TTL_MS) {
    return { payload: cached.payload };
  }

  const classifierModel = resolveIntentClassifierModel(params.model);
  const messages = [
    { role: "system", content: buildIntentClassifierSystemPrompt() },
    {
      role: "user",
      content: buildIntentClassifierUserMessage({
        prompt: params.prompt,
        history: params.history,
        mode: params.mode,
        hasImage: params.hasImage,
      }),
    },
  ];

  let lastError = "AI 分类失败";
  for (let attempt = 0; attempt <= INTENT_CLASSIFIER_MAX_RETRIES; attempt += 1) {
    if (params.signal?.aborted) return null;
    if (attempt > 0) params.onStage?.("retrying");
    params.onStage?.("sending");
    const result = await chatCompletionStreamOnce({
      endpoint: params.endpoint,
      apiKey: params.apiKey,
      model: classifierModel,
      messages,
      signal: params.signal,
    });
    if (!result.ok || !result.content) {
      lastError = result.error || lastError;
      continue;
    }
    params.onStage?.("parsing");
    const payload = parseIntentClassifierResponse(result.content);
    if (!payload) {
      lastError = "parse failed";
      continue;
    }
    intentCache.set(cacheKey, { builtAt: Date.now(), payload });
    return { payload, rawResponse: result.content, messages, classifierModel };
  }

  return { payload: null, error: lastError };
}

export function clearIntentClassifierClientCacheForTests(): void {
  intentCache.clear();
}
