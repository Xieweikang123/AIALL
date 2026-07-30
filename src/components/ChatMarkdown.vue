<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { renderMarkdown } from "../utils/renderMarkdown";
import { disposeMermaidRenderer, renderMermaidInContainer } from "../utils/mermaidRenderer";
import { parseAiOptions, type AiOption } from "../utils/parseAiOptions";
import { parseClarificationChoices } from "../utils/parseClarificationChoices";
import { looksLikeClarificationQuestion } from "../orchestration/generic/ambiguousTermTriggers";
import AiOptionButtons from "./AiOptionButtons.vue";
import ClarificationChoicePanel from "./ClarificationChoicePanel.vue";
import { sanitizeMarkdownForDisplay } from "../services/markdownDisplaySanitize";
import { createStreamingMarkdownThrottle } from "../utils/streamingMarkdownThrottle";
import {
  IncrementalMarkdownRenderer,
} from "../utils/incrementalMarkdownRenderer";
import { patchDomWithHtml } from "../utils/domBlockPatcher";

const props = withDefaults(
  defineProps<{
    content: string;
    /** Throttle markdown re-parsing while content is still growing. */
    streaming?: boolean;
    /** Enable interactive option detection for assistant messages. */
    interactive?: boolean;
  }>(),
  { streaming: false, interactive: false },
);

const emit = defineEmits<{
  selectOption: [option: AiOption];
}>();

const markdownRef = ref<HTMLElement | null>(null);
const streamingContentRef = ref<HTMLElement | null>(null);
const renderSource = ref(props.content);
const streamingRenderText = ref("");
const streamingMinHeight = ref(0);
/** Keep last painted HTML while switching streaming -> final render to avoid blank flash. */
const cachedDisplayHtml = ref("");
/** One paint cycle after streaming ends: still use lite path until full markdown is ready. */
const streamingSettling = ref(false);
const streamingHtmlCache = ref("");

/** Incremental renderer: caches completed blocks, only re-renders the last block. */
const incrementalRenderer = new IncrementalMarkdownRenderer();

/** Last HTML written via DOM patch — skip no-op patches; reset on clear / stream end. */
let lastStreamPatchHtml = "";
let postProcessRaf = 0;

const streamingThrottle = createStreamingMarkdownThrottle(undefined, (text) => {
  streamingRenderText.value = text;
  streamingHtmlCache.value = incrementalRenderer.render(text);
});

function joinParsedMarkdown(parsed: { before: string; after: string }): string {
  const after = parsed.after.trim();
  return after ? `${parsed.before}\n\n${after}` : parsed.before;
}

function buildStreamingHtml(sourceText: string): string {
  const parsed = props.interactive ? parseAiOptions(sourceText) : null;
  const markdown = parsed?.options.length ? joinParsedMarkdown(parsed) : sourceText;
  return incrementalRenderer.render(markdown);
}

const effectiveStreaming = computed(() => props.streaming || streamingSettling.value);

/** Coalesce layout-hold reads — avoid onUpdated ↔ minHeight reset loops while streaming. */
let streamingLayoutHoldRaf = 0;

function syncStreamingMinHeight() {
  if (!effectiveStreaming.value || !markdownRef.value) return;
  if (streamingLayoutHoldRaf) return;
  streamingLayoutHoldRaf = requestAnimationFrame(() => {
    streamingLayoutHoldRaf = 0;
    const node = markdownRef.value;
    if (!node || !effectiveStreaming.value) return;
    const prevHold = streamingMinHeight.value;
    const naturalHeight = node.offsetHeight;
    if (naturalHeight <= 0) return;
    // Monotonic during streaming: lite markdown re-parses can briefly shrink layout;
    // shrinking minHeight causes visible wobble. Reset only via content watch / stream end.
    if (naturalHeight > prevHold) {
      streamingMinHeight.value = naturalHeight;
    }
  });
}

