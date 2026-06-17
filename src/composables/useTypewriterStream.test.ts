import { describe, expect, it, vi, afterEach } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useTypewriterStream } from "./useTypewriterStream";

describe("useTypewriterStream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reveals one character per tick while enabled", async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const source = ref("你好");
    const enabled = ref(true);
    const visibleText = scope.run(() => {
      const stream = useTypewriterStream({ source, enabled, intervalMs: 20 });
      return stream.visibleText;
    })!;

    expect(visibleText.value).toBe("你");
    vi.advanceTimersByTime(20);
    await nextTick();
    expect(visibleText.value).toBe("你好");
    scope.stop();
  });

  it("shows full text immediately when disabled", async () => {
    const scope = effectScope();
    const source = ref("完整回答");
    const enabled = ref(false);
    const visibleText = scope.run(() => useTypewriterStream({ source, enabled }).visibleText)!;

    expect(visibleText.value).toBe("完整回答");
    scope.stop();
  });

  it("keeps revealing one character per tick as source grows", async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const source = ref("A");
    const enabled = ref(true);
    const visibleText = scope.run(() => useTypewriterStream({ source, enabled, intervalMs: 10 }).visibleText)!;

    expect(visibleText.value).toBe("A");
    source.value = "ABC";
    await nextTick();
    expect(visibleText.value).toBe("AB");
    vi.advanceTimersByTime(10);
    await nextTick();
    expect(visibleText.value).toBe("ABC");
    scope.stop();
  });
});
