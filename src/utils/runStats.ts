/**
 * 模型输出速度换算。
 *
 * 口径：`completionTokens / genMs`，其中 `genMs` 是 Rust 流式层测的**解码窗口**
 * （首个输出 delta → 流结束），不含首字延迟与重试等待。所以这是真正的生成速度，
 * 而不是"整轮墙钟 / token"那种被各种等待拖低的近似值。
 *
 * 注意分子分母都必须是**同一次测量**（同一轮才有配对的 token 与窗口）。跨轮把
 * 「全部 token」除以「部分轮的窗口」会把速度放大十几倍，配对逻辑见 `collectOutputSpeed`。
 *
 * 单位换算：token/ms × 1000 = token/s。
 */

/** 窗口小于此值（ms）时不足以算速度 —— 一两个 token 的间隔会把速度放大到没意义。 */
export const MIN_SPEED_WINDOW_MS = 50;

export function computeOutputTokensPerSecond(
  tokens: number | undefined,
  genMs: number | undefined,
): number | undefined {
  if (!tokens || tokens <= 0) return undefined;
  if (!genMs || genMs < MIN_SPEED_WINDOW_MS) return undefined;
  const tps = (tokens / genMs) * 1000;
  return Number.isFinite(tps) && tps > 0 ? tps : undefined;
}

/** 速度展示：≥100 取整，否则保留一位小数（如 `42.3` / `128`）。 */
export function formatSpeed(tps: number | undefined): string {
  if (tps === undefined || !Number.isFinite(tps) || tps <= 0) return "—";
  return tps >= 100 ? String(Math.round(tps)) : tps.toFixed(1);
}

/** 毫秒展示：≥1s 转秒（保留一位，如 `1.2s`），否则 `820ms`。 */
export function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** 速度探针字段：单个 assistant 消息上累计的 token 与解码窗口。 */
export interface OutputSpeedProbe {
  completionTokens?: number;
  genMs?: number;
}

/** 会话级输出速度样本：只有 token 与解码窗口**同时存在**的运行才计入配对。 */
export interface OutputSpeedSummary {
  /** 配对样本算出的速度（token/s）；无配对样本时 undefined。 */
  tokensPerSecond?: number;
  /** 参与配对的样本数（分子分母同源）。 */
  pairedTurns: number;
  /** 上报了 completionTokens 的样本数（含未配对的，用于提示覆盖度）。 */
  tokenTurns: number;
  /** 配对样本的解码窗口之和（ms）。 */
  pairedGenMs: number;
}

/**
 * 汇总会话级输出速度样本。
 *
 * 每个样本是一条 assistant 消息（一次 Agent 运行，内部已把各轮 token / 窗口累加）。
 * 关键：**只对同时上报了 token 与解码窗口的样本求和**再相除。曾经的实现把
 * 「所有样本的 token」除以「只有部分样本有值的 genMs」，分母少算了一大截，速度被
 * 放大十几倍（实测 21.9K 字符的会话能标出 13347 token/s）。
 */
export function collectOutputSpeed(messages: OutputSpeedProbe[]): OutputSpeedSummary {
  let pairedTokens = 0;
  let pairedGenMs = 0;
  let pairedTurns = 0;
  let tokenTurns = 0;
  for (const m of messages) {
    const tokens = m.completionTokens;
    const genMs = m.genMs;
    if (tokens && tokens > 0) tokenTurns += 1;
    // 两个探针必须来自同一次测量；单边缺失的轮次整轮跳过，避免分子分母错位。
    if (!tokens || tokens <= 0) continue;
    if (!genMs || genMs <= 0) continue;
    pairedTokens += tokens;
    pairedGenMs += genMs;
    pairedTurns += 1;
  }
  return {
    tokensPerSecond: computeOutputTokensPerSecond(pairedTokens, pairedGenMs),
    pairedTurns,
    tokenTurns,
    pairedGenMs,
  };
}
