<template>
  <div v-if="showPlanChrome" class="plan-document">
    <div class="plan-document-head">
      <div class="plan-document-title">
        <span class="plan-document-badge">方案</span>
        <span v-if="streaming && display.isPartialPlan" class="plan-document-badge plan-document-badge--draft">
          生成中
        </span>
        <span v-if="display.files.length || display.codeBlockCount" class="plan-document-meta">
          <template v-if="display.files.length">{{ display.files.length }} 个文件</template>
          <template v-if="display.files.length && display.codeBlockCount"> · </template>
          <template v-if="display.codeBlockCount">{{ display.codeBlockCount }} 处代码</template>
        </span>
      </div>
      <button
        v-if="canExecute"
        type="button"
        class="plan-document-exec"
        title="按此方案开始改代码"
        @click="emit('execute')"
      >
        执行方案
      </button>
    </div>

    <details v-if="display.files.length" class="plan-files-fold" :open="filesExpanded">
      <summary class="plan-files-summary">涉及文件（{{ display.files.length }}）</summary>
      <ul class="plan-file-list">
        <li v-for="(file, index) in display.files" :key="`${file}-${index}`">
          <button type="button" class="plan-file-link" @click="scrollToFile(index)">
            {{ file }}
          </button>
        </li>
      </ul>
    </details>

    <div ref="bodyRef" class="plan-document-body">
      <slot />
    </div>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { computed, nextTick, onUpdated, ref, watch } from "vue";
import { parsePlanDocumentDisplay } from "../services/planDocumentDisplay";

const props = withDefaults(
  defineProps<{
    content: string;
    canExecute?: boolean;
    /** Only Plan mode messages use plan document chrome. */
    chatMode?: "ask" | "build" | "plan";
    /** When true, show raw markdown only (no plan chrome / anchors). */
    streaming?: boolean;
    /** When false, skip code-block folding (e.g. while streaming). */
    enhanceLayout?: boolean;
  }>(),
  { canExecute: false, streaming: false, enhanceLayout: true },
);

const emit = defineEmits<{
  execute: [];
}>();

const bodyRef = ref<HTMLElement | null>(null);
const display = computed(() => parsePlanDocumentDisplay(props.content));
const showPlanChrome = computed(() => props.chatMode === "plan" && display.value.isPlan);
const filesExpanded = computed(() => display.value.files.length <= (props.streaming ? 8 : 6));

function scrollToFile(index: number) {
  const root = bodyRef.value;
  if (!root) return;
  const target =
    root.querySelector(`#plan-file-${index}`) ??
    root.querySelector(`[id="plan-file-${index}"]`);
  if (target instanceof HTMLElement) {
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    target.classList.add("plan-file-anchor--flash");
    window.setTimeout(() => target.classList.remove("plan-file-anchor--flash"), 1200);
  }
}

function wrapPlanCodeBlocks(root: HTMLElement) {
  const pres = root.querySelectorAll("pre");
  pres.forEach((pre, index) => {
    if (pre.closest(".plan-code-fold")) return;
    const code = pre.querySelector("code");
    const langMatch = code?.className.match(/language-([\w-]+)/);
    const lang = langMatch?.[1];

    const details = document.createElement("details");
    details.className = "plan-code-fold";
    if (index < 2) details.open = true;

    const summary = document.createElement("summary");
    summary.className = "plan-code-summary";
    summary.textContent = lang ? `代码块 ${index + 1} · ${lang}` : `代码块 ${index + 1}`;

    const parent = pre.parentNode;
    if (!parent) return;
    parent.insertBefore(details, pre);
    details.appendChild(summary);
    details.appendChild(pre);
  });
}

function enhancePlanBody() {
  if (!props.enhanceLayout || props.streaming) return;
  const root = bodyRef.value;
  if (!root || !display.value.isPlan) return;
  wrapPlanCodeBlocks(root);
}

watch(
  () => [props.content, props.enhanceLayout, props.streaming] as const,
  () => {
    nextTick(enhancePlanBody);
  },
);

onUpdated(() => {
  enhancePlanBody();
});
</script>

<style scoped>
.plan-document {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 0;
}

.plan-document-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(88, 166, 255, 0.06);
  border: 1px solid rgba(88, 166, 255, 0.18);
}

.plan-document-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.plan-document-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(88, 166, 255, 0.16);
  color: rgba(165, 205, 255, 0.98);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.plan-document-badge--draft {
  background: rgba(210, 153, 34, 0.14);
  color: rgba(255, 214, 130, 0.96);
}

.plan-document-meta {
  color: rgba(139, 148, 158, 0.92);
  font-size: 12px;
}

.plan-document-exec {
  flex-shrink: 0;
  padding: 5px 14px;
  border-radius: 6px;
  border: 1px solid rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.12);
  color: rgba(190, 218, 255, 0.98);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.plan-document-exec:hover {
  background: rgba(88, 166, 255, 0.22);
  border-color: rgba(126, 182, 255, 0.72);
}

.plan-files-fold {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  overflow: hidden;
}

.plan-files-summary {
  padding: 8px 12px;
  cursor: pointer;
  color: rgba(201, 209, 217, 0.92);
  font-size: 12px;
  font-weight: 600;
  list-style: none;
  user-select: none;
}

.plan-files-summary::-webkit-details-marker {
  display: none;
}

.plan-files-summary::before {
  content: "▸ ";
  color: rgba(139, 148, 158, 0.85);
}

.plan-files-fold[open] .plan-files-summary::before {
  content: "▾ ";
}

.plan-file-list {
  margin: 0;
  padding: 0 12px 10px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plan-file-link {
  display: block;
  width: 100%;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(126, 182, 255, 0.95);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.plan-file-link:hover {
  background: rgba(88, 166, 255, 0.08);
}

.plan-document-body {
  padding: 0;
}

.plan-document-body :deep(.plan-file-anchor) {
  display: block;
  position: relative;
  top: -8px;
  height: 0;
  overflow: hidden;
}

.plan-document-body :deep(.plan-file-anchor--flash) {
  outline: 2px solid rgba(88, 166, 255, 0.55);
  outline-offset: 4px;
  border-radius: 4px;
}

.plan-document-body :deep(.plan-code-fold) {
  margin: 8px 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.plan-document-body :deep(.plan-code-summary) {
  padding: 6px 10px;
  cursor: pointer;
  color: rgba(201, 209, 217, 0.88);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  list-style: none;
  user-select: none;
}

.plan-document-body :deep(.plan-code-summary::-webkit-details-marker) {
  display: none;
}

.plan-document-body :deep(.plan-code-fold pre) {
  margin: 0;
  border-radius: 0;
  border: none;
}
</style>
