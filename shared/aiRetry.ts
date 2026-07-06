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

export function isRateLimitAiError(input: {
  status?: number;
  error?: string;
  rawText?: string;
}): boolean {
  if (input.status === 429) return true;
  const haystack = `${input.error || ""} ${input.rawText || ""}`.toLowerCase();
  return /too many requests|rate.?limit/.test(haystack);
}

export function retryDelayForAttempt(attempt: number, rateLimited = false): number {
  if (rateLimited) {
    return Math.min(90_000, 5000 * 2 ** (attempt - 1));
  }
  return Math.min(30_000, 2000 * 2 ** (attempt - 1));
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
