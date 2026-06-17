import { computed, effectScope, onScopeDispose, ref, watch, type MaybeRefOrGetter, toValue } from "vue";

export type TypewriterStreamOptions = {
  /** Full streamed text as it grows. */
  source: MaybeRefOrGetter<string>;
  /** When false, show the full source immediately. */
  enabled: MaybeRefOrGetter<boolean>;
  /** Milliseconds between each revealed character. */
  intervalMs?: number;
};

/** Reveal streamed text one character at a time for a typewriter effect. */
export function useTypewriterStream(options: TypewriterStreamOptions) {
  const intervalMs = options.intervalMs ?? 22;

  const visibleLength = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;

  const visibleText = computed(() => {
    const source = toValue(options.source);
    if (!toValue(options.enabled)) return source;
    return source.slice(0, visibleLength.value);
  });

  function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function revealStep() {
    const source = toValue(options.source);
    if (!toValue(options.enabled)) {
      visibleLength.value = source.length;
      stopTimer();
      return;
    }

    if (visibleLength.value > source.length) {
      visibleLength.value = source.length;
    }

    if (visibleLength.value < source.length) {
      visibleLength.value += 1;
    }
  }

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(revealStep, intervalMs);
  }

  watch(
    () => [toValue(options.source), toValue(options.enabled)] as const,
    ([source, enabled]) => {
      if (!enabled) {
        visibleLength.value = source.length;
        stopTimer();
        return;
      }
      if (visibleLength.value > source.length) {
        visibleLength.value = source.length;
      }
      ensureTimer();
      revealStep();
    },
    { immediate: true },
  );

  onScopeDispose(stopTimer);

  return { visibleText, visibleLength };
}
