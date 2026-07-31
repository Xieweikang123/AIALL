import {
  classifyUserIntentFromRules,
  resolveUserIntent,
  shouldSkipAiIntentClassifier,
} from "./intentClassifierRules";
import { formatIntentClassificationDetail } from "./intentClassifierAi";
import { classifyUserIntentWithAiClient } from "./agentIntentClassifierClient";
import type { ResolvedUserIntent } from "./intentClassifierTypes";
import type { UserIntentHistoryMessage } from "../orchestration/agentIntentTypes";
import type { VibeChatMode } from "../../shared/agentTypes";
import { isTauriEnv } from "./tauriInvoke";

export type ResolveAgentIntentStatusPhase = "classifying_intent" | "intent_classified";

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
  onStatus?: (phase: ResolveAgentIntentStatusPhase, detail?: string) => void,
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

  if (!isTauriEnv()) {
    return rulesIntent;
  }

  const skipAiClassifier = shouldSkipAiIntentClassifier(rulesIntent, input.prompt, {
    isAsk: isReadOnlyAgent,
    mode: input.mode,
  });
  onStatus?.(
    "classifying_intent",
    skipAiClassifier ? "规则高置信，跳过 AI 分类" : "正在识别用户意图…",
  );

  const aiPayload = skipAiClassifier
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
      });

  const resolved = resolveUserIntent({
    ...baseInput,
    ai: aiPayload,
  });
  if (skipAiClassifier) {
    resolved.skippedAiClassifier = true;
  }
  onStatus?.("intent_classified", formatIntentClassificationDetail(resolved));
  return resolved;
}
