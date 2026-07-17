import fs from "node:fs";
import path from "node:path";
import {
  buildIntentCacheKey,
  buildIntentClassifierSystemPrompt,
  buildIntentClassifierUserMessage,
  parseIntentClassifierResponse,
  resolveIntentClassifierModel,
  shouldUseAiIntentClassifier,
} from "../src/services/intentClassifierAi";
import type { UserIntentAiPayload } from "../src/services/intentClassifierTypes";
import type { UserIntentHistoryMessage } from "../src/orchestration/agentIntentTypes";
import { chatCompletionWithTools } from "./aiForward";

const INTENT_CLASSIFIER_FIRST_BYTE_MS = 20_000;
const INTENT_CLASSIFIER_MAX_RETRIES = 1;
const INTENT_CACHE_TTL_MS = 60_000;

const intentCache = new Map<string, { builtAt: number; payload: UserIntentAiPayload }>();

function appendIntentClassifierDebug(message: string): void {
  try {
    const dir = path.join(process.cwd(), ".debug");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "debug.log"),
      `[${new Date().toISOString()}] [intent-classifier] ${message}\n`,
    );
  } catch {
    // ignore
  }
}

export interface ClassifyUserIntentWithAiParams {
  prompt: string;
  history?: UserIntentHistoryMessage[];
  mode: "ask" | "build" | "plan" | "explore";
  hasImage: boolean;
  endpoint: string;
  apiKey?: string;
  model: string;
  projectRoot?: string;
  skip?: boolean;
  signal?: AbortSignal;
}

export async function classifyUserIntentWithAi(
  params: ClassifyUserIntentWithAiParams,
): Promise<UserIntentAiPayload | null> {
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
    return cached.payload;
  }

  const classifierModel = resolveIntentClassifierModel(params.model);
  const result = await chatCompletionWithTools({
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    model: classifierModel,
    messages: [
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
    ],
    tools: [],
    signal: params.signal,
    maxRetries: INTENT_CLASSIFIER_MAX_RETRIES,
    firstByteTimeoutMs: INTENT_CLASSIFIER_FIRST_BYTE_MS,
  });

  if (!result.ok || !result.message?.content) {
    appendIntentClassifierDebug(
      `AI failed: ${result.error || "empty"} model=${classifierModel} prompt=${text.slice(0, 60)}`,
    );
    return null;
  }

  const content = typeof result.message.content === "string" ? result.message.content : "";
  const payload = parseIntentClassifierResponse(content);
  if (!payload) {
    appendIntentClassifierDebug(`parse failed model=${classifierModel} raw=${content.slice(0, 120)}`);
    return null;
  }

  intentCache.set(cacheKey, { builtAt: Date.now(), payload });
  return payload;
}

export function clearIntentClassifierCacheForTests(): void {
  intentCache.clear();
}
