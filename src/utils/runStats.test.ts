import { describe, it, expect } from "vitest";
import {
  collectOutputSpeed,
  computeOutputTokensPerSecond,
  formatMs,
  formatSpeed,
  MIN_SPEED_WINDOW_MS,
} from "./runStats";

describe("computeOutputTokensPerSecond", () => {
  it("token / ms × 1000 = token/s", () => {
    // 2000 token over 20000ms → 100 token/s
    expect(computeOutputTokensPerSecond(2000, 20000)).toBeCloseTo(100, 6);
  });

  it("缺 token 或缺窗口 → undefined", () => {
    expect(computeOutputTokensPerSecond(undefined, 20000)).toBeUndefined();
    expect(computeOutputTokensPerSecond(2000, undefined)).toBeUndefined();
    expect(computeOutputTokensPerSecond(0, 20000)).toBeUndefined();
    expect(computeOutputTokensPerSecond(2000, 0)).toBeUndefined();
  });

  it("窗口过短（< MIN_SPEED_WINDOW_MS）不给出被放大的速度", () => {
    expect(computeOutputTokensPerSecond(5, MIN_SPEED_WINDOW_MS - 1)).toBeUndefined();
  });

  it("窗口刚好达阈值即可计算", () => {
    expect(computeOutputTokensPerSecond(5, MIN_SPEED_WINDOW_MS)).toBeCloseTo(
      (5 / MIN_SPEED_WINDOW_MS) * 1000,
      6,
    );
  });
});

describe("collectOutputSpeed", () => {
  it("只对同时有 token 与解码窗口的轮次配对，未配对轮次两边都不计", () => {
    // Turn A: both present (correct pair). Turn B: token only (no window).
    // Naive `sum(token)/sum(window)` would use 3000+5000 tokens over 2000ms → 4000 tok/s.
    const s = collectOutputSpeed([
      { completionTokens: 3000, genMs: 2000 },
      { completionTokens: 5000, genMs: undefined },
    ]);
    expect(s.tokensPerSecond).toBeCloseTo(1500, 6);
    expect(s.pairedTurns).toBe(1);
    expect(s.tokenTurns).toBe(2);
  });

  it("完全没有配对样本 → 不给速度（宁缺勿错）", () => {
    const s = collectOutputSpeed([
      { completionTokens: 3000, genMs: undefined },
      { completionTokens: 1000, genMs: 0 },
    ]);
    expect(s.tokensPerSecond).toBeUndefined();
    expect(s.pairedTurns).toBe(0);
    expect(s.tokenTurns).toBe(2);
  });

  it("多轮配对样本累加后再相除，覆盖度如实上报", () => {
    const s = collectOutputSpeed([
      { completionTokens: 1000, genMs: 1000 },
      { completionTokens: 3000, genMs: 1000 },
      { completionTokens: 9999, genMs: undefined },
    ]);
    expect(s.tokensPerSecond).toBeCloseTo(2000, 6);
    expect(s.pairedTurns).toBe(2);
    expect(s.tokenTurns).toBe(3);
    expect(s.pairedGenMs).toBe(2000);
  });
});

describe("formatSpeed", () => {
  it("≥100 取整，否则保留一位小数", () => {
    expect(formatSpeed(128.4)).toBe("128");
    expect(formatSpeed(42.34)).toBe("42.3");
    expect(formatSpeed(9.96)).toBe("10.0");
  });

  it("无数据 / 非法值显示占位符", () => {
    expect(formatSpeed(undefined)).toBe("—");
    expect(formatSpeed(0)).toBe("—");
    expect(formatSpeed(Number.NaN)).toBe("—");
  });
});

describe("formatMs", () => {
  it("≥1s 转秒，否则毫秒", () => {
    expect(formatMs(820)).toBe("820ms");
    expect(formatMs(1234)).toBe("1.2s");
    expect(formatMs(60000)).toBe("60.0s");
  });

  it("无数据 / 负数显示占位符", () => {
    expect(formatMs(undefined)).toBe("—");
    expect(formatMs(-1)).toBe("—");
  });
});
