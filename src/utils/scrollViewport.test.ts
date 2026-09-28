import { describe, expect, it, vi } from "vitest";
import {
  computeScrollFollowStep,
  isScrollNearBottom,
  scrollContainerToBottom,
  scrollElementToBottom,
  scrollToMessageWithin,
} from "./scrollViewport";

function mockScrollElement(input: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}): HTMLElement {
  const el = {
    scrollHeight: input.scrollHeight,
    clientHeight: input.clientHeight,
    scrollTop: input.scrollTop,
    scrollTo: vi.fn((opts: ScrollToOptions) => {
      if (typeof opts.top === "number") el.scrollTop = opts.top;
    }),
  } as unknown as HTMLElement;
  return el;
}

describe("isScrollNearBottom", () => {
  it("returns true when within default threshold of bottom", () => {
    const el = mockScrollElement({ scrollHeight: 500, clientHeight: 200, scrollTop: 290 });
    expect(isScrollNearBottom(el)).toBe(true);
  });

  it("returns false when scrolled away from bottom", () => {
    const el = mockScrollElement({ scrollHeight: 500, clientHeight: 200, scrollTop: 100 });
    expect(isScrollNearBottom(el)).toBe(false);
  });

  it("respects custom threshold", () => {
    const el = mockScrollElement({ scrollHeight: 500, clientHeight: 200, scrollTop: 250 });
    expect(isScrollNearBottom(el, 60)).toBe(true);
    expect(isScrollNearBottom(el, 10)).toBe(false);
  });
});

describe("scrollElementToBottom", () => {
  it("scrolls to scrollHeight with given behavior", () => {
    const el = mockScrollElement({ scrollHeight: 880, clientHeight: 200, scrollTop: 0 });
    scrollElementToBottom(el, "smooth");
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 880, behavior: "smooth" });
    expect(el.scrollTop).toBe(880);
  });
});

describe("scrollContainerToBottom", () => {
  it("sets scrollTop to scrollHeight", () => {
    const el = mockScrollElement({ scrollHeight: 1200, clientHeight: 400, scrollTop: 0 });
    scrollContainerToBottom(el);
    expect(el.scrollTop).toBe(1200);
  });
});

describe("computeScrollFollowStep", () => {
  it("settles when already on the bottom with no velocity", () => {
    const step = computeScrollFollowStep(800, 1000, 200, 0, 1 / 60);
    expect(step.nextScrollTop).toBe(800);
    expect(step.velocity).toBe(0);
    expect(step.atBottom).toBe(true);
    expect(step.settled).toBe(true);
  });

  it("glides a large gap without jumping most of the way in one frame", () => {
    const step = computeScrollFollowStep(0, 1200, 200, 0, 1 / 60);
    // maxScroll=1000; one 16ms spring frame should move, but stay well under a hard cut
    expect(step.nextScrollTop).toBeGreaterThan(0);
    expect(step.nextScrollTop).toBeLessThan(80);
    expect(step.velocity).toBeGreaterThan(0);
    expect(step.settled).toBe(false);
  });

  it("approaches the bottom over several frames", () => {
    let top = 0;
    let vel = 0;
    for (let i = 0; i < 90; i++) {
      const step = computeScrollFollowStep(top, 1200, 200, vel, 1 / 60);
      top = step.nextScrollTop;
      vel = step.velocity;
      if (step.settled) break;
    }
    expect(top).toBe(1000);
    expect(vel).toBe(0);
  });

  it("does not overshoot past the bottom", () => {
    // High velocity toward bottom should clamp, not bounce past maxScroll
    const step = computeScrollFollowStep(790, 1000, 200, 4000, 1 / 60);
    expect(step.nextScrollTop).toBeLessThanOrEqual(800);
  });

  it("softer stiffness glides less per frame than the default", () => {
    const soft = computeScrollFollowStep(0, 1200, 200, 0, 1 / 60, {
      stiffness: 62,
      damping: 16.2,
    });
    const firm = computeScrollFollowStep(0, 1200, 200, 0, 1 / 60);
    expect(soft.nextScrollTop).toBeLessThan(firm.nextScrollTop);
    expect(soft.velocity).toBeLessThan(firm.velocity);
  });
});

describe("scrollToMessageWithin", () => {
  it("puts the target top near the upper part of the viewport", () => {
    const top = scrollToMessageWithin({
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 4000,
      elementTop: 1500,
      elementHeight: 200,
    });
    // 600 * 0.28 = 168 → 1500 - 168
    expect(top).toBe(1332);
  });

  it("keeps the whole block visible when it fits in the viewport", () => {
    const clientHeight = 600;
    const elementTop = 800;
    const elementHeight = 120;
    const top = scrollToMessageWithin({
      scrollTop: 0,
      clientHeight,
      scrollHeight: 4000,
      elementTop,
      elementHeight,
    });
    // 块底 + pad 必须在视口内：top >= elementTop + height + pad - clientHeight
    expect(top + clientHeight).toBeGreaterThanOrEqual(elementTop + elementHeight);
    expect(top).toBeGreaterThanOrEqual(elementTop + elementHeight + 16 - clientHeight);
  });

  it("never scrolls above zero", () => {
    const top = scrollToMessageWithin({
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 4000,
      elementTop: 40,
      elementHeight: 100,
    });
    expect(top).toBe(0);
  });

  it("clamps to the maximum scrollable offset", () => {
    const top = scrollToMessageWithin({
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 1000,
      elementTop: 990,
      elementHeight: 100,
    });
    expect(top).toBe(400);
  });

  it("returns zero when the container cannot scroll", () => {
    expect(
      scrollToMessageWithin({
        scrollTop: 0,
        clientHeight: 600,
        scrollHeight: 600,
        elementTop: 300,
        elementHeight: 80,
      }),
    ).toBe(0);
  });

  it("does not cut the block top out of view for a very tall block", () => {
    const elementTop = 2000;
    const top = scrollToMessageWithin({
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 6000,
      elementTop,
      elementHeight: 1600,
    });
    // 高块优先露顶部：块顶在视口内的位置至少留 pad（elementTop - top >= pad）
    expect(elementTop - top).toBeGreaterThanOrEqual(16);
  });
});
