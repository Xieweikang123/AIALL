import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamingMarkdownThrottle } from "./streamingMarkdownThrottle";

describe("createStreamingMarkdownThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies source immediately when not streaming", () => {
    const throttle = createStreamingMarkdownThrottle(100);
    throttle.pushSource("hello", false);
    expect(throttle.renderText.value).toBe("hello");
    throttle.dispose();
  });

  it("delays source updates while streaming", () => {
    const throttle = createStreamingMarkdownThrottle(100);
    throttle.pushSource("a", true);
    expect(throttle.renderText.value).toBe("");

    vi.advanceTimersByTime(99);
    expect(throttle.renderText.value).toBe("");

    vi.advanceTimersByTime(1);
    expect(throttle.renderText.value).toBe("a");
    throttle.dispose();
  });

  it("flushes latest source when streaming ends", () => {
    const throttle = createStreamingMarkdownThrottle(100);
    throttle.pushSource("partial", true);
    throttle.pushSource("final", false);
    expect(throttle.renderText.value).toBe("final");
    throttle.dispose();
  });
});