function releaseStreamingLayoutHold() {
  void nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        streamingSettling.value = false;
        streamingMinHeight.value = 0;
        // Clear streaming DOM so final v-html render takes over
        if (streamingContentRef.value) {
          streamingContentRef.value.innerHTML = "";
        }
        lastStreamPatchHtml = "";
        incrementalRenderer.reset();
      });
    });
  });
}

watch(
  () => props.streaming,
  (streaming, wasStreaming) => {
    if (wasStreaming && !streaming) {
      streamingSettling.value = true;
      streamingThrottle.pushSource(props.content, false);
      renderSource.value = props.content;
      releaseStreamingLayoutHold();
    }
  },
);

watch(
  () => props.content,
  (value, prev) => {
    if (!value.trim()) {
      cachedDisplayHtml.value = "";
      streamingHtmlCache.value = "";
      streamingMinHeight.value = 0;
      incrementalRenderer.reset();
      lastStreamPatchHtml = "";
    }
    if (
      props.streaming &&
      prev &&
      value.trim().length > 0 &&
      value.trim().length < prev.trim().length * 0.85
    ) {
      streamingMinHeight.value = 0;
    }
    if (props.streaming || streamingSettling.value) {
      streamingThrottle.pushSource(value, props.streaming);
      return;
    }
    streamingThrottle.pushSource(value, false);
    renderSource.value = value;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (streamingLayoutHoldRaf) {
    cancelAnimationFrame(streamingLayoutHoldRaf);
    streamingLayoutHoldRaf = 0;
  }
  if (postProcessRaf) {
    cancelAnimationFrame(postProcessRaf);
    postProcessRaf = 0;
  }
  streamingThrottle.dispose();
  incrementalRenderer.reset();
  disposeMermaidRenderer();
});

/** Wrap tool summary blocks (h3[工具摘要] + following ul) into collapsible cards. */
function wrapToolSummaryBlocks(el: HTMLElement) {
  if (!el.textContent?.includes("工具摘要")) return;
  const h3s = el.querySelectorAll("h3:not(.tool-summary-content h3)");
  h3s.forEach((h3) => {
    if (!h3.textContent?.includes("工具摘要")) return;
    if (h3.closest(".tool-summary-block")) return; // already wrapped

    // Collect h3 + following siblings until next heading or non-list element
    const wrapper = document.createElement("div");
    wrapper.className = "tool-summary-block";
    wrapper.setAttribute("data-collapsed", "false");

    // Header (clickable) — count items first
    const header = document.createElement("div");
    header.className = "tool-summary-header";
    header.innerHTML = `<span class="tool-summary-icon">⚙️</span><span class="tool-summary-count"></span><span class="tool-summary-toggle">▾</span>`;

    // Content (collapsible)
    const content = document.createElement("div");
    content.className = "tool-summary-content";

    // Move h3's siblings into content
    let next = h3.nextElementSibling;
    const toMove: Element[] = [];
    while (next) {
      if (next.tagName === "H3" || next.tagName === "H2" || next.tagName === "H1") break;
      toMove.push(next);
      next = next.nextElementSibling;
    }

    // Replace h3 with wrapper
    h3.parentNode?.insertBefore(wrapper, h3);
    wrapper.appendChild(header);
    wrapper.appendChild(content);
    content.appendChild(h3); // put h3 inside content (hidden)
    toMove.forEach((el) => content.appendChild(el));

    // Color-code list items by action type
    const colorMap: Record<string, string> = {
      "读取文件": "#58a6ff",
      "搜索代码": "#d2a8ff",
      "局部修改": "#3fb950",
      "读取目录": "#79c0ff",
      "执行命令": "#f0883e",
      "写入文件": "#f778ba",
      "删除文件": "#f85149",
    };
    content.querySelectorAll("li").forEach((li) => {
      const text = li.textContent || "";
      let matchedColor = "";
      for (const [key, color] of Object.entries(colorMap)) {
        if (text.includes(key)) { matchedColor = color; break; }
      }
      if (matchedColor) {
        li.style.setProperty("--dot-color", matchedColor);
        li.style.background = `${matchedColor}06`;
      }
      // Bold the action type prefix before ":"
      const colonIdx = text.indexOf(":");
      if (colonIdx > 0 && colonIdx < 20) {
        const prefix = text.slice(0, colonIdx);
        const rest = text.slice(colonIdx);
        li.innerHTML = `<strong style="color: ${matchedColor || 'rgba(255,255,255,0.7)'}; font-weight: 700; font-size: 11px; letter-spacing: 0.3px;">${prefix}</strong><span style="color: rgba(255,255,255,0.5); font-size: 12px;">${rest}</span>`;
      }
    });

    // Set tool call count badge
    const countEl = header.querySelector(".tool-summary-count") as HTMLSpanElement;
    if (countEl) {
      const actionCount = content.querySelectorAll("li").length;
      countEl.textContent = String(actionCount);
    }

    // Toggle click
    header.addEventListener("click", () => {
      const collapsed = wrapper.getAttribute("data-collapsed") === "true";
      wrapper.setAttribute("data-collapsed", String(!collapsed));
    });
  });
}

