/** Base throttle interval for re-parsing markdown while content is still streaming. */
export const STREAM_MARKDOWN_THROTTLE_MS = 80;

/** Min/max throttle intervals for adaptive throttling. */
const THROTTLE_MIN_MS = 32;
const THROTTLE_MAX_MS = 160;

/**
 * Estimate markdown complexity to adapt throttle interval.
 * Higher complexity = longer interval (avoid expensive re-parses).
 */
function estimateMarkdownComplexity(source: string): number {
  let score = 0;
  // Code fences are the most expensive to re-parse
  const fenceCount = (source.match(/^```/gm) || []).length;
  score += fenceCount * 4;
  // Tables require column alignment
  const tableRows = (source.match(/^\|/gm) || []).length;
  score += tableRows * 1.5;
  // Nested lists add depth
  const nestedLists = (source.match(/^(\s{2,})[-*+]/gm) || []).length;
  score += nestedLists * 1;
  // Headings cause re-layout
  const headings = (source.match(/^#{1,6}\s/gm) || []).length;
  score += headings * 0.5;
  return score;
}

function computeAdaptiveInterval(source: string): number {
  const complexity = estimateMarkdownComplexity(source);
  // Map complexity 0..20 to interval min..max
  const t = Math.min(1, complexity / 20);
  return Math.round(THROTTLE_MIN_MS + t * (THROTTLE_MAX_MS - THROTTLE_MIN_MS));
}

export type StreamingMarkdownThrottle = {
  /** Latest throttled text safe to pass into renderMarkdown. */
  renderText: { value: string };
  /** Push a new full source string; applies throttle when streaming is true. */
  pushSource: (source: string, streaming: boolean) => void;
  /** Flush pending throttle and release timers. */
  dispose: () => void;
};

/** Buffer streamed markdown source and reveal at most once per interval while streaming. */
export function createStreamingMarkdownThrottle(
  intervalMs = STREAM_MARKDOWN_THROTTLE_MS,
  onUpdate?: (text: string) => void,
): StreamingMarkdownThrottle {
  const renderText = { value: "" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingSource = "";

  function applyRenderText(text: string) {
    renderText.value = text;
    onUpdate?.(text);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    applyRenderText(pendingSource);
  }

  function pushSource(source: string, streaming: boolean) {
    pendingSource = source;
    if (!streaming) {
      flush();
      return;
    }
    if (timer) return;
    // The caller-provided interval is the lower bound; complexity may only
    // delay expensive parses further, never make a requested delay shorter.
    const adaptiveMs = Math.max(intervalMs, computeAdaptiveInterval(source));
    timer = setTimeout(() => {
      timer = null;
      applyRenderText(pendingSource);
    }, adaptiveMs);
  }

  function dispose() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { renderText, pushSource, dispose };
}
