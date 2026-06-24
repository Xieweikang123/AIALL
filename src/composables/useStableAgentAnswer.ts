import { ref, watch, type Ref } from "vue";

/** Keep the longest answer seen during a run — avoids shrink/clear flicker between turns. */
export function useStableAgentAnswer(
  source: () => string,
  isRunning: () => boolean,
): { stableAnswer: Ref<string> } {
  const stableAnswer = ref("");
  let peakLength = 0;

  watch(
    [source, isRunning],
    ([answer, running]) => {
      const trimmed = answer.trim();

      if (!running) {
        stableAnswer.value = answer;
        peakLength = trimmed.length;
        return;
      }

      if (!trimmed) {
        // Between tool turns the live preview may go empty — keep last substantive text.
        return;
      }

      if (!stableAnswer.value.trim() || trimmed.length >= peakLength * 0.85) {
        stableAnswer.value = answer;
        peakLength = trimmed.length;
      }
    },
    { immediate: true },
  );

  watch(isRunning, (running, wasRunning) => {
    if (running && !wasRunning && !source().trim() && !stableAnswer.value.trim()) {
      peakLength = 0;
    }
  });

  return { stableAnswer };
}