// Parse options from content (including during streaming once the block is complete)
const activeSource = computed(() =>
  effectiveStreaming.value ? streamingRenderText.value : renderSource.value,
);

const parsedOptions = computed(() => {
  if (!props.interactive) return null;
  const parsed = parseAiOptions(activeSource.value);
  if (!parsed?.options.length) return null;
  return parsed;
});

const parsedClarification = computed(() => {
  if (!props.interactive || parsedOptions.value) return null;
  const source = activeSource.value;
  if (!looksLikeClarificationQuestion(source)) return null;
  const parsed = parseClarificationChoices(source);
  if (!parsed?.questions.length) return null;
  return parsed;
});

const markdownContent = computed(() => {
  const clarification = parsedClarification.value;
  if (clarification) return clarification.displayText;
  const parsed = parsedOptions.value;
  if (!parsed) return activeSource.value;
  return joinParsedMarkdown(parsed);
});

const sanitizedMarkdown = computed(() => sanitizeMarkdownForDisplay(markdownContent.value));

const html = computed(() => renderMarkdown(sanitizedMarkdown.value));

const displayHtml = computed(() =>
  effectiveStreaming.value ? streamingHtmlCache.value : html.value,
);

watch(
  displayHtml,
  (value) => {
    if (value) cachedDisplayHtml.value = value;
  },
  { immediate: true },
);

const safeDisplayHtml = computed(() => displayHtml.value || cachedDisplayHtml.value);

/** During streaming, patch DOM incrementally instead of v-html full replace. */
function applyStreamingDomPatch(html: string) {
  if (!streamingContentRef.value) return;
  if (html === lastStreamPatchHtml) return;
  lastStreamPatchHtml = html;
  patchDomWithHtml(streamingContentRef.value, html);
}

watch(
  [streamingHtmlCache, effectiveStreaming],
  ([html, streaming]) => {
    if (streaming && html) {
      applyStreamingDomPatch(html);
    }
  },
);

/** Reset last patch marker when streaming ends so final render always applies. */
watch(effectiveStreaming, (streaming, wasStreaming) => {
  if (wasStreaming && !streaming) {
    lastStreamPatchHtml = "";
  }
});

const showMarkdown = computed(
  () =>
    Boolean(safeDisplayHtml.value)
    || Boolean(parsedOptions.value?.options.length)
    || Boolean(parsedClarification.value?.questions.length),
);

function handleOptionSelect(option: AiOption) {
  emit("selectOption", option);
}

function handleClarificationSelect(payload: { question: string; option: AiOption }) {
  emit("selectOption", {
    index: payload.option.index,
    label: payload.option.label,
    fullText: `${payload.question}\n我选择：${payload.option.fullText}`,
    showIndex: false,
  });
}

