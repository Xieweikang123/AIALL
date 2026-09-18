<template>
  <div
    v-if="rows.length"
    class="process-step-list"
    :class="{ 'process-step-list--compact': compact, 'process-step-list--running': isRunning, 'process-step-list--debug': showDetail }"
    :style="{ '--rail-progress': `${railProgressPercent}%` }"
  >
    <div v-if="visibleRows.length > 1" class="process-step-rail-track" aria-hidden="true" />
    <div
      v-for="(row, index) in visibleRows"
      :key="row.key"
      class="process-step-wrap"
      :class="{
        'process-step-wrap--open': isDetailOpen(row.key),
        'process-step-wrap--running': row.state === 'running',
      }"
    >
      <div
        class="process-step"
        :class="[
          `process-step--${row.state}`,
          {
            'process-step--first': index === 0,
            'process-step--last': index === visibleRows.length - 1,
          },
        ]"
        :title="row.fullLabel"
        @click="showDetail && row.state !== 'running' && toggleDetail(row.key)"
      >
        <span class="process-step-node" aria-hidden="true" />
        <span class="process-step-prompt" aria-hidden="true">&gt;</span>
        <span class="process-step-verb">{{ row.command }}</span>
        <button
          v-if="row.path"
          type="button"
          class="process-step-target"
          @click.stop="emit('open-file', row.path)"
        >
          {{ row.target }}
        </button>
        <span v-else class="process-step-target process-step-target--plain">{{ row.target }}</span>
        <span v-if="row.meta" class="process-step-meta">{{ row.meta }}</span>
        <span
          v-if="showDetail"
          class="process-step-chevron"
          :class="{ 'process-step-chevron--open': isDetailOpen(row.key) }"
          aria-hidden="true"
        >
          {{ isDetailOpen(row.key) ? "▾" : "▸" }}
        </span>
      </div>
      <div
        v-if="row.state === 'running'"
        class="process-step-live-progress"
        aria-hidden="true"
      >
        <div class="process-step-live-progress-bar" />
      </div>
      <div
        v-if="showDetail && isDetailOpen(row.key)"
        class="process-step-detail"
      >
        <div v-if="row.argSummary" class="process-step-detail-block">
          <span class="process-step-detail-label">参数</span>
          <pre class="trace-pre compact">{{ row.argSummary }}</pre>
        </div>
        <div v-if="row.resultPreview" class="process-step-detail-block">
          <span class="process-step-detail-label">结果</span>
          <pre class="trace-pre">{{ row.resultPreview }}</pre>
        </div>
      </div>
    </div>
    <button
      v-if="!expanded && hiddenCount > 0"
      type="button"
      class="process-step-more"
      @click="expanded = true"
    >
      展开全部 {{ rows.length }} 步（另有 {{ hiddenCount }} 步）
    </button>
    <button
      v-else-if="expanded && rows.length > defaultVisible"
      type="button"
      class="process-step-more"
      @click="expanded = false"
    >
      收起较早步骤
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  cursorActionClass,
  formatCursorActionLabel,
  formatRunningToolElapsedLabel,
} from "../services/agentCursorFeed";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import { getToolCommand, getToolPath } from "../utils/toolHelpers";

const props = withDefaults(
  defineProps<{
    tools: AgentRoundTool[];
    isRunning?: boolean;
    defaultVisible?: number;
    compact?: boolean;
    showDetail?: boolean;
  }>(),
  { isRunning: false, defaultVisible: 8, compact: false, showDetail: false },
);

const emit = defineEmits<{
  "open-file": [path: string];
}>();

const expanded = ref(false);
const detailOpenKeys = ref<Set<string>>(new Set());
/** 1s clock for running-tool elapsed labels; only ticks while a row is running. */
const nowMs = ref(Date.now());
let elapsedTickTimer: ReturnType<typeof setInterval> | null = null;

const hasRunningTool = computed(() => props.tools.some((tool) => tool.running));

function stopElapsedTick() {
  if (elapsedTickTimer) {
    clearInterval(elapsedTickTimer);
    elapsedTickTimer = null;
  }
}

