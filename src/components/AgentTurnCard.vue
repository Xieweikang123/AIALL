<template>
  <div
    class="turn-card"
    :class="{
      'turn-card--running': running,
      'turn-card--compact': compact,
      'turn-card--tools-hidden': !showTools,
    }"
    :style="{ '--turn-index': turnIndex }"
  >
    <div v-if="turn.text" class="turn-card__thought">
      <ChatMarkdown :content="turn.text" :streaming="running" />
    </div>

    <template v-if="showToolRow">
      <div class="turn-card__tools">
        <AggregateToolCard
          v-for="card in displayedCards"
          :key="card.key"
          :card="card"
          :compact="useCompactSummary"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>

      <details v-if="overflowToolCards.length" class="turn-card__fold">
        <summary class="turn-card__fold-label">
          <span class="turn-card__fold-count">{{ overflowToolCards.length }}</span>
          <span class="turn-card__fold-text">更早工具步骤</span>
        </summary>
        <div class="turn-card__fold-body">
          <AggregateToolCard
            v-for="card in overflowToolCards"
            :key="card.key"
            :card="card"
            compact
            @open-file="(path) => emit('openFile', path)"
          />
        </div>
      </details>

      <details v-if="hasFoldedActions" class="turn-card__fold">
        <summary class="turn-card__fold-label">
          <span class="turn-card__fold-count">{{ foldedCount }}</span>
          <span class="turn-card__fold-text">更早步骤</span>
        </summary>
        <div class="turn-card__fold-body">
          <AggregateToolCard
            v-for="card in foldedCards"
            :key="card.key"
            :card="card"
            compact
            @open-file="(path) => emit('openFile', path)"
          />
        </div>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import AggregateToolCard from "./AggregateToolCard.vue";
import {
  aggregateToolSteps,
  type ToolAggregateCard,
} from "../services/agentToolAggregates";
import type { AgentToolStep } from "../utils/toolHelpers";

type ActionItem = { key: string; step: AgentToolStep };
type ActionsBlock = { kind: "actions"; key: string; visible: ActionItem[]; collapsed: ActionItem[] };

const props = defineProps<{
  turn: {
    key: string;
    text: string;
    actions: ActionsBlock[];
    isLatest: boolean;
  };
  running?: boolean;
  /** When false, hide tool chips (used for collapsed earlier turns). */
  showTools?: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  openFile: [path: string];
}>();

const turnIndex = computed(() => {
  const match = props.turn.key.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
});

const allSteps = computed(() =>
  props.turn.actions.flatMap((block) => block.visible.map((item) => item.step)),
);

const aggregatedCards = computed(() => aggregateToolSteps(allSteps.value));

const MAX_VISIBLE_TOOL_CARDS = 5;

const displayedCards = computed(() => {
  const cards = aggregatedCards.value;
  if (cards.length <= MAX_VISIBLE_TOOL_CARDS) return cards;
  return cards.slice(-MAX_VISIBLE_TOOL_CARDS);
});

const overflowToolCards = computed(() => {
  const cards = aggregatedCards.value;
  if (cards.length <= MAX_VISIBLE_TOOL_CARDS) return [];
  return cards.slice(0, cards.length - MAX_VISIBLE_TOOL_CARDS);
});

const showToolRow = computed(
  () => props.showTools !== false && displayedCards.value.length > 0,
);

/** Compact chip layout only for explicitly folded rows (earlier turns / earlier steps). */
const useCompactSummary = computed(() => Boolean(props.compact));

const foldedCards = computed(() => {
  const visibleKeys = new Set([
    ...displayedCards.value.map((c) => c.key),
    ...overflowToolCards.value.map((c) => c.key),
  ]);
  const addedKeys = new Set<string>();
  const cards: ToolAggregateCard[] = [];
  for (const block of props.turn.actions) {
    if (block.collapsed.length) {
      for (const card of aggregateToolSteps(block.collapsed.map((i) => i.step))) {
        if (!visibleKeys.has(card.key) && !addedKeys.has(card.key)) {
          addedKeys.add(card.key);
          cards.push(card);
        }
      }
    }
  }
  return cards;
});

const hasFoldedActions = computed(() => foldedCards.value.length > 0);

const foldedCount = computed(() =>
  props.turn.actions.reduce((sum, b) => sum + b.collapsed.length, 0),
);
</script>

<style scoped>
.turn-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-left: 2px solid rgba(88, 166, 255, 0.08);
  border-radius: 0 6px 6px 0;
  background: rgba(88, 166, 255, 0.015);
  animation: turn-reveal 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--turn-index, 0) * 40ms);
}

.turn-card--compact {
  padding: 4px 8px;
  border-left-color: rgba(148, 163, 184, 0.08);
  background: transparent;
  animation: none;
}

.turn-card--compact .turn-card__thought {
  font-size: 11.5px;
  color: rgba(148, 163, 184, 0.72);
}

.turn-card--tools-hidden {
  padding-bottom: 2px;
}

.turn-card--running {
  border-left-color: rgba(88, 166, 255, 0.4);
  background: rgba(88, 166, 255, 0.03);
}

@keyframes turn-reveal {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.turn-card__thought {
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(226, 232, 240, 0.9);
  word-break: break-word;
}

.turn-card__thought :deep(.msg-markdown) {
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

.turn-card__thought :deep(.msg-markdown p) {
  margin: 0 0 0.4em;
}

.turn-card__thought :deep(.msg-markdown p:last-child) {
  margin-bottom: 0;
}

.turn-card__thought :deep(.msg-markdown code) {
  font-size: 0.9em;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.12);
  color: rgba(226, 232, 240, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.08);
}

.turn-card__tools {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.turn-card__fold {
  margin: 0;
}

.turn-card__fold-label {
  display: flex;
  align-items: center;
  gap: 4px;
  list-style: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  color: rgba(148, 163, 184, 0.5);
  cursor: pointer;
  user-select: none;
  padding: 1px 0;
  transition: color 0.15s ease;
}

.turn-card__fold-label:hover {
  color: rgba(148, 163, 184, 0.7);
}

.turn-card__fold-label::-webkit-details-marker {
  display: none;
}

.turn-card__fold-label::before {
  content: "▸ ";
  font-size: 8px;
  color: rgba(148, 163, 184, 0.25);
}

.turn-card__fold[open] > .turn-card__fold-label::before {
  content: "▾ ";
}

.turn-card__fold-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 12px;
  padding: 0 3px;
  font-size: 8px;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.6);
  background: rgba(148, 163, 184, 0.1);
  border-radius: 6px;
}

.turn-card__fold-text {
  color: rgba(148, 163, 184, 0.4);
}

.turn-card__fold-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
  padding-left: 4px;
}
</style>