// After render, wrap tool summary blocks (skip while streaming for perf)
function schedulePostProcess() {
  if (effectiveStreaming.value || postProcessRaf) return;
  postProcessRaf = requestAnimationFrame(() => {
    postProcessRaf = 0;
    nextTick(() => {
      if (effectiveStreaming.value || !markdownRef.value) return;
      wrapToolSummaryBlocks(markdownRef.value);
      renderMermaidInContainer(markdownRef.value);
    });
  });
}

watch([displayHtml, effectiveStreaming], () => {
  if (effectiveStreaming.value) {
    syncStreamingMinHeight();
    return;
  }
  schedulePostProcess();
}, { immediate: true });
</script>

<template>
  <div
    v-if="showMarkdown"
    ref="markdownRef"
    class="msg-markdown"
    :class="{ 'msg-markdown--streaming': effectiveStreaming }"
    :style="effectiveStreaming && streamingMinHeight ? { minHeight: `${streamingMinHeight}px` } : undefined"
  >
    <!-- Streaming: DOM is patched incrementally via applyStreamingDomPatch() -->
    <div ref="streamingContentRef" v-show="effectiveStreaming" />
    <!-- Final render: full v-html replace (only when streaming is done) -->
    <div v-if="!effectiveStreaming && safeDisplayHtml" v-html="safeDisplayHtml" />
    <AiOptionButtons
      v-if="parsedOptions?.options.length"
      :options="parsedOptions.options"
      @select="handleOptionSelect"
    />
    <ClarificationChoicePanel
      v-if="parsedClarification?.questions.length"
      :questions="parsedClarification.questions"
      @select="handleClarificationSelect"
    />
  </div>
</template>

<style scoped>
.msg-markdown {
  min-width: 0;
  max-width: 100%;
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: rgba(255, 255, 255, 0.92);
  transition: min-height 0.2s ease;
}

.msg-markdown--streaming {
  opacity: 0.98;
}

.msg-markdown :deep(p) {
  margin: 0 0 0.75em;
}

.msg-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.msg-markdown :deep(h1),
.msg-markdown :deep(h2),
.msg-markdown :deep(h3),
.msg-markdown :deep(h4) {
  margin: 1em 0 0.5em;
  font-weight: 600;
  line-height: 1.35;
}

.msg-markdown :deep(h1) {
  font-size: 1.25em;
}

.msg-markdown :deep(h2) {
  font-size: 1.15em;
}

.msg-markdown :deep(h3) {
  font-size: 1.05em;
}

.msg-markdown :deep(h4) {
  font-size: 0.98em;
  color: rgba(240, 245, 250, 0.94);
}

.msg-markdown :deep(ul),
.msg-markdown :deep(ol) {
  margin: 0.5em 0 0.75em;
  padding-left: 1.4em;
}

.msg-markdown :deep(li) {
  margin: 0.25em 0;
}

.msg-markdown :deep(li > ul),
.msg-markdown :deep(li > ol) {
  margin: 0.35em 0 0.15em;
}

.msg-markdown :deep(li > p) {
  margin: 0;
}

.msg-markdown :deep(blockquote) {
  margin: 0.75em 0;
  padding: 0.4em 0.8em;
  border-left: 3px solid rgba(31, 111, 235, 0.45);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.78);
}

