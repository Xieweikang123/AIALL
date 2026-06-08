<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
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

const html = computed(() => renderMarkdown(renderSource.value));
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
</style>
