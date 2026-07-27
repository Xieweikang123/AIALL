<template>
  <div
    class="cm-node"
    :class="[
      `cm-node--${data.kind}`,
      { 'cm-node--selected': selected, 'cm-node--truncated': data.truncated },
    ]"
  >
    <Handle type="target" :position="Position.Top" />
    <div class="cm-node-head">
      <span class="cm-node-kind">{{ kindLabel(data.kind) }}</span>
      <button
        v-if="data.collapsible"
        type="button"
        class="cm-node-collapse"
        :title="data.collapsed ? '展开子节点' : '折叠子节点'"
        :aria-label="data.collapsed ? '展开子节点' : '折叠子节点'"
        :aria-expanded="!data.collapsed"
        @click.stop="data.onToggleCollapse?.()"
      >
        {{ data.collapsed ? "+" : "−" }}
      </button>
    </div>
    <div class="cm-node-label">{{ data.label }}</div>
    <div v-if="data.summary" class="cm-node-summary">{{ data.summary }}</div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import { kindLabel, type CodeMapNodeKind } from "../../../shared/codeMapTypes";

withDefaults(
  defineProps<{
    id: string;
    type?: string;
    selected?: boolean;
    connectable?: boolean;
    position?: { x: number; y: number };
    dimensions?: { width: number; height: number };
    dragging?: boolean;
    zIndex?: number;
    data: {
      kind: CodeMapNodeKind;
      label: string;
      summary?: string;
      path?: string;
      truncated?: boolean;
      collapsed?: boolean;
      collapsible?: boolean;
      onToggleCollapse?: () => void;
    };
  }>(),
  {
    type: "codeMap",
    selected: false,
    connectable: true,
    dragging: false,
    zIndex: 0,
  },
);
</script>

<style scoped>
.cm-node {
  min-width: 140px;
  max-width: 220px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  background: var(--bg-secondary, rgba(17, 24, 39, 0.85));
  color: var(--text, rgba(255, 255, 255, 0.92));
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
}

.cm-node--selected {
  border-color: var(--accent-color, #58a6ff);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent);
}

.cm-node--root {
  border-color: color-mix(in srgb, var(--primary, #1f6feb) 55%, transparent);
  background: color-mix(in srgb, var(--primary, #1f6feb) 12%, var(--bg-secondary, rgba(17, 24, 39, 0.85)));
}

.cm-node--entry {
  border-color: color-mix(in srgb, var(--success-color, #3fb950) 45%, transparent);
}

.cm-node--route {
  border-color: color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent);
}

.cm-node--external {
  border-color: color-mix(in srgb, var(--success-color, #3fb950) 35%, transparent);
  border-style: dashed;
  background: var(--panel, rgba(17, 24, 39, 0.72));
}

.cm-node--truncated .cm-node-label {
  opacity: 0.85;
}

.cm-node-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}

.cm-node-kind {
  font-size: 10px;
  color: var(--muted, rgba(255, 255, 255, 0.62));
  letter-spacing: 0.02em;
}

.cm-node-collapse {
  border: none;
  background: var(--surface-hover, rgba(255, 255, 255, 0.06));
  color: var(--text, rgba(255, 255, 255, 0.92));
  width: 18px;
  height: 18px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.cm-node-label {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  word-break: break-word;
}

.cm-node-summary {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted, rgba(255, 255, 255, 0.62));
  line-height: 1.35;
}
</style>