.msg-markdown :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 0.1em 0.35em;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.msg-markdown :deep(pre) {
  margin: 0.75em 0;
  padding: 10px 12px;
  max-width: 100%;
  overflow-x: auto;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

/* 无语言 / plaintext 代码块：确保不换行、横向滚动、消除硬件层模糊 */
.msg-markdown :deep(pre:not([class*="language-"]) code),
.msg-markdown :deep(code.language-text),
.msg-markdown :deep(code.language-plaintext) {
  white-space: pre !important;
  word-break: normal !important;
  overflow-x: auto;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.msg-markdown :deep(pre code) {
  /* 字体链：现代等宽字体优先，含完备 Box Drawing 支持，中文字体兜底 */
  font-family:
    "Cascadia Code",
    "Fira Code",
    "JetBrains Mono",
    Consolas,
    "Courier New",
    "PingFang SC",
    "Microsoft YaHei",
    monospace !important;
  display: block;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 12px;
  line-height: 1.25;
  white-space: pre;
  font-variant-ligatures: none !important;
  font-variant-numeric: tabular-nums;
  word-spacing: 0;
  letter-spacing: 0;
  font-feature-settings: "tnum" 1;
}

.msg-markdown :deep(a) {
  color: #91beff;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.msg-markdown :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  margin: 1em 0;
}

.msg-markdown :deep(table) {
  width: 100%;
  max-width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin: 0.75em 0;
  font-size: 12px;
}

.msg-markdown :deep(th),
.msg-markdown :deep(td) {
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 6px 8px;
  text-align: left;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.msg-markdown :deep(th) {
  background: rgba(255, 255, 255, 0.06);
}

.msg-markdown :deep(strong) {
  font-weight: 600;
}

.msg-markdown :deep(em) {
  font-style: italic;
}

/* ===== Tool Summary Block (compact) ===== */
.msg-markdown :deep(.tool-summary-block) {
  margin: 6px 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(139, 148, 158, 0.06);
  overflow: hidden;
}

.msg-markdown :deep(.tool-summary-header) {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  cursor: pointer;
  user-select: none;
}

.msg-markdown :deep(.tool-summary-header:hover) {
  background: rgba(255, 255, 255, 0.04);
}

.tool-summary-icon,
.msg-markdown :deep(.tool-summary-icon) {
  font-size: 11px;
  opacity: 0.5;
}

.tool-summary-count,
.msg-markdown :deep(.tool-summary-count) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 14px;
  padding: 0 4px;
  border-radius: 7px;
  background: rgba(88, 166, 255, 0.12);
  color: rgba(145, 190, 255, 0.9);
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
}

.msg-markdown :deep(.tool-summary-title) {
  font-size: 10px;
  font-weight: 500;
  color: rgba(139, 148, 158, 0.8);
  flex: 1;
  text-transform: uppercase;
}

.msg-markdown :deep(.tool-summary-toggle) {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.25);
  margin-left: auto;
  transition: transform 0.2s ease;
}

.msg-markdown :deep(.tool-summary-block[data-collapsed="false"] .tool-summary-toggle) {
  transform: rotate(0deg);
}

.msg-markdown :deep(.tool-summary-block[data-collapsed="true"] .tool-summary-toggle) {
  transform: rotate(-90deg);
}

/* Collapsible content */
.msg-markdown :deep(.tool-summary-content) {
  max-height: 300px;
  overflow-y: auto;
  overflow-x: hidden;
  transition: max-height 0.25s ease, opacity 0.2s ease;
  opacity: 1;
  padding: 0 8px 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

.msg-markdown :deep(.tool-summary-content::-webkit-scrollbar) {
  width: 3px;
}

.msg-markdown :deep(.tool-summary-content::-webkit-scrollbar-thumb) {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 999px;
}

.msg-markdown :deep(.tool-summary-block[data-collapsed="true"] .tool-summary-content) {
  max-height: 0;
  opacity: 0;
  padding: 0 8px;
  overflow: hidden;
}

/* Hide the h3 inside the summary (replaced by header) */
.msg-markdown :deep(.tool-summary-content > h3) {
  display: none;
}

/* Style list items inside tool summary */
.msg-markdown :deep(.tool-summary-content > ul) {
  margin: 0;
  padding: 2px 4px;
  list-style: none;
}

.msg-markdown :deep(.tool-summary-content > ul > li) {
  margin: 1px 0;
  font-size: 11px;
  color: rgba(139, 148, 158, 0.85);
  line-height: 1.4;
  padding: 3px 8px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.12);
  position: relative;
}

.msg-markdown :deep(.tool-summary-content > ul > li:hover) {
  background: rgba(255, 255, 255, 0.03);
}

.msg-markdown :deep(.tool-summary-content > ul > li::before) {
  display: none;
}

/* Color-coded dot before each list item */
.msg-markdown :deep(.tool-summary-content > ul > li:has(strong))::before {
  content: "";
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dot-color, rgba(255, 255, 255, 0.15));
  flex-shrink: 0;
  margin-right: 2px;
  box-shadow: 0 0 3px var(--dot-color, transparent);
}

