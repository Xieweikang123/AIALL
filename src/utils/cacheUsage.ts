/**
 * 缓存用量口径：把「会话内所有运行」的缓存计数换算成一致的整会话累计值。
 *
 * 为什么要抽出来：两种供应商报法不一样，直接用会算错。
 *  - OpenAI / DeepSeek 一类：`promptTokens` 就是**总输入**（含命中部分），
 *    命中率 = 命中 / 总输入。
 *  - Anthropic 一类：`promptTokens` 只是**未命中输入**，总输入 = 未命中 + 命中 +
 *    写缓存；命中率 = 命中 / 总输入。用 `命中 / promptTokens` 会算出 >100%。
 *
 * 之前 UI 直接累加 `promptTokens` 当分母、却取**最后一次运行**的 `hitRatio`，
 * 跨多次运行时「输入 / 命中 / 命中率」三个数互相对不上。这里统一成整会话累计口径。
 */
export type CacheUsageEntry = {
  promptTokens?: number;
  cachedTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  hitRatio?: number;
};

/** 累加后的整会话缓存口径；`inputTokens === 0` 表示供应商没报输入，命中率不可算。 */
export type AggregatedCacheUsage = {
  inputTokens: number;
  hitTokens: number;
  hitRatio?: number;
};

export function aggregateCacheUsage(entries: readonly CacheUsageEntry[]): AggregatedCacheUsage {
  let promptTokens = 0;
  let cachedTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let fallbackRatio: number | undefined;

  for (const e of entries) {
    if (!e) continue;
    promptTokens += e.promptTokens ?? 0;
    cachedTokens += e.cachedTokens ?? 0;
    cacheReadTokens += e.cacheReadTokens ?? 0;
    cacheCreationTokens += e.cacheCreationTokens ?? 0;
    if (e.hitRatio !== undefined) fallbackRatio = e.hitRatio;
  }

  const hitTokens = cachedTokens + cacheReadTokens;
  // Anthropic 风格带了写缓存 → 其 promptTokens 只是未命中，总输入要加上命中与写缓存。
  const inputTokens =
    cacheCreationTokens > 0
      ? promptTokens + hitTokens + cacheCreationTokens
      : promptTokens;

  let hitRatio: number | undefined;
  if (inputTokens > 0 && hitTokens > 0) {
    hitRatio = hitTokens / inputTokens;
  } else if (hitTokens === 0 && fallbackRatio !== undefined) {
    // 没报命中 token 但有比率（例如供应商只给比率）时沿用最后一次的比率。
    hitRatio = fallbackRatio;
  } else if (inputTokens > 0) {
    // 有分母、命中为 0 → 明确的 0%，别显示成"无数据"。
    hitRatio = 0;
  }

  return { inputTokens, hitTokens, hitRatio };
}
