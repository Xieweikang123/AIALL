import { describe, expect, it, vi } from "vitest";
import {
  computeScrollFollowStep,
  isScrollNearBottom,
  scrollContainerToBottom,
  scrollElementToBottom,
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
