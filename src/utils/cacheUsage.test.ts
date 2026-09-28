import { describe, it, expect } from "vitest";
import { aggregateCacheUsage } from "./cacheUsage";

describe("aggregateCacheUsage", () => {
  it("OpenAI/DeepSeek 口径：promptTokens 是总输入，命中率 = 命中 / 输入", () => {
    const r = aggregateCacheUsage([
      { promptTokens: 1000, cachedTokens: 900 },
      { promptTokens: 2000, cachedTokens: 1800 },
    ]);
    expect(r.inputTokens).toBe(3000);
    expect(r.hitTokens).toBe(2700);
    expect(r.hitRatio).toBeCloseTo(0.9, 6);
  });

  it("Anthropic 口径：promptTokens 是未命中输入，总输入要加上命中与写缓存", () => {
    const r = aggregateCacheUsage([
      { promptTokens: 300, cacheReadTokens: 200, cacheCreationTokens: 500 },
    ]);
    // 总输入 = 300(未命中) + 200(命中) + 500(写缓存) = 1000
    expect(r.inputTokens).toBe(1000);
    expect(r.hitTokens).toBe(200);
    expect(r.hitRatio).toBeCloseTo(0.2, 6);
  });

  it("多运行累加：命中率与累加后的输入/命中严格对齐", () => {
    const r = aggregateCacheUsage([
      { promptTokens: 1000, cachedTokens: 500 },
      { promptTokens: 1000, cachedTokens: 500 },
    ]);
    expect(r.hitRatio).toBeCloseTo(r.hitTokens / r.inputTokens, 10);
  });

  it("有分母但命中为 0 → 明确的 0%", () => {
    const r = aggregateCacheUsage([{ promptTokens: 1000, cachedTokens: 0 }]);
    expect(r.inputTokens).toBe(1000);
    expect(r.hitTokens).toBe(0);
    expect(r.hitRatio).toBe(0);
  });

  it("没有输入也没有命中 → 无法计算，返回 undefined", () => {
    const r = aggregateCacheUsage([{}]);
    expect(r.inputTokens).toBe(0);
    expect(r.hitTokens).toBe(0);
    expect(r.hitRatio).toBeUndefined();
  });

  it("只有比率、没有命中 token → 沿用最后一次比率", () => {
    const r = aggregateCacheUsage([{ hitRatio: 0.42 }, { promptTokens: 0 }]);
    expect(r.hitRatio).toBeCloseTo(0.42, 6);
  });

  it("忽略空条目与 undefined 字段", () => {
    const r = aggregateCacheUsage([undefined as never, { promptTokens: 100 }, { cachedTokens: 50 }]);
    expect(r.inputTokens).toBe(100);
    expect(r.hitTokens).toBe(50);
  });
});
