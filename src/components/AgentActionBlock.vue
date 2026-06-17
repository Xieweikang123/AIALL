<template>
  <div class="cursor-actions-block">
    <details v-if="collapsedCards.length" class="cursor-actions-fold">
      <summary class="cursor-actions-fold-summary">
        {{ collapsedSummary }}
      </summary>
      <div class="cursor-actions-fold-body">
        <AggregateToolCard
          v-for="card in collapsedCards"
          :key="`c-${card.key}`"
          :card="card"
        />
      </div>
    </details>

    <AggregateToolCard
      v-for="card in visibleCards"
      :key="card.key"
      :card="card"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { CursorFeedProcessBlock } from "../services/agentCursorFeed";
import {
  aggregateToolSteps,
  summarizeAggregateSteps,
} from "../services/agentToolAggregates";
import type { AgentToolStep } from "../utils/toolHelpers";
import AggregateToolCard from "./AggregateToolCard.vue";

type ActionItem = { key: string; step: AgentToolStep };
type ActionsBlock = { kind: "actions"; key: string; collapsed: ActionItem[]; visible: ActionItem[] };

const props = defineProps<{ block: ActionsBlock }>();

const collapsedCards = computed(() =>
  aggregateToolSteps(props.block.collapsed.map((item) => item.step)),
);

const visibleCards = computed(() =>
  aggregateToolSteps(props.block.visible.map((item) => item.step)),
);

const collapsedSummary = computed(() => {
  const steps = props.block.collapsed.map((item) => item.step);
  if (!steps.length) return "";
  return summarizeAggregateSteps(steps) || `${steps.length} 个步骤已折叠`;
});
</script>

<style scoped>
.cursor-actions-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 12px;
  border-left: 2px solid rgba(88, 166, 255, 0.12);
  min-width: 0;
  margin: 2px 0;
}

.cursor-actions-fold {
  margin: 0;
}

.cursor-actions-fold-summary {
  list-style: none;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}

.cursor-actions-fold-summary::-webkit-details-marker {
  display: none;
}

.cursor-actions-fold-summary::before {
  content: "▸ ";
  font-size: 9px;
  color: rgba(139, 148, 158, 0.55);
}

.cursor-actions-fold[open] > .cursor-actions-fold-summary::before {
  content: "▾ ";
}

.cursor-actions-fold-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding-left: 2px;
}
</style>
