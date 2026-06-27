<template>
  <details v-if="previewLines.length" class="cursor-tool-row cursor-tool-row--details">
    <summary class="cursor-tool-row-summary">
      <span
        class="cursor-tool-row-label"
        :class="{
          'cursor-tool-row-label--running': step.running,
          'cursor-tool-row-label--failed': failed,
          'shimmer-text--fast': step.running,
        }"
      >
        {{ label }}
      </span>
    </summary>
    <ul class="cursor-tool-row-preview">
      <li v-for="(line, index) in previewLines" :key="index">{{ line }}</li>
    </ul>
  </details>

  <div v-else class="cursor-tool-row">
    <button
      v-if="filePath"
      type="button"
      class="cursor-tool-row-label cursor-tool-row-label--link"
      :class="{
        'cursor-tool-row-label--running': step.running,
        'cursor-tool-row-label--failed': failed,
        'shimmer-text--fast': step.running,
      }"
      :title="filePath"
      @click="emit('openFile', filePath)"
    >
      {{ label }}
    </button>
    <span
      v-else
      class="cursor-tool-row-label"
      :class="{
        'cursor-tool-row-label--running': step.running,
        'cursor-tool-row-label--failed': failed,
        'shimmer-text--fast': step.running,
      }"
    >
      {{ label }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatCursorActionLabel } from "../services/agentCursorFeed";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import { getToolPath } from "../utils/toolHelpers";

const props = defineProps<{
  step: AgentRoundTool;
}>();

const emit = defineEmits<{
  openFile: [path: string];
}>();

const label = computed(() => formatCursorActionLabel(props.step));
const failed = computed(() => !props.step.ok && !props.step.running);
const filePath = computed(() => {
  const path = getToolPath(props.step);
  return path || "";
});

const previewLines = computed((): string[] => {
  const raw = props.step.fullResult?.trim();
  if (!raw || raw === "（无匹配）" || raw === "（无匹配文件）") return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => (line.length > 96 ? `${line.slice(0, 96)}…` : line));
});
</script>

<style scoped>
.cursor-tool-row {
  min-width: 0;
  padding: 1px 0;
}

.cursor-tool-row-summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  padding: 1px 0;
}

.cursor-tool-row-summary::-webkit-details-marker {
  display: none;
}

.cursor-tool-row-summary::before {
  content: "▸ ";
  font-size: 8px;
  color: rgba(148, 163, 184, 0.35);
}

.cursor-tool-row--details[open] > .cursor-tool-row-summary::before {
  content: "▾ ";
}

.cursor-tool-row-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(201, 209, 217, 0.82);
}

.cursor-tool-row-label--link {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.cursor-tool-row-label--link:hover {
  color: rgba(126, 182, 255, 0.98);
  text-decoration: underline;
}

.cursor-tool-row-label--running {
  color: rgba(190, 218, 255, 0.92);
}

.cursor-tool-row-label--failed {
  color: rgba(248, 113, 113, 0.88);
}

.cursor-tool-row-preview {
  margin: 2px 0 4px 12px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cursor-tool-row-preview li {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
