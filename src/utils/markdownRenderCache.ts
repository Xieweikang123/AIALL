/** Bounded LRU for markdown HTML — helps final frame match last streaming frame. */
/** Full-render cache: covers the 80-message visible window plus some headroom. */
const RENDER_CACHE_MAX = 120;
/** Lite-render (streaming) cache: smaller since keys change every delta. */
const LITE_CACHE_MAX = 80;
/**
 * 后处理（代码块包裹 / 工具摘要折叠 / mermaid SVG）结果缓存。
 * 按会话可见的消息数估算，60 条足以覆盖一次 tab 切换的复用面。
 */
const POST_PROCESS_CACHE_MAX = 60;

export function createMarkdownRenderCache(maxSize: number) {
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
/**
 * 装饰后 HTML 的跨 DOM 复用缓存（见 `ChatMarkdown.vue` 的 schedulePostProcess）。
 * 切会话时 v-memo 全失效 → v-html 重替换 → DOM 上的守卫被冲掉，
 * 没有这层缓存就会把每条消息的 DOM 手术后处理全部重做一遍。
 */
export const markdownPostProcessCache = createMarkdownRenderCache(POST_PROCESS_CACHE_MAX);


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
