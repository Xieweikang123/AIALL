import { describe, it, expect } from "vitest";
import {
  contextRingDashOffset,
  ringCircumference,
  TOKEN_RING_STROKE,
  TOKEN_RING_VIEWBOX,
} from "./tokenRing";

describe("tokenRing", () => {
  it("圆周长按 2πr 计算", () => {
    expect(ringCircumference(15)).toBeCloseTo(94.2477, 3);
    expect(ringCircumference(0)).toBe(0);
  });

  it("占用 0 时整圈不可见（offset = 周长）", () => {
    const r = 15;
    expect(contextRingDashOffset(0, r)).toBeCloseTo(ringCircumference(r), 6);
  });

  it("占用 100% 时整圈可见（offset = 0）", () => {
    expect(contextRingDashOffset(1, 15)).toBeCloseTo(0, 6);
  });

  it("占用 50% 时偏移为半周长", () => {
    expect(contextRingDashOffset(0.5, 15)).toBeCloseTo(ringCircumference(15) / 2, 6);
  });

  it("越界比例被夹到 [0, 1]", () => {
    expect(contextRingDashOffset(1.5, 15)).toBeCloseTo(0, 6);
    expect(contextRingDashOffset(-0.2, 15)).toBeCloseTo(ringCircumference(15), 6);
  });

  it("非有限数按 0 比例处理（空环）", () => {
    expect(contextRingDashOffset(Number.NaN, 15)).toBeCloseTo(ringCircumference(15), 6);
    expect(contextRingDashOffset(Number.POSITIVE_INFINITY, 15)).toBeCloseTo(ringCircumference(15), 6);
  });

  it("几何常量自洽：半径 + 描边不超出 viewBox", () => {
    // 半径 15 + 半描边 1.5 = 16.5 < 18（viewBox 半边），圆环不会被裁。
    expect(15 + TOKEN_RING_STROKE / 2).toBeLessThan(TOKEN_RING_VIEWBOX / 2);
  });
});
