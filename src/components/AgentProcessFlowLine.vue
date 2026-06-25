<template>
  <div
    v-if="chips.length"
    class="process-flow-line"
    :class="{ 'process-flow-line--live': isRunning }"
  >
    <template v-for="(chip, index) in chips" :key="chip.key">
      <span v-if="index > 0" class="process-flow-sep" aria-hidden="true">·</span>
      <button
        v-if="chip.path"
        type="button"
        class="process-flow-chip"
        :class="{ 'process-flow-chip--active': chip.running }"
        :title="chip.fullLabel"
        @click="emit('open-file', chip.path)"
      >
        {{ chip.label }}
      </button>
      <span
        v-else
        class="process-flow-chip"
        :class="{ 'process-flow-chip--active': chip.running }"
        :title="chip.fullLabel"
      >
        {{ chip.label }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatCursorActionLabel } from "../services/agentCursorFeed";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import { getToolPath } from "../utils/toolHelpers";

const props = withDefaults(
  defineProps<{
    tools: AgentRoundTool[];
    isRunning?: boolean;
    maxVisible?: number;
  }>(),
  { isRunning: false, maxVisible: 6 },
);

const emit = defineEmits<{
  "open-file": [path: string];
}>();

type FlowChip = {
  key: string;
  label: string;
  fullLabel: string;
  path?: string;
  running?: boolean;
};

const chips = computed((): FlowChip[] => {
  const steps = props.tools;
  if (!steps.length) return [];

  const hidden = Math.max(0, steps.length - props.maxVisible);
  const visible = hidden > 0 ? steps.slice(-props.maxVisible) : steps;
  const result: FlowChip[] = [];

  if (hidden > 0) {
    result.push({
      key: "hidden",
      label: `+${hidden}`,
      fullLabel: `另有 ${hidden} 步`,
    });
  }

  for (const step of visible) {
    const fullLabel = formatCursorActionLabel(step);
    const path = getToolPath(step)?.trim() || "";
    let label = fullLabel;
    if (path && fullLabel.includes(path)) {
      const shortPath = path.split("/").slice(-2).join("/");
      label = fullLabel.replace(path, shortPath);
    }
    result.push({
      key: step.id,
      label,
      fullLabel,
      path: path || undefined,
      running: step.running,
    });
  }

  return result;
});
</script>

<style scoped>
.process-flow-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 2px 0 6px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(148, 163, 184, 0.82);
}

.process-flow-line--live {
  padding-bottom: 4px;
}

.process-flow-sep {
  opacity: 0.45;
  user-select: none;
}

.process-flow-chip {
  display: inline;
  max-width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.process-flow-chip {
  cursor: pointer;
  color: rgba(165, 214, 255, 0.88);
}

button.process-flow-chip:hover {
  color: rgba(190, 228, 255, 0.98);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.process-flow-chip--active {
  color: rgba(126, 182, 255, 0.96);
}
</style>
