<script setup lang="ts">
import { computed, onMounted, onUpdated, ref, nextTick } from "vue";
import { renderMarkdown } from "../utils/renderMarkdown";

const props = defineProps<{
  content: string;
}>();

const emit = defineEmits<{
  (e: "apply-block", index: number): void;
}>();

const markdownRef = ref<HTMLElement | null>(null);

const html = computed(() => renderMarkdown(props.content));

function bindButtons() {
  if (!markdownRef.value) return;
  markdownRef.value.querySelectorAll(".code-block-apply-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number((btn as HTMLElement).dataset.blockIndex);
      emit("apply-block", idx);
    });
  });
}

onMounted(() => {
  nextTick(bindButtons);
});

onUpdated(() => {
  nextTick(bindButtons);
});
</script>

<template>
  <div v-if="html" ref="markdownRef" class="msg-markdown" v-html="html" />
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

.msg-markdown :deep(.code-block-wrapper) {
  position: relative;
  margin: 0.75em 0;
  max-width: 100%;
  overflow-x: auto;
}

.msg-markdown :deep(.code-block-wrapper pre) {
  margin: 0;
}

.msg-markdown :deep(.code-block-apply-btn) {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 10px;
  font-size: 11px;
  font-family: inherit;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(31, 111, 235, 0.2);
  border: 1px solid rgba(31, 111, 235, 0.4);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  z-index: 1;
}

.msg-markdown :deep(.code-block-apply-btn:hover) {
  background: rgba(31, 111, 235, 0.35);
  border-color: rgba(31, 111, 235, 0.6);
  color: #fff;
}
</style>