/* highlight.js 主题由 github-dark.css 全局提供 */

/* ─── Mermaid 图表 ────────────────────────────────── */
.msg-markdown :deep(.mermaid-render:not([data-mermaid-rendered]) code.language-mermaid) {
  display: none;
}

.msg-markdown :deep(.mermaid-render) {
  position: relative;
  margin: 0.75em 0;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow-x: auto;
  overscroll-behavior: contain;
  text-align: center;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  /* 防止触控板捏合触发整页缩放，仅作用于图表自身缩放 */
  touch-action: none;
}

.msg-markdown :deep(.mermaid-render::-webkit-scrollbar) {
  height: 3px;
}

.msg-markdown :deep(.mermaid-render::-webkit-scrollbar-thumb) {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 999px;
}

.msg-markdown :deep(.mermaid-render .mermaid-chart-wrapper) {
  display: inline-block;
  text-align: center;
}

.msg-markdown :deep(.mermaid-render svg) {
  max-width: 100%;
  height: auto;
}

/* Mermaid 渲染失败提示 */
.msg-markdown :deep(.mermaid-render pre) {
  margin: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  font-size: 12px;
}

/* ─── Mermaid 工具栏 ──────────────────────────────── */
.msg-markdown :deep(.mermaid-toolbar) {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 2;
  pointer-events: none;
}

.msg-markdown :deep(.mermaid-render:hover .mermaid-toolbar) {
  opacity: 1;
  pointer-events: auto;
}

.msg-markdown :deep(.mermaid-toolbar button) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(205, 214, 244, 0.8);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  line-height: 1;
}

.msg-markdown :deep(.mermaid-toolbar button:hover) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.msg-markdown :deep(.mermaid-toolbar .mermaid-zoom-label) {
  font-size: 10px;
  color: rgba(205, 214, 244, 0.6);
  min-width: 32px;
  text-align: center;
  user-select: none;
}

/* ─── Mermaid 全屏遮罩（scoped 内不生效，因为 overlay 挂在 body） ── */
</style>

<!-- non-scoped: overlay 由 JS 追加到 document.body，scoped 属性选择器无法命中 -->
<style>
.mermaid-fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  overflow: auto;
  overscroll-behavior: contain;
  cursor: zoom-out;
  /* 防止触控板捏合被浏览器拦截为整页缩放，仅作用于图表自身缩放 */
  touch-action: none;
}
.mermaid-fullscreen-overlay .mermaid-fs-toolbar {
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  z-index: 10000;
}
.mermaid-fullscreen-overlay .mermaid-fs-toolbar button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(205, 214, 244, 0.85);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.mermaid-fullscreen-overlay .mermaid-fs-toolbar button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.mermaid-fullscreen-overlay .mermaid-fs-toolbar .mermaid-zoom-label {
  font-size: 11px;
  color: rgba(205, 214, 244, 0.6);
  min-width: 36px;
  text-align: center;
  user-select: none;
}
.mermaid-fullscreen-overlay .mermaid-fs-close {
  font-size: 16px !important;
  margin-left: 4px;
}
.mermaid-fullscreen-overlay .mermaid-fs-chart-wrapper {
  cursor: grab;
  flex: 0 1 auto;
  max-width: 92vw;
  max-height: 88vh;
  overflow: auto;
  overscroll-behavior: contain;
  touch-action: none;
}
.mermaid-fullscreen-overlay .mermaid-fs-chart-wrapper svg {
  display: block;
  max-width: 90vw;
  max-height: 85vh;
  width: auto;
  height: auto;
}
</style>
