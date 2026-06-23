/** Throttle interval for re-parsing markdown while content is still streaming. */
export const STREAM_MARKDOWN_THROTTLE_MS = 80;

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
    timer = setTimeout(() => {
      timer = null;
      applyRenderText(pendingSource);
    }, intervalMs);
  }

  function dispose() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { renderText, pushSource, dispose };
}
