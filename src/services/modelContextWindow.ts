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

/**
 * 内置兜底表：**只是猜**，别当真值。
 *
 * 用法与注意事项：
 *  1. 匹配按**前缀长度从长到短**，所以细粒度条目必须比裸前缀更"长"——
 *     `deepseek-v4.1` 排在 `deepseek` 前面，命中前者拿 1M，命中后者才拿 64K。
 *     顺序由下面的 sort 保证，**新增条目不用自己排**。
 *  2. 裸前缀（`deepseek` / `gpt-4` 这类）只当最后兜底。同一家不同代次的窗口差
 *     着一到两个数量级，让裸前缀兜住新代次等于给新模型报错的大小。
 *  3. 这张表只喂**显示**（面板分母 / 「内置表估算」标签）。Agent 侧不再有对应的
 *     字符预算常量（旧的 `MAX_AGENT_CONTEXT_CHARS` 已删，请求端早就"原样发送、
 *     不压缩"），所以这张表是现在唯一的窗口来源。
 *
 * ⚠️ 已知过期项：`gpt-4o` 实际是 128K，而下面写的是 1M —— 早期按「OpenAI 新模型一律
 * 1M」填的，一直没回头核。宁可填得保守些（界面据此提示"上下文较满"），也不要
 * 填一个偏大的数去骗自己。改这个表时请顺手核一下官方值。
 */
