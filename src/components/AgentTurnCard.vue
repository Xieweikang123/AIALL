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
      <div v-if="useCompactSummary" class="turn-card__tools-summary">
        {{ toolsSummary }}
      </div>
      <div v-else class="turn-card__tools">
        <div
          v-for="card in aggregatedCards"
          :key="card.key"
          class="tool-chip"
          :class="chipClass(card)"
        >
          <span class="tool-chip__icon">{{ card.icon }}</span>
          <span class="tool-chip__name">{{ card.title }}</span>
          <span v-if="chipMeta(card)" class="tool-chip__meta">{{ chipMeta(card) }}</span>
        </div>
      </div>

      <details v-if="hasFoldedActions" class="turn-card__fold">
        <summary class="turn-card__fold-label">
          <span class="turn-card__fold-count">{{ foldedCount }}</span>
          <span class="turn-card__fold-text">更早步骤</span>
        </summary>
        <div class="turn-card__fold-body">
          <div
            v-for="card in foldedCards"
            :key="card.key"
            class="tool-chip tool-chip--dim"
          >
            <span class="tool-chip__icon">{{ card.icon }}</span>
            <span class="tool-chip__name">{{ card.title }}</span>
            <span v-if="chipMeta(card)" class="tool-chip__meta">{{ chipMeta(card) }}</span>
          </div>
        </div>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import {
  computeExplorationStats,
  formatExplorationSummary,
} from "../services/agentCursorFeed";
import {
  aggregateToolSteps,
  type ToolAggregateCard,
} from "../services/agentToolAggregates";
import type { AgentToolStep } from "../utils/toolHelpers";

const COMPACT_CHIP_THRESHOLD = 4;
const COMPACT_STEP_THRESHOLD = 6;

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

const turnIndex = computed(() => {
  const match = props.turn.key.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
});

const allSteps = computed(() =>
  props.turn.actions.flatMap((block) => block.visible.map((item) => item.step)),
);

const aggregatedCards = computed(() => aggregateToolSteps(allSteps.value));

const showToolRow = computed(
  () => props.showTools !== false && aggregatedCards.value.length > 0,
);

const useCompactSummary = computed(
  () =>
    aggregatedCards.value.length > COMPACT_CHIP_THRESHOLD ||
    allSteps.value.length > COMPACT_STEP_THRESHOLD,
);

const toolsSummary = computed(() =>
  formatExplorationSummary(computeExplorationStats(allSteps.value), Boolean(props.running)),
);

const foldedCards = computed(() => {
  const cards: ToolAggregateCard[] = [];
  for (const block of props.turn.actions) {
    if (block.collapsed.length) {
      cards.push(...aggregateToolSteps(block.collapsed.map((i) => i.step)));
    }
  }
  return cards;
});

const hasFoldedActions = computed(() => foldedCards.value.length > 0);

const foldedCount = computed(() =>
  props.turn.actions.reduce((sum, b) => sum + b.collapsed.length, 0),
);

function chipClass(card: ToolAggregateCard): string {
  const parts: string[] = [];
  if (card.running) parts.push("tool-chip--running");
  else if (card.failed) parts.push("tool-chip--fail");
  else parts.push(`tool-chip--${card.kind}`);
  return parts.join(" ");
}

function chipMeta(card: ToolAggregateCard): string {
  if (card.kind === "file" && card.stepCount > 1) return `×${card.stepCount}`;
  if (card.kind === "search") return `${card.stepCount}次`;
  if (card.kind === "edit") return card.subtitle;
  return "";
}
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
  flex-wrap: wrap;
  gap: 3px;
}

.turn-card__tools-summary {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(148, 163, 184, 0.55);
  padding: 1px 0;
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.06);
  border: 1px solid rgba(148, 163, 184, 0.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(148, 163, 184, 0.7);
  transition: background 0.15s ease;
  min-width: 0;
}

.tool-chip:hover {
  background: rgba(148, 163, 184, 0.1);
}

.tool-chip--file {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.tool-chip--file .tool-chip__name {
  color: rgba(255, 255, 255, 0.55);
}

.tool-chip--search {
  background: rgba(34, 197, 94, 0.06);
  border-color: rgba(34, 197, 94, 0.1);
}

.tool-chip--search .tool-chip__name {
  color: rgba(134, 239, 172, 0.85);
}

.tool-chip--edit {
  background: rgba(251, 146, 60, 0.06);
  border-color: rgba(251, 146, 60, 0.1);
}

.tool-chip--edit .tool-chip__name {
  color: rgba(253, 186, 116, 0.85);
}

.tool-chip--running {
  background: rgba(88, 166, 255, 0.08);
  border-color: rgba(88, 166, 255, 0.2);
  animation: chip-pulse 1.4s ease-in-out infinite;
}

.tool-chip--fail {
  background: rgba(248, 81, 73, 0.06);
  border-color: rgba(248, 81, 73, 0.12);
}

.tool-chip.tool-chip--dim,
.tool-chip.tool-chip--dim.tool-chip--file,
.tool-chip.tool-chip--dim.tool-chip--search,
.tool-chip.tool-chip--dim.tool-chip--edit,
.tool-chip.tool-chip--dim.tool-chip--misc {
  background: rgba(148, 163, 184, 0.04);
  border-color: rgba(148, 163, 184, 0.06);
  color: rgba(148, 163, 184, 0.6);
}

.tool-chip.tool-chip--dim .tool-chip__name,
.tool-chip.tool-chip--dim .tool-chip__meta,
.tool-chip.tool-chip--dim .tool-chip__icon {
  color: rgba(148, 163, 184, 0.5);
}

.tool-chip__icon {
  font-size: 10px;
  flex-shrink: 0;
}

.tool-chip__name {
  font-weight: 500;
  color: rgba(226, 232, 240, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.tool-chip__meta {
  color: rgba(148, 163, 184, 0.5);
  font-size: 9px;
  flex-shrink: 0;
}

@keyframes chip-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
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
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  padding-left: 8px;
}
</style>
