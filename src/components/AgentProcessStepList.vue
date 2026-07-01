<template>
  <div v-if="rows.length" class="process-step-list" :class="{ 'process-step-list--compact': compact }">
    <div
      v-for="row in visibleRows"
      :key="row.key"
      class="process-step"
      :class="`process-step--${row.state}`"
      :title="row.fullLabel"
    >
      <span class="process-step-icon" aria-hidden="true">{{ row.icon }}</span>
      <span class="process-step-verb">{{ row.verb }}</span>
      <button
        v-if="row.path"
        type="button"
        class="process-step-target"
        @click="emit('open-file', row.path)"
      >
        {{ row.target }}
      </button>
      <span v-else class="process-step-target process-step-target--plain">{{ row.target }}</span>
      <span v-if="row.meta" class="process-step-meta">{{ row.meta }}</span>
      <span v-if="row.state === 'running'" class="process-step-spinner" aria-hidden="true" />
      <span v-else-if="row.state === 'fail'" class="process-step-mark process-step-mark--fail">✕</span>
      <span v-else-if="row.state === 'skipped'" class="process-step-mark process-step-mark--skip">−</span>
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
import { computed, ref, watch } from "vue";
import { cursorActionClass, formatCursorActionLabel } from "../services/agentCursorFeed";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import { getToolPath } from "../utils/toolHelpers";

const props = withDefaults(
  defineProps<{
    tools: AgentRoundTool[];
    isRunning?: boolean;
    defaultVisible?: number;
    compact?: boolean;
  }>(),
  { isRunning: false, defaultVisible: 8, compact: false },
);

const emit = defineEmits<{
  "open-file": [path: string];
}>();

const expanded = ref(false);

watch(
  () => props.tools.length,
  () => {
    expanded.value = false;
  },
);

type StepRow = {
  key: string;
  icon: string;
  verb: string;
  target: string;
  meta: string;
  path?: string;
  state: string;
  fullLabel: string;
};

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return parts.slice(-2).join("/");
}

function extractMeta(step: AgentRoundTool): string {
  const summary = step.summary?.trim() ?? "";
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

  return "";
}

function buildRow(step: AgentRoundTool): StepRow {
  const path = getToolPath(step)?.trim() || "";
  const fullLabel = formatCursorActionLabel(step);
  const verb = step.title?.trim() || step.label?.trim() || step.name;
  let target = path ? shortPath(path) : (step.detail?.split(" · ")[0]?.trim() || fullLabel);

  if (!path && /^(Read|Edited|Searched|Explored|Deleted|Reading|Editing)\s/i.test(fullLabel)) {
    const stripped = fullLabel.replace(/^(Read|Edited|Searched|Explored|Deleted|Reading|Editing)\s+/i, "");
    target = stripped.split(" · ")[0]?.trim() || target;
  }

  return {
    key: step.id,
    icon: step.icon || "•",
    verb,
    target,
    meta: extractMeta(step),
    path: path || undefined,
    state: cursorActionClass(step),
    fullLabel,
  };
}

const rows = computed(() => props.tools.map(buildRow));

const hiddenCount = computed(() => Math.max(0, rows.value.length - props.defaultVisible));

const visibleRows = computed(() => {
  if (expanded.value || hiddenCount.value === 0) return rows.value;
  return rows.value.slice(-props.defaultVisible);
});
</script>

<style scoped>
.process-step-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 240px;
  overflow-y: auto;
  padding: 2px 0;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.12);
}

.process-step-list--compact {
  max-height: 160px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
}

.process-step-list--compact .process-step {
  min-height: 24px;
  padding: 2px 6px;
  font-size: 10px;
  grid-template-columns: 16px 44px minmax(0, 1fr) auto 12px;
}

.process-step-list::-webkit-scrollbar {
  width: 4px;
}

.process-step-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.process-step {
  display: grid;
  grid-template-columns: 18px 52px minmax(0, 1fr) auto 14px;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 4px 8px;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(186, 196, 208, 0.88);
}

.process-step:hover {
  background: rgba(255, 255, 255, 0.03);
}

.process-step--running {
  background: rgba(88, 166, 255, 0.06);
  color: rgba(190, 218, 255, 0.92);
}

.process-step--fail {
  color: rgba(255, 180, 171, 0.92);
}

.process-step--skipped {
  color: rgba(210, 180, 120, 0.88);
}

.process-step-icon {
  font-size: 11px;
  opacity: 0.85;
  text-align: center;
}

.process-step-verb {
  flex-shrink: 0;
  color: rgba(148, 163, 184, 0.72);
  font-weight: 500;
}

.process-step-target {
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(165, 214, 255, 0.9);
  font: inherit;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-step-target--plain {
  color: rgba(201, 209, 217, 0.88);
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

.process-step-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(88, 166, 255, 0.22);
  border-top-color: rgba(88, 166, 255, 0.85);
  animation: process-step-spin 0.75s linear infinite;
}

.process-step-mark {
  font-size: 10px;
  text-align: center;
}

.process-step-mark--fail {
  color: rgba(255, 123, 114, 0.95);
}

.process-step-mark--skip {
  color: rgba(210, 153, 34, 0.9);
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

@keyframes process-step-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .process-step-spinner {
    animation: none;
  }
}
</style>
