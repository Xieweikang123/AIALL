<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onUpdated, ref, watch } from "vue";
import { renderMarkdown } from "../utils/renderMarkdown";

const props = withDefaults(
  defineProps<{
    content: string;
    /** Throttle markdown re-parsing while content is still growing. */
    streaming?: boolean;
  }>(),
  { streaming: false },
);

const markdownRef = ref<HTMLElement | null>(null);
const renderSource = ref(props.content);
let streamDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const STREAM_RENDER_MS = 320;

watch(
  () => props.content,
  (value) => {
    if (!props.streaming) {
      renderSource.value = value;
      return;
    }
    if (streamDebounceTimer) clearTimeout(streamDebounceTimer);
    streamDebounceTimer = setTimeout(() => {
      renderSource.value = value;
      streamDebounceTimer = null;
    }, STREAM_RENDER_MS);
  },
  { immediate: true },
);

watch(
  () => props.streaming,
  (streaming) => {
    if (!streaming) {
      if (streamDebounceTimer) {
        clearTimeout(streamDebounceTimer);
        streamDebounceTimer = null;
      }
      renderSource.value = props.content;
    }
  },
);

onBeforeUnmount(() => {
  if (streamDebounceTimer) clearTimeout(streamDebounceTimer);
});

/** Wrap tool summary blocks (h3[工具摘要] + following ul) into collapsible cards. */
function wrapToolSummaryBlocks(el: HTMLElement) {
  const h3s = el.querySelectorAll("h3");
  h3s.forEach((h3) => {
    if (!h3.textContent?.includes("工具摘要")) return;
    if (h3.closest(".tool-summary-block")) return; // already wrapped

    // Collect h3 + following siblings until next heading or non-list element
    const wrapper = document.createElement("div");
    wrapper.className = "tool-summary-block";
    wrapper.setAttribute("data-collapsed", "false");

    // Header (clickable)
    const header = document.createElement("div");
    header.className = "tool-summary-header";
    header.innerHTML = `<span class="tool-summary-icon">⚙️</span><span class="tool-summary-title">工具摘要</span><span class="tool-summary-toggle">▾</span>`;

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
    h3.parentNode!.insertBefore(wrapper, h3);
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
    };
    content.querySelectorAll("li").forEach((li) => {
      const text = li.textContent || "";
      let matchedColor = "";
      for (const [key, color] of Object.entries(colorMap)) {
        if (text.includes(key)) { matchedColor = color; break; }
      }
      if (matchedColor) {
        li.style.borderLeftColor = matchedColor;
      }
      // Bold the action type prefix before ":"
      const colonIdx = text.indexOf(":");
      if (colonIdx > 0 && colonIdx < 20) {
        const prefix = text.slice(0, colonIdx);
        const rest = text.slice(colonIdx);
        li.innerHTML = `<strong style="color: ${matchedColor || 'rgba(255,255,255,0.7)'}; font-weight: 600; font-size: 11px;">${prefix}</strong><span style="color: rgba(255,255,255,0.45); font-size: 12px;">${rest}</span>`;
      }
    });

    // Toggle click
    header.addEventListener("click", () => {
      const collapsed = wrapper.getAttribute("data-collapsed") === "true";
      wrapper.setAttribute("data-collapsed", String(!collapsed));
    });
  });
}

const html = computed(() => renderMarkdown(renderSource.value));

// After render, wrap tool summary blocks
function postProcess() {
  nextTick(() => {
    if (markdownRef.value) {
      wrapToolSummaryBlocks(markdownRef.value);
    }
  });
}

// Trigger on html change
watch(html, () => postProcess(), { immediate: true });
onUpdated(() => postProcess());
</script>

<template>
  <div v-if="html" ref="markdownRef" class="msg-markdown" v-html="html" />
  <div v-else-if="streaming && content" class="msg-markdown msg-plain-stream">{{ content }}</div>
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
}

.msg-plain-stream {
  white-space: pre-wrap;
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

.msg-markdown :deep(ul),
.msg-markdown :deep(ol) {
  margin: 0.5em 0 0.75em;
  padding-left: 1.4em;
}

.msg-markdown :deep(li) {
  margin: 0.25em 0;
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

.msg-markdown :deep(pre code) {
  display: block;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
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

/* ===== Tool Summary Block ===== */
.msg-markdown :deep(.tool-summary-block) {
  margin: 10px 0;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.msg-markdown :deep(.tool-summary-block:hover) {
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.msg-markdown :deep(.tool-summary-header) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease;
}

.msg-markdown :deep(.tool-summary-header:hover) {
  background: rgba(255, 255, 255, 0.04);
}

.msg-markdown :deep(.tool-summary-icon) {
  font-size: 12px;
  opacity: 0.6;
}

.msg-markdown :deep(.tool-summary-title) {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.3px;
  flex: 1;
}

.msg-markdown :deep(.tool-summary-toggle) {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  transition: transform 0.25s ease;
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
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.25s ease, padding 0.25s ease;
  opacity: 1;
  padding: 0 12px 6px;
}

.msg-markdown :deep(.tool-summary-block[data-collapsed="true"] .tool-summary-content) {
  max-height: 0;
  opacity: 0;
  padding: 0 12px;
}

/* Hide the h3 inside the summary (replaced by header) */
.msg-markdown :deep(.tool-summary-content > h3) {
  display: none;
}

/* Style list items inside tool summary */
.msg-markdown :deep(.tool-summary-content > ul) {
  margin: 0;
  padding: 2px 8px;
  list-style: none;
}

.msg-markdown :deep(.tool-summary-content > ul > li) {
  margin: 1px 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.45;
  padding: 3px 8px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.12s;
}

.msg-markdown :deep(.tool-summary-content > ul > li:hover) {
  background: rgba(255, 255, 255, 0.04);
}

.msg-markdown :deep(.tool-summary-content > ul > li::before) {
  display: none;
}

/* Color-coded action prefix badges */
.msg-markdown :deep(.tool-summary-content > ul > li) {
  border-left: 2px solid rgba(255, 255, 255, 0.08);
}

.msg-markdown :deep(.tool-summary-content > ul > li:has(strong)) {
  border-left-color: rgba(255, 255, 255, 0.12);
}

/* ─── 语法高亮 ─────────────────────────────────────── */
.msg-markdown :deep(.tok-keyword) {
  color: #c678dd; /* 紫色 - 关键字 */
}
.msg-markdown :deep(.tok-string) {
  color: #98c379; /* 绿色 - 字符串 */
}
.msg-markdown :deep(.tok-number) {
  color: #d19a66; /* 橙色 - 数字 */
}
.msg-markdown :deep(.tok-comment) {
  color: #5c6370; /* 灰色 - 注释 */
  font-style: italic;
}
.msg-markdown :deep(.tok-type) {
  color: #e5c07b; /* 黄色 - 类型/类名 */
}
.msg-markdown :deep(.tok-function) {
  color: #61afef; /* 蓝色 - 函数调用 */
}
.msg-markdown :deep(.tok-boolean) {
  color: #d19a66; /* 橙色 - 布尔值 */
}
.msg-markdown :deep(.tok-decorator) {
  color: #e06c75; /* 红色 - 装饰器/注解 */
}
.msg-markdown :deep(.tok-variable) {
  color: #56b6c2; /* 青色 - 变量引用 $var */
}
</style>