const STATIC_CONTEXT_WINDOWS_RAW: Array<[prefix: string, tokens: number]> = [
  // Anthropic
  ["claude-3-7", 200_000],
  ["claude-3-5", 200_000],
  ["claude-3", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-opus-4", 200_000],
  // OpenAI
  ["gpt-4.1", 1_000_000],
  ["gpt-4o-mini", 128_000],
  // ⚠️ 过期，见上方注释：gpt-4o 官方是 128K
  ["gpt-4o", 1_000_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-4", 8_192],
  ["gpt-3.5", 16_385],
  ["o1", 200_000],
  ["o3", 200_000],
  ["o4", 200_000],
  // DeepSeek
  // ⚠️ 顺序有意义：`deepseek-v4.1` 比裸 `deepseek` 长，先命中拿 1M。
  // 依据 ollama 官方模型页（1M context window）与 vLLM 配方（1,048,576）。
  // 不写"最长优先"排序的话，新加这条一旦排到 `deepseek` 后面就会静默退回 64K。
  ["deepseek-v4.1", 1_000_000],
  ["deepseek-v4", 1_000_000],
  ["deepseek-v3.2", 128_000],
  ["deepseek-v3.1", 128_000],
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

/**
 * 前缀长度降序（长的先试）。
 *
 * 单独一个常量而不是在字面量后面 `.sort()`：`.sort()` 会把元组类型退化成
 * `(string | number)[]`，`a[0].length` 就报 TS2339 了。用显式 map 回元组。
 * 顺便**就地**排一次，模块加载时一次开销，之后查找是 O(n) 线性扫。
 */
const STATIC_CONTEXT_WINDOWS: Array<[prefix: string, tokens: number]> = STATIC_CONTEXT_WINDOWS_RAW
  .map(([prefix, tokens]): [prefix: string, tokens: number] => [prefix, tokens])
  .sort((a, b) => b[0].length - a[0].length);

/** Normalize a model id: lowercase, strip a leading `provider/` routing prefix. */
export function normalizeModelId(model: string): string {
  const lower = model.trim().toLowerCase();
  const slash = lower.lastIndexOf("/");
  return slash >= 0 ? lower.slice(slash + 1) : lower;
}

export function staticContextWindowForModel(model: string): number | undefined {
  const id = normalizeModelId(model);
  if (!id) return undefined;
  // 表已按前缀长度降序排好，这里第一个命中就是最长匹配。
  for (const [prefix, tokens] of STATIC_CONTEXT_WINDOWS) {
    if (id.startsWith(prefix)) return tokens;
  }
  return undefined;
}

/**
 * 从「provider 报告的窗口表」里取某个模型的值。
 *
 * 表的 key 是 `/models` 返回的**原始 id**，用户手上填的可能是 `openai/gpt-4o`
 * 这种带路由前缀的，也可能大小写不同。必须按 `normalizeModelId` 归一化后再比 ——
 * 和 `resolveContextWindowTokens` 内部静态表用的是同一套规则，两边不一致会出现
 * 「明明抓到了，界面上却还是回退到内置表」这种查到了却不生效的情况。
 *
 * 顺序：精确命中优先（避免归一化把两个不同模型误并成一个），再退回归一化匹配。
 */
export function lookupReportedModelWindow(
  windows: Record<string, number> | undefined,
  model: string,
): number | undefined {
  if (!windows || !model.trim()) return undefined;
  const direct = windows[model.trim()];
  if (typeof direct === "number" && direct > 0) return direct;
  const target = normalizeModelId(model);
  for (const [key, value] of Object.entries(windows)) {
    if (typeof value === "number" && value > 0 && normalizeModelId(key) === target) {
      return value;
    }
  }
  return undefined;
}

/**
 * 从 provider 的**报错原文**里把真实上下文窗口抠出来。
 *
 * 为什么需要这条：官方接口（DeepSeek / OpenAI 等）的 `/models` 一般**不返回**
 * `context_length`，所以"点获取"那条路对它们无效（内置表只能猜，还常常猜错代际）。
 * 但一旦真的把上下文撑爆，provider 的报错里通常会**直接写出自己的上限**，例如：
 *
 *   OpenAI / DeepSeek / 多数中转：
 *     "This model's maximum context length is 128000 tokens. However, your
 *      messages resulted in 132041 tokens."
 *   Anthropic 风格：
 *     "prompt is too long: 210000 tokens > 200000 maximum"
 *
 * 报错原文会一路透传到前端（Rust 侧 `ai/forward.rs` 把 response body 拼进错误信息，
 * 再以 SSE `error` 事件下发），所以这是官方接口下唯一能拿到**真值**的途径 ——
 * 而且它只在真正超窗时触发，那恰好是最需要知道数字的时刻。
 *
 * 解析不出来就返回 undefined，调用方保持原样，不猜。
 */
const CONTEXT_WINDOW_FROM_ERROR_PATTERNS: RegExp[] = [
  // "maximum context length is 128000" / "maximum context length of 128000"
  /maximum\s+context\s+length\s+(?:is|of)\s+([\d][\d,]*)/i,
  // "max context length exceeded (limit 200000)" / "context length of 200000"
  /(?:max(?:imum)?\s+)?context\s+length[^0-9]{0,24}([\d][\d,]*)/i,
  // Anthropic 风格："210000 tokens > 200000 maximum"
  // 注意限制值是**第二个**数（第一个是实际请求量），所以统一取最后一个捕获组。
  /([\d][\d,]*)\s*tokens?\s*(?:>|greater\s+than|exceeds?)\s*([\d][\d,]*)\s*maximum/i,
];

export function parseContextWindowFromError(text: string): number | undefined {
  if (!text) return undefined;
  for (const re of CONTEXT_WINDOW_FROM_ERROR_PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    // 取最后一个非空捕获组：单捕获组的正则就是它自己；双捕获组（Anthropic 风格）
    // 才是第二个。写成 `match[match.length - 1]` 才能同时覆盖两种形状。
    const raw = match[match.length - 1];
    const value = Number(String(raw).replace(/[,_]/g, ""));
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return undefined;
}

/**
 * Resolve the effective context window for a model.
 *
 * Priority:
 *   1. `override` — user-typed value (manual truth, beats everything).
 *   2. `reported` — value from the provider's `/models` response, or a value
 *      learned from a context-overflow error (see `parseContextWindowFromError`).
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
