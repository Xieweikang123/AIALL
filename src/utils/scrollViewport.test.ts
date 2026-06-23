import { describe, expect, it, vi } from "vitest";
import { isScrollNearBottom, scrollContainerToBottom, scrollElementToBottom } from "./scrollViewport";

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