function startElapsedTick() {
  if (elapsedTickTimer) return;
  nowMs.value = Date.now();
  elapsedTickTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
}

watch(
  hasRunningTool,
  (running) => {
    if (running) startElapsedTick();
    else stopElapsedTick();
  },
  { immediate: true },
);

onUnmounted(stopElapsedTick);

watch(
  () => props.tools.length,
  () => {
    expanded.value = false;
    detailOpenKeys.value = new Set();
  },
);

function isDetailOpen(key: string): boolean {
  return detailOpenKeys.value.has(key);
}

function toggleDetail(key: string) {
  const next = new Set(detailOpenKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  detailOpenKeys.value = next;
}

type StepRow = {
  key: string;
  command: string;
  target: string;
  meta: string;
  path?: string;
  state: string;
  fullLabel: string;
  argSummary: string;
  resultPreview: string;
};

const MAX_ARG_CHARS = 100000;
const MAX_RESULT_CHARS = 200000;

function formatArgs(tool: AgentRoundTool): string {
  if (!tool.args) return "";
  try {
    return JSON.stringify(tool.args, null, 2);
  } catch {
    return String(tool.args);
  }
}

function truncateForPreview(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return parts.slice(-2).join("/");
}

function extractMeta(step: AgentRoundTool): string {
  if (step.running) {
    // Depend on nowMs so only this list re-renders on the 1s tick.
    void nowMs.value;
    return formatRunningToolElapsedLabel({
      name: step.name,
      args: step.args,
      startTs: step.startTs,
      now: nowMs.value,
    });
  }

  const summary = step.summary?.trim() ?? "";
  if (step.ok === false && /超时/.test(summary)) return summary;

  const lineMatch = summary.match(/(\d+)\s*行/);
  if (lineMatch) return `${lineMatch[1]} 行`;

  const linesMatch = summary.match(/(\d+)\s*lines?/i);
  if (linesMatch) return `${linesMatch[1]} 行`;

  const detailTail = step.detail?.includes(" · ")
    ? step.detail.split(" · ").slice(1).join(" · ").trim()
    : "";
  if (detailTail && detailTail !== step.detail) {
    const detailLines = detailTail.match(/(\d+)\s*lines?/i);
    if (detailLines) return `${detailLines[1]} 行`;
  }

  if (step.lineDelta && step.lineDelta > 0) return `+${step.lineDelta}`;

  if (step.name === "grep" || step.name === "search_files") {
    const hitMatch = summary.match(/(\d+)/);
    if (hitMatch) return `${hitMatch[1]} 命中`;
  }

  if (step.ok === false && /命令超时/.test(step.fullResult ?? "")) return "超时";

  return "";
}

function buildRow(step: AgentRoundTool): StepRow {
  const path = getToolPath(step)?.trim() || "";
  const fullLabel = formatCursorActionLabel(step);
  const command = getToolCommand(step.name);

  // 搜索类工具：target 直接用搜索词（query/pattern），不要从 fullLabel 里剥出
  // "symbols Ingress" 这类被前缀污染的结果。
  const searchQuery = String(
    step.args?.query ?? step.args?.pattern ?? step.args?.q ?? "",
  ).trim();

  let target: string;
  if (searchQuery && (step.name === "grep" || step.name === "search_files" || step.name === "search_symbols")) {
    target = searchQuery;
  } else if (path) {
    target = shortPath(path);
  } else {
    target = step.detail?.split(" · ")[0]?.trim() || fullLabel;
    if (!path && /^(Read|Edited|Searched|Explored|Deleted|Reading|Editing)\s/i.test(fullLabel)) {
      const stripped = fullLabel.replace(/^(Read|Edited|Searched|Explored|Deleted|Reading|Editing)\s+/i, "");
      target = stripped.split(" · ")[0]?.trim() || target;
    }
  }

  return {
    key: step.id,
    command,
    target,
    meta: extractMeta(step),
    path: path || undefined,
    state: cursorActionClass(step),
    fullLabel,
    argSummary: formatArgs(step) ? truncateForPreview(formatArgs(step), MAX_ARG_CHARS) : "",
    resultPreview: step.fullResult ? truncateForPreview(step.fullResult, MAX_RESULT_CHARS) : "",
  };
}

const rows = computed(() => props.tools.map(buildRow));

const hiddenCount = computed(() => Math.max(0, rows.value.length - props.defaultVisible));

const visibleRows = computed(() => {
  if (expanded.value || hiddenCount.value === 0) return rows.value;
  return rows.value.slice(-props.defaultVisible);
});

const railProgressPercent = computed(() => {
  const list = visibleRows.value;
  if (list.length <= 1) return 0;

  const runningIdx = list.findIndex((row) => row.state === "running");
  if (runningIdx >= 0) {
    return Math.min(100, ((runningIdx + 0.45) / (list.length - 1)) * 100);
  }

  let lastDone = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const state = list[i]?.state;
    if (state === "done" || state === "fail" || state === "skipped" || state === "unknown") {
      lastDone = i;
      break;
    }
  }
  if (lastDone < 0) return 0;
  return Math.min(100, (lastDone / (list.length - 1)) * 100);
});
</script>

