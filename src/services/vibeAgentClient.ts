import { isTauriEnv, runAgentChannel, WEB_REQUIRES_TAURI_MESSAGE } from "./tauriInvoke";
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

  onEvent({ type: "error", data: { message: WEB_REQUIRES_TAURI_MESSAGE } });
  onEvent({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
  return { abort: () => {} };
}
