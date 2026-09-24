/**
 * Resolve a model's real context window (in tokens).
 *
 * Priority:
 *   1. Value reported by the provider's OpenAI-compatible `/models` response.
 *   2. Static prefix table for providers that don't report it.
 *   3. A conservative fallback.
 *
 * Values are token counts, not characters — the provider `usage.prompt_tokens`
 * it is compared against is also tokens.
 */

export const FALLBACK_CONTEXT_TOKENS = 128_000;

/** Longest-prefix-first matching against the normalized (lowercased) model id. */
const STATIC_CONTEXT_WINDOWS: Array<[prefix: string, tokens: number]> = [
  // Anthropic
  ["claude-3-7", 200_000],
  ["claude-3-5", 200_000],
  ["claude-3", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-opus-4", 200_000],
  // OpenAI
  ["gpt-4.1", 1_000_000],
  ["gpt-4o-mini", 128_000],
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-4", 8_192],
  ["gpt-3.5", 16_385],
  ["o1", 200_000],
  ["o3", 200_000],
  ["o4", 200_000],
  // DeepSeek
  ["deepseek-reasoner", 64_000],
  ["deepseek-chat", 64_000],
  ["deepseek", 64_000],
  // Google
  ["gemini-1.5-pro", 2_000_000],
  ["gemini-1.5", 1_000_000],
  ["gemini-2", 1_000_000],
  ["gemini", 1_000_000],
  // Qwen / Moonshot / GLM / Yi / Llama / Mistral
  ["qwen", 128_000],
  ["moonshot", 128_000],
  ["kimi", 128_000],
  ["glm-4", 128_000],
  ["glm", 128_000],
  ["yi-", 200_000],
  ["llama-3.3", 128_000],
  ["llama-3.1", 128_000],
  ["llama3", 8_192],
  ["mistral", 32_000],
  ["mixtral", 32_000],
  ["mimo", 256_000],
];

/** Normalize a model id: lowercase, strip a leading `provider/` routing prefix. */
function normalizeModelId(model: string): string {
  const lower = model.trim().toLowerCase();
  const slash = lower.lastIndexOf("/");
  return slash >= 0 ? lower.slice(slash + 1) : lower;
}

export function staticContextWindowForModel(model: string): number | undefined {
  const id = normalizeModelId(model);
  if (!id) return undefined;
  for (const [prefix, tokens] of STATIC_CONTEXT_WINDOWS) {
    if (id.startsWith(prefix)) return tokens;
  }
  return undefined;
}

/**
 * Resolve the effective context window for a model.
 *
 * Priority:
 *   1. `override` — user-typed value (manual truth, beats everything).
 *   2. `reported` — value from the provider's `/models` response.
 *   3. Static prefix table.
 *   4. Conservative fallback.
 */
export function resolveContextWindowTokens(
  model: string,
  reported?: number | undefined,
  override?: number | undefined,
): { tokens: number; source: "override" | "reported" | "static" | "fallback" } {
  if (override && override > 0) {
    return { tokens: override, source: "override" };
  }
  if (reported && reported > 0) {
    return { tokens: reported, source: "reported" };
  }
  const stat = staticContextWindowForModel(model);
  if (stat && stat > 0) {
    return { tokens: stat, source: "static" };
  }
  return { tokens: FALLBACK_CONTEXT_TOKENS, source: "fallback" };
}

/**
 * Parse a user-typed context window. Accepts plain digits plus `k`/`m`
 * shorthand (e.g. `1000000`, `1m`, `128k`, `128_000`). Returns undefined when
 * the input is empty or not a positive number.
 */
export function parseContextWindowInput(raw: string): number | undefined {
  const text = String(raw ?? "").trim().toLowerCase().replace(/[,_\s]/g, "");
  if (!text) return undefined;
  const match = text.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return undefined;
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const value = Math.round(base * multiplier);
  return value > 0 ? value : undefined;
}
