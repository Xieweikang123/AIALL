<template>
  <div class="cursor-actions-block">
    <details v-if="collapsedCards.length" class="cursor-actions-fold">
      <summary class="cursor-actions-fold-summary">
        <span class="fold-badge">{{ block.collapsed.length }}</span>
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

    <template v-if="mergedCards.length">
      <details class="cursor-actions-fold cursor-actions-merge">
        <summary class="cursor-actions-fold-summary">
          <span class="fold-badge">{{ mergedCards.length }}</span>
          {{ mergedSummary }}
        </summary>
        <div class="cursor-actions-fold-body">
          <AggregateToolCard
            v-for="card in mergedCards"
            :key="`m-${card.key}`"
            :card="card"
          />
        </div>
      </details>
    </template>

    <AggregateToolCard
      v-for="card in otherVisibleCards"
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
  type ToolAggregateCard,
} from "../services/agentToolAggregates";
import type { AgentToolStep } from "../utils/toolHelpers";
import AggregateToolCard from "./AggregateToolCard.vue";

type ActionItem = { key: string; step: AgentToolStep };
type ActionsBlock = { kind: "actions"; key: string; collapsed: ActionItem[]; visible: ActionItem[] };

const FILE_MERGE_THRESHOLD = 3;

const props = defineProps<{ block: ActionsBlock }>();

const allVisibleCards = computed(() =>
  aggregateToolSteps(props.block.visible.map((item) => item.step)),
);

const mergedCards = computed(() => {
  if (allVisibleCards.value.length < FILE_MERGE_THRESHOLD) return [];
  return allVisibleCards.value;
});

const otherVisibleCards = computed(() => {
  const merged = new Set(mergedCards.value.map((c) => c.key));
  return allVisibleCards.value.filter((c) => !merged.has(c.key));
});

const mergedSummary = computed(() => {
  const cards = mergedCards.value;
  if (!cards.length) return "";
  const totalSteps = cards.reduce((sum, c) => sum + c.stepCount, 0);
  const names = cards.map((c) => c.title);
  const nameList = names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")}…`;
  return `${totalSteps} 步 · ${nameList}`;
});

const collapsedCards = computed(() =>
  aggregateToolSteps(props.block.collapsed.map((item) => item.step)),
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
  gap: 3px;
  min-width: 0;
  margin: 6px 0;
  padding: 4px 0;
  animation: action-block-reveal 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
  overflow: hidden;
}

@keyframes action-block-reveal {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.cursor-actions-fold {
  margin: 0;
}

.cursor-actions-fold-summary {
  list-style: none;
  font-size: 10px;
  line-height: 1.3;
  color: rgba(148, 163, 184, 0.6);
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
  color: rgba(255, 255, 255, 0.3);
}

.fold-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 14px;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.7);
  background: rgba(148, 163, 184, 0.1);
  border-radius: 7px;
  margin-right: 4px;
}

.cursor-actions-fold[open] > .cursor-actions-fold-summary::before {
  content: "▾ ";
}

.cursor-actions-fold-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 1px;
  padding-left: 8px;
}

.cursor-actions-merge > .cursor-actions-fold-summary {
  color: rgba(148, 163, 184, 0.65);
}
</style>
