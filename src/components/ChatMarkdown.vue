<script setup lang="ts">
import { computed, nextTick, onUpdated, ref, watch } from "vue";
import { renderMarkdown } from "../utils/renderMarkdown";
import { parseAiOptions, type AiOption } from "../utils/parseAiOptions";
import AiOptionButtons from "./AiOptionButtons.vue";
import { stripTextToolCallMarkup } from "../services/textToolCallMarkup";

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
const renderSource = ref(props.content);

watch(
  () => props.content,
  (value) => {
    if (props.streaming) return;
    renderSource.value = value;
  },
  { immediate: true },
);

watch(
  () => props.streaming,
  (streaming) => {
    if (!streaming) {
      renderSource.value = props.content;
    }
  },
);

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

// Parse options from content (only when interactive and not streaming)
const parsedOptions = computed(() => {
  if (!props.interactive || props.streaming) return null;
  return parseAiOptions(renderSource.value);
});

const markdownContent = computed(() => {
  const parsed = parsedOptions.value;
  if (!parsed) return renderSource.value;
  return parsed.before;
});

const html = computed(() => renderMarkdown(stripTextToolCallMarkup(markdownContent.value)));

const streamingHtml = computed(() => renderMarkdown(stripTextToolCallMarkup(props.content)));

function handleOptionSelect(option: AiOption) {
  emit("selectOption", option);
}

// After render, wrap tool summary blocks
function postProcess() {
  nextTick(() => {
    if (markdownRef.value) {
      wrapToolSummaryBlocks(markdownRef.value);
    }
  });
}

// Trigger on html change
watch([html, streamingHtml, () => props.streaming], () => postProcess(), { immediate: true });
onUpdated(() => postProcess());
</script>

<template>
  <div
    v-if="streaming && content"
    ref="markdownRef"
    class="msg-markdown msg-markdown--streaming"
    v-html="streamingHtml"
  />
  <div v-else-if="html || parsedOptions?.options.length" ref="markdownRef" class="msg-markdown">
    <div v-if="html" v-html="html" />
    <AiOptionButtons
      v-if="parsedOptions?.options.length"
      :options="parsedOptions.options"
      @select="handleOptionSelect"
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
}

.msg-markdown--streaming {
  opacity: 0.98;
  animation: typing-fade-in 0.3s ease-out;
}

@keyframes typing-fade-in {
  from {
    opacity: 0.7;
    filter: blur(0.3px);
  }
  to {
    opacity: 0.98;
    filter: blur(0);
  }
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

.tool-summary-block {
  margin: 6px 0;
  border-radius: 6px;
  background: rgba(139, 148, 158, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
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

.tool-summary-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  cursor: pointer;
  user-select: none;
}

.tool-summary-header:hover {
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
