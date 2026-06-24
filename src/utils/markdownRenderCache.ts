/** Bounded LRU for markdown HTML — helps final frame match last streaming frame. */
const CACHE_MAX = 48;

function createMarkdownRenderCache() {
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
      if (store.size > CACHE_MAX) {
        const oldest = store.keys().next().value;
        if (oldest) store.delete(oldest);
      }
    },
    clear() {
      store.clear();
    },
  };
}

export const markdownRenderCache = createMarkdownRenderCache();
export const markdownLiteRenderCache = createMarkdownRenderCache();

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
