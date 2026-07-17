<template>
  <div
    class="cm-node"
    :class="[
      `cm-node--${data.kind}`,
      { 'cm-node--selected': selected, 'cm-node--collapsed': data.collapsed },
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
  border: 1px solid rgba(205, 214, 244, 0.18);
  background: #1e1e2e;
  color: #cdd6f4;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
}

.cm-node--selected {
  border-color: #89b4fa;
  box-shadow: 0 0 0 1px rgba(137, 180, 250, 0.45);
}

.cm-node--root {
  border-color: rgba(203, 166, 247, 0.55);
  background: #252536;
}

.cm-node--entry {
  border-color: rgba(166, 227, 161, 0.45);
}

.cm-node--route {
  border-color: rgba(137, 180, 250, 0.45);
}

.cm-node--collapsed .cm-node-label {
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
  color: #a6adc8;
  letter-spacing: 0.02em;
}

.cm-node-collapse {
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: #cdd6f4;
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
  color: #a6adc8;
  line-height: 1.35;
}
</style>
