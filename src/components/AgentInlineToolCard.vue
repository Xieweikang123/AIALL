<template>
  <div
    class="inline-tool-card"
    :class="[
      stateClass,
      { 'inline-tool-card--clickable': Boolean(openPath) },
    ]"
    :role="openPath ? 'button' : undefined"
    :tabindex="openPath ? 0 : undefined"
    @click="onClick"
    @keydown.enter.prevent="onClick"
  >
    <span class="inline-tool-card__icon" aria-hidden="true">{{ icon }}</span>
    <span class="inline-tool-card__label" :title="tooltip">{{ label }}</span>
    <span v-if="step.running" class="inline-tool-card__spinner" aria-hidden="true" />
    <span v-else-if="isSkipped" class="inline-tool-card__skip" aria-hidden="true">−</span>
    <span v-else-if="!step.ok" class="inline-tool-card__fail" aria-hidden="true">✕</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { cursorActionClass, formatCursorActionLabel } from "../services/agentCursorFeed";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import { getToolIcon, getToolPath } from "../utils/toolHelpers";

const props = defineProps<{
  step: AgentRoundTool;
}>();

const emit = defineEmits<{
  openFile: [path: string];
}>();

const label = computed(() => formatCursorActionLabel(props.step));

// 兼容旧数据：历史消息里 icon 可能是旧兜底的 ⚙️，用当前图标映射兜底
const icon = computed(() => {
  if (props.step.icon && props.step.icon !== "⚙️") return props.step.icon;
  return getToolIcon(props.step.name);
});

const tooltip = computed(() => {
  if (!props.step.ok && !props.step.running) {
    const summary = props.step.summary?.trim();
    if (summary) return summary;
  }
  return label.value;
});

const stateClass = computed(() => `inline-tool-card--${cursorActionClass(props.step)}`);

const isSkipped = computed(() => cursorActionClass(props.step) === "skipped");

const openPath = computed(() => {
  const path = getToolPath(props.step);
  return path?.trim() || "";
});

function onClick() {
  if (!openPath.value) return;
  emit("openFile", openPath.value);
}
</script>

<style scoped>
.inline-tool-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  margin: 4px 0;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(148, 163, 184, 0.06);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(201, 209, 217, 0.9);
  min-width: 0;
  animation: inline-tool-in 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.inline-tool-card--clickable {
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.inline-tool-card--clickable:hover {
  border-color: rgba(88, 166, 255, 0.35);
  background: rgba(88, 166, 255, 0.1);
  color: rgba(165, 214, 255, 0.98);
}

.inline-tool-card--running {
  border-color: rgba(88, 166, 255, 0.28);
  background: rgba(88, 166, 255, 0.08);
}

.inline-tool-card--fail {
  border-color: rgba(248, 81, 73, 0.35);
  background: rgba(248, 81, 73, 0.08);
  color: rgba(255, 180, 171, 0.95);
}

.inline-tool-card--skipped {
  border-color: rgba(210, 153, 34, 0.35);
  background: rgba(210, 153, 34, 0.08);
  color: rgba(240, 200, 120, 0.95);
}

.inline-tool-card__icon {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.88;
}

.inline-tool-card__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-tool-card__spinner {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(88, 166, 255, 0.25);
  border-top-color: rgba(88, 166, 255, 0.9);
  animation: inline-tool-spin 0.75s linear infinite;
}

.inline-tool-card__fail {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(255, 123, 114, 0.95);
}

.inline-tool-card__skip {
  flex-shrink: 0;
  font-size: 12px;
  color: rgba(210, 153, 34, 0.95);
}

@keyframes inline-tool-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes inline-tool-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .inline-tool-card {
    animation: none;
  }

  .inline-tool-card__spinner {
    animation: none;
    border-top-color: rgba(88, 166, 255, 0.55);
  }
}
</style>