<style scoped>
.process-step-list {
  --step-rail-x: 14px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  max-height: 240px;
  overflow-y: auto;
  padding: 2px 0 2px 2px;
  border-radius: 0;
  background: transparent;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.process-step-list--running {
  max-height: none;
}

.process-step-list--compact {
  max-height: 160px;
  --step-rail-x: 12px;
}

.process-step-rail-track {
  position: absolute;
  left: var(--step-rail-x);
  top: 20px;
  bottom: 20px;
  width: 2px;
  border-radius: 1px;
  background: rgba(148, 163, 184, 0.14);
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 0;
}

.process-step-rail-track::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: var(--rail-progress, 0%);
  border-radius: 1px;
  background: linear-gradient(
    180deg,
    rgba(88, 166, 255, 0.35),
    rgba(88, 166, 255, 0.72),
    rgba(126, 182, 255, 0.88)
  );
  transition: height 0.35s ease;
}

.process-step-list--compact .process-step-rail-track {
  top: 16px;
  bottom: 16px;
}

.process-step-list--compact .process-step {
  min-height: 24px;
  padding: 2px 6px 2px 4px;
  font-size: 10px;
  grid-template-columns: 12px 8px minmax(0, 62px) minmax(0, 1fr) auto auto;
}

.process-step-list::-webkit-scrollbar {
  width: 4px;
}

.process-step-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.process-step {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 14px 8px minmax(0, 68px) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 3px 6px 3px 4px;
  font-size: 11.5px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.72);
  transition: color 160ms ease;
}

.process-step-wrap--open > .process-step {
  background: transparent;
}

.process-step-wrap--running {
  margin: 1px 0 2px;
}

.process-step-chevron {
  flex-shrink: 0;
  font-size: 9px;
  color: rgba(126, 182, 255, 0.7);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.process-step-chevron--open {
  transform: rotate(90deg);
}

.process-step-list--debug .process-step-wrap > .process-step:not(.process-step--running) {
  cursor: pointer;
}

.process-step-list--debug .process-step-wrap > .process-step:hover {
  background: rgba(255, 255, 255, 0.03);
}

.process-step-node {
  justify-self: center;
  width: 7px;
  height: 7px;
  border-radius: 1px;
  border: 1px solid rgba(148, 163, 184, 0.36);
  background: rgba(3, 4, 6, 0.96);
  box-sizing: border-box;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.process-step--running .process-step-node {
  border-color: rgba(88, 166, 255, 0.95);
  background: rgba(88, 166, 255, 0.28);
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.12);
  animation: process-step-node-pulse 1.2s ease-in-out infinite;
}

@keyframes process-step-node-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.12); }
  50% { box-shadow: 0 0 0 5px rgba(88, 166, 255, 0.06); }
}

.process-step--done .process-step-node,
.process-step--fail .process-step-node,
.process-step--skipped .process-step-node {
  border-color: rgba(88, 166, 255, 0.62);
  background: rgba(88, 166, 255, 0.5);
}

.process-step--fail .process-step-node {
  border-color: rgba(255, 123, 114, 0.75);
  background: rgba(255, 123, 114, 0.45);
}

