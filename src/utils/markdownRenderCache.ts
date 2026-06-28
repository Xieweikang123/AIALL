/** Bounded LRU for markdown HTML — helps final frame match last streaming frame. */
/** Full-render cache: covers the 80-message visible window plus some headroom. */
const RENDER_CACHE_MAX = 120;
/** Lite-render (streaming) cache: smaller since keys change every delta. */
const LITE_CACHE_MAX = 80;

function createMarkdownRenderCache(maxSize: number) {
  const store = new Map<string, string>();

  return {
    get(key: string): string | undefined {
      return store.get(key);
    },
    set(key: string, value: string) {
      if (store.has(key)) {
        store.delete(key);
      }
      store.set(key, value);
      if (store.size > maxSize) {
        const oldest = store.keys().next().value;
        if (oldest) store.delete(oldest);
      }
    },
    clear() {
      store.clear();
    },
  };
}

export const markdownRenderCache = createMarkdownRenderCache(RENDER_CACHE_MAX);
export const markdownLiteRenderCache = createMarkdownRenderCache(LITE_CACHE_MAX);


export function getCachedMarkdownHtml(
  source: string,
  cache: ReturnType<typeof createMarkdownRenderCache>,
  render: () => string,
): string {
  if (!source) return "";
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  const html = render();
  cache.set(source, html);
  return html;
}
