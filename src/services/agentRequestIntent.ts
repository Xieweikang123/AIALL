import {
  classifyUserIntentFromRules,
  resolveUserIntent,
  shouldSkipAiIntentClassifier,
} from "./intentClassifierRules";
import { formatIntentClassificationDetail } from "./intentClassifierAi";
import { buildIntentClassifierUserMessage } from "./intentClassifierAi";
import { classifyUserIntentWithAiClient, type IntentClassifierStage } from "./agentIntentClassifierClient";
import type { ResolvedUserIntent } from "./intentClassifierTypes";
import type { UserIntentHistoryMessage } from "../orchestration/agentIntentTypes";
import type { VibeChatMode } from "../../shared/agentTypes";
import { debugLog } from "../utils/debugLog";

export type ResolveAgentIntentStatusPhase = "classifying_intent" | "intent_classified";

export interface IntentClassifierTrace {
  prompt: string;
  skippedAi: boolean;
  ruleResult?: string;
  aiMessages?: Array<{ role: string; content: string }>;
  aiRawResponse?: string;
  finalResult?: string;
  aiModel?: string;
  elapsedMs?: number;
  aiPrimary?: string;
  /** AI classifier invoked but produced no payload (timeout / parse / empty). */
  aiFailed?: boolean;
  aiError?: string;
  /** Classifier stage while intent is being classified (sending/parsing/retrying). */
  aiStage?: IntentClassifierStage;
}

function summarizeRulesIntent(intent: ResolvedUserIntent): string {
  const flags = [
    intent.primary,
    intent.uiDefect ? "uiDefect" : "",
    intent.consultativeTopic && intent.consultativeTopic !== "none"
      ? `topic=${intent.consultativeTopic}`
      : "",
    intent.implementFollowUp ? "implementFollowUp" : "",
    intent.ultraShortOpenTask ? "ultraShortOpenTask" : "",
    intent.needsClarification ? "needsClarification" : "",
  ]
    .filter(Boolean)
    .join("|");
  return flags || "neutral";
}

export function resolveAgentRequestUserIntent(input: {
  prompt: string;
  history?: UserIntentHistoryMessage[];
  mode: VibeChatMode;
  hasImage: boolean;
}): ResolvedUserIntent {
  const isReadOnlyAgent = input.mode === "ask" || input.mode === "explore";
  return classifyUserIntentFromRules({
    prompt: input.prompt,
    history: input.history,
    mode: input.mode,
    hasImage: input.hasImage,
    isAsk: isReadOnlyAgent,
  });
}

/** Tauri desktop: merge AI classifier with rules. Browser preview has no Agent backend. */
export async function resolveAgentRequestUserIntentAsync(
  input: {
    prompt: string;
    history?: UserIntentHistoryMessage[];
    mode: VibeChatMode;
    hasImage: boolean;
    endpoint: string;
    apiKey?: string;
    model: string;
    projectPath?: string;
    signal?: AbortSignal;
  },
  onStatus?: (
    phase: ResolveAgentIntentStatusPhase,
    detail?: string,
    trace?: IntentClassifierTrace,
  ) => void,
): Promise<ResolvedUserIntent> {
  const isReadOnlyAgent = input.mode === "ask" || input.mode === "explore";
  const baseInput = {
    prompt: input.prompt,
    history: input.history,
    mode: input.mode,
    hasImage: input.hasImage,
    isAsk: isReadOnlyAgent,
  };
  const rulesIntent = classifyUserIntentFromRules(baseInput);
  const rulesTrace = summarizeRulesIntent(rulesIntent);

  // web（服务器）模式同样走 AI 分类：agent-server 已提供 /backend/ai/test 流式通道，
  // 分类失败会回落到 rulesIntent（见下方 aiResult==null 分支），无需在此短路。
  const skipAiClassifier = shouldSkipAiIntentClassifier(rulesIntent, input.prompt, {
    isAsk: isReadOnlyAgent,
    mode: input.mode,
  });
  onStatus?.(
    "classifying_intent",
    skipAiClassifier ? "规则高置信，跳过 AI 分类" : "正在识别用户意图…",
    {
      prompt: input.prompt,
      skippedAi: skipAiClassifier,
      ruleResult: rulesTrace,
    },
  );

  const classifyStartedAt = performance.now();
  let aiResult: Awaited<ReturnType<typeof classifyUserIntentWithAiClient>> | null = null;
  try {
    aiResult = skipAiClassifier
      ? null
      : await classifyUserIntentWithAiClient({
          prompt: input.prompt,
          history: input.history,
          mode: input.mode,
          hasImage: input.hasImage,
          endpoint: input.endpoint,
          apiKey: input.apiKey,
          model: input.model,
          projectRoot: input.projectPath,
          signal: input.signal,
          onStage: (stage) => {
            const detail =
              stage === "sending"
                ? "正在分析用户意图…"
                : stage === "parsing"
                  ? "已收到响应，正在解析…"
                  : "分类失败，正在重试…";
            onStatus?.("classifying_intent", detail, {
              prompt: input.prompt,
              skippedAi: skipAiClassifier,
              ruleResult: rulesTrace,
              aiStage: stage,
          });
        },
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    aiResult = { payload: null, error: `分类器异常：${message}` };
    debugLog("[intent-classifier] classify threw:", error);
  }
  const classifyElapsedMs = Math.round(performance.now() - classifyStartedAt);
  const aiPayload = aiResult?.payload ?? null;
  const aiFailed = !skipAiClassifier && aiResult !== null && aiPayload === null;

  const resolved = resolveUserIntent({
    ...baseInput,
    ai: aiPayload,
  });
  if (skipAiClassifier) {
    resolved.skippedAiClassifier = true;
  }
  const detail = formatIntentClassificationDetail(resolved);
  onStatus?.("intent_classified", detail, {
    prompt: input.prompt,
    skippedAi: skipAiClassifier,
    ruleResult: rulesTrace,
    aiMessages: aiResult?.messages,
    aiRawResponse: aiResult?.rawResponse,
    finalResult: detail,
    aiModel: skipAiClassifier ? undefined : input.model,
    elapsedMs: classifyElapsedMs,
    aiPrimary: aiPayload?.primary,
    aiFailed,
    aiError: aiResult?.error,
  });
  return resolved;
}