.process-step--skipped .process-step-node {
  border-color: rgba(210, 153, 34, 0.65);
  background: rgba(210, 153, 34, 0.4);
}

/* 结果未回传（如连接中断）：中性空心点，不与真实失败的红点混同 */
.process-step--unknown .process-step-node {
  border-color: rgba(148, 163, 184, 0.55);
  background: rgba(148, 163, 184, 0.16);
}

.process-step--unknown {
  color: rgba(148, 163, 184, 0.72);
}

/* 运行中：字阶抬高 + 行下进度；已完成步骤压暗，形成主次 */
.process-step--running {
  background: transparent;
  color: rgba(220, 232, 245, 0.96);
}

.process-step--running .process-step-verb {
  color: rgba(165, 214, 255, 1);
}

.process-step--running .process-step-target,
.process-step--running .process-step-target--plain {
  color: rgba(230, 237, 243, 0.95);
}

.process-step--running .process-step-prompt {
  color: rgba(126, 182, 255, 1);
}

.process-step--done {
  color: rgba(148, 163, 184, 0.52);
}

.process-step--done .process-step-verb {
  color: rgba(126, 182, 255, 0.48);
  font-weight: 500;
}

.process-step--done .process-step-target,
.process-step--done .process-step-target--plain {
  color: rgba(148, 163, 184, 0.58);
}

.process-step--done .process-step-prompt {
  color: rgba(88, 166, 255, 0.4);
}

.process-step-live-progress {
  position: relative;
  z-index: 1;
  height: 1.5px;
  margin: 0 4px 3px 28px;
  overflow: hidden;
  border-radius: 1px;
  background: rgba(88, 166, 255, 0.12);
}

.process-step-live-progress-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 38%;
  background: linear-gradient(
    90deg,
    rgba(31, 111, 235, 0),
    rgba(31, 111, 235, 0.85),
    rgba(88, 166, 255, 0.95),
    rgba(31, 111, 235, 0.85),
    rgba(31, 111, 235, 0)
  );
  animation: process-step-live-progress 1.35s ease-in-out infinite;
}

@keyframes process-step-live-progress {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

.process-step--fail {
  color: rgba(255, 180, 171, 0.92);
}

.process-step--skipped {
  color: rgba(210, 180, 120, 0.88);
}

.process-step-prompt {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: rgba(88, 166, 255, 0.85);
  text-align: center;
  user-select: none;
}

.process-step-verb {
  flex-shrink: 0;
  color: rgba(126, 182, 255, 0.78);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-step-target {
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(186, 196, 208, 0.82);
  font: inherit;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-step-target--plain {
  color: rgba(186, 196, 208, 0.78);
}

button.process-step-target {
  cursor: pointer;
}

button.process-step-target:hover {
  color: rgba(190, 228, 255, 0.98);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.process-step-meta {
  flex-shrink: 0;
  color: rgba(148, 163, 184, 0.55);
  font-variant-numeric: tabular-nums;
}

.process-step--running .process-step-meta {
  color: rgba(126, 182, 255, 0.78);
}

.process-step-more {
  align-self: flex-start;
  margin: 4px 8px 2px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(126, 182, 255, 0.82);
  font-size: 11px;
  cursor: pointer;
}

.process-step-more:hover {
  color: rgba(165, 214, 255, 0.98);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.process-step-detail {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px 8px 44px;
}

.process-step-detail-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.process-step-detail-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(139, 148, 158, 0.55);
}

.trace-pre {
  margin: 0;
  padding: 6px 8px;
  border-radius: 2px;
  background: rgba(1, 4, 9, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  max-width: 100%;
  max-height: 140px;
  overflow-x: hidden;
  overflow-y: auto;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  color: rgba(139, 148, 158, 0.82);
}

@media (prefers-reduced-motion: reduce) {
  .process-step--running .process-step-node {
    animation: none;
  }

  .process-step-rail-track::after {
    transition: none;
  }

  .process-step-live-progress-bar {
    animation: none;
    width: 100%;
    background: linear-gradient(90deg, rgba(31, 111, 235, 0.85), rgba(88, 166, 255, 0.95));
  }
}
</style>
