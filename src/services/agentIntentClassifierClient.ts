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

const INTENT_CLASSIFIER_FIRST_BYTE_MS = 20_000;
const INTENT_CLASSIFIER_MAX_RETRIES = 1;
const INTENT_CACHE_TTL_MS = 60_000;

const intentCache = new Map<string, { builtAt: number; payload: UserIntentAiPayload }>();

function withFirstByteTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        resolve(onTimeout());
      } catch (error) {
        reject(error);
      }
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface ClassifyUserIntentWithAiClientResult {
  payload: UserIntentAiPayload | null;
  rawResponse?: string;
  messages?: Array<{ role: string; content: string }>;
  classifierModel?: string;
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

async function chatCompletionOnce(params: {
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
    stream: false,
    temperature: 0,
  };

  if (isTauriEnv()) {
    try {
      const result = await withFirstByteTimeout(
        tauriInvoke<{ ok: boolean; data?: unknown; error?: string }>("ai_test", {
          endpoint: params.endpoint,
          apiKey: params.apiKey || null,
          body,
        }),
        INTENT_CLASSIFIER_FIRST_BYTE_MS,
        () => ({ ok: false, error: `AI 分类请求超时（${INTENT_CLASSIFIER_FIRST_BYTE_MS / 1000}s）` }),
      );
      if (!result.ok) {
        return { ok: false, error: result.error || "AI 分类失败" };
      }
      const data = result.data as { choices?: Array<{ message?: { content?: string } }> } | undefined;
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim()
        ? { ok: true, content }
        : { ok: false, error: "模型返回为空" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }

  return { ok: false, error: "非 Tauri 环境" };
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
    const result = await chatCompletionOnce({
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

  void lastError;
  return null;
}

export function clearIntentClassifierClientCacheForTests(): void {
  intentCache.clear();
}
