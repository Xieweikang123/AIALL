<template>
  <div class="cursor-actions-block">
    <details v-if="block.collapsed.length" class="cursor-actions-fold">
      <summary class="cursor-actions-fold-summary">
        {{ collapsedSummary }}
      </summary>
      <div class="cursor-actions-fold-body">
        <CursorToolStepRow
          v-for="item in block.collapsed"
          :key="item.key"
          :step="item.step"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>
    </details>

    <CursorToolStepRow
      v-for="item in block.visible"
      :key="item.key"
      :step="item.step"
      @open-file="(path) => emit('openFile', path)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import CursorToolStepRow from "./CursorToolStepRow.vue";
import { formatCollapsedStepsSummary } from "../services/agentCursorFeed";
import type { AgentToolStep } from "../utils/toolHelpers";

type ActionItem = { key: string; step: AgentToolStep };
type ActionsBlock = { kind: "actions"; key: string; collapsed: ActionItem[]; visible: ActionItem[] };

const props = defineProps<{ block: ActionsBlock }>();

const emit = defineEmits<{
  openFile: [path: string];
}>();

const collapsedSummary = computed(() =>
  formatCollapsedStepsSummary(props.block.collapsed.map((item) => item.step)),
);
</script>

<style scoped>
.cursor-actions-block {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  margin: 2px 0;
  padding: 0;
}

.cursor-actions-fold {
  margin: 0 0 2px;
}

.cursor-actions-fold-summary {
  list-style: none;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(148, 163, 184, 0.58);
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.cursor-actions-fold-summary::-webkit-details-marker {
  display: none;
}

.cursor-actions-fold-summary::before {
  content: "▸ ";
  font-size: 8px;
  color: rgba(148, 163, 184, 0.35);
}

.cursor-actions-fold[open] > .cursor-actions-fold-summary::before {
  content: "▾ ";
}

.cursor-actions-fold-summary:hover {
  color: rgba(165, 214, 255, 0.82);
}

.cursor-actions-fold-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 2px;
  padding-left: 10px;
  border-left: 1px solid rgba(148, 163, 184, 0.08);
}
</style>
