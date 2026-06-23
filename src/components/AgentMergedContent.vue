<template>
  <div class="agent-feed">
    <details v-if="earlierTurns.length" class="agent-feed__earlier">
      <summary class="agent-feed__earlier-label">
        <span class="agent-feed__earlier-count">{{ earlierTurns.length }}</span>
        <span>条更早推理</span>
      </summary>
      <div class="agent-feed__earlier-body">
        <AgentTurnCard
          v-for="turn in earlierTurns"
          :key="turn.key"
          :turn="turn"
          :show-tools="false"
          compact
        />
      </div>
    </details>

    <AgentTurnCard
      v-for="view in visibleTurnViews"
      :key="view.key"
      :turn="view.turn"
      :running="view.running"
      :show-tools="view.showTools"
    />

    <template v-if="isRunning && currentStatus">
      <button
        type="button"
        class="agent-status"
        :class="{ 'agent-status--expanded': debugExpanded }"
        @click="emit('toggle-debug')"
      >
        <span class="agent-status-dot" />
        <span class="agent-status-text shimmer-text--fast">{{ currentStatus }}</span>
        <span v-if="showDebug" class="agent-status-chevron">{{ debugExpanded ? '▾' : '▸' }}</span>
      </button>
      <slot v-if="debugExpanded" name="debug" />
    </template>

    <PlanDocumentBlock
      :content="finalAnswer"
      :streaming="answerStreaming || isRunning"
      :can-execute="canExecutePlan && !isRunning && !answerStreaming"
      :enhance-layout="!isRunning && !answerStreaming"
      @execute="emit('execute-plan')"
    >
      <ChatMarkdown
        v-if="finalAnswer.trim()"
        class="agent-answer"
        :class="{ 'agent-answer--streaming': answerStreaming }"
        :content="markdownContent"
        :streaming="answerStreaming"
        :interactive="!isRunning"
        @select-option="(option) => emit('select-option', option)"
      />
    </PlanDocumentBlock>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import PlanDocumentBlock from "./PlanDocumentBlock.vue";
import AgentTurnCard from "./AgentTurnCard.vue";
import { enrichPlanMarkdownForDisplay } from "../services/planDocumentDisplay";
import {
  buildTurnCardsFromRoundGroups,
  buildVisibleTurnViews,
  type AgentTurnCardModel,
} from "../services/agentTurnCards";
import type { AgentRoundGroupView } from "../services/agentRoundGroups";
import type { AiOption } from "../utils/parseAiOptions";

const props = defineProps<{
  roundGroups: AgentRoundGroupView[];
  finalAnswer: string;
  answerStreaming?: boolean;
  isRunning: boolean;
  currentStatus?: string;
  activityDetailed?: boolean;
  canExecutePlan?: boolean;
  showDebug?: boolean;
  debugExpanded?: boolean;
}>();

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  "toggle-debug": [];
}>();

const markdownContent = computed(() =>
  enrichPlanMarkdownForDisplay(props.finalAnswer, {
    whileStreaming: Boolean(props.answerStreaming || props.isRunning),
  }),
);

const VISIBLE_TURN_LIMIT = 2;
const VISIBLE_TURN_LIMIT_RUNNING = 3;

const turnCards = computed<AgentTurnCardModel[]>(() =>
  buildTurnCardsFromRoundGroups(props.roundGroups, {
    finalAnswer: props.finalAnswer,
    activityDetailed: props.activityDetailed,
    isRunning: props.isRunning,
  }),
);

const visibleTurnLimit = computed(() =>
  props.isRunning ? VISIBLE_TURN_LIMIT_RUNNING : VISIBLE_TURN_LIMIT,
);

const earlierTurns = computed(() => {
  const cards = turnCards.value;
  const limit = visibleTurnLimit.value;
  if (props.activityDetailed || cards.length <= limit + 1) return [];
  return cards.slice(0, cards.length - limit);
});

const visibleTurns = computed(() => {
  const cards = turnCards.value;
  const limit = visibleTurnLimit.value;
  if (props.activityDetailed || cards.length <= limit + 1) return cards;
  return cards.slice(-limit);
});

const visibleTurnViews = computed(() =>
  buildVisibleTurnViews({
    turns: turnCards.value,
    visibleTurns: visibleTurns.value,
    isRunning: props.isRunning,
  }),
);
</script>

<style scoped>
.agent-feed {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 0;
  min-width: 0;
  overflow: hidden;
}

.agent-feed__earlier {
  margin: 0;
}

.agent-feed__earlier-label {
  display: flex;
  align-items: center;
  gap: 5px;
  list-style: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  color: rgba(148, 163, 184, 0.45);
  cursor: pointer;
  user-select: none;
  padding: 2px 8px;
  border-radius: 4px;
  transition: color 0.15s ease, background 0.15s ease;
}

.agent-feed__earlier-label:hover {
  color: rgba(148, 163, 184, 0.65);
  background: rgba(148, 163, 184, 0.05);
}

.agent-feed__earlier-label::-webkit-details-marker {
  display: none;
}

.agent-feed__earlier-label::before {
  content: "▸ ";
  font-size: 8px;
  color: rgba(148, 163, 184, 0.25);
}

.agent-feed__earlier[open] > .agent-feed__earlier-label::before {
  content: "▾ ";
}

.agent-feed__earlier-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 12px;
  padding: 0 3px;
  font-size: 8px;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.55);
  background: rgba(148, 163, 184, 0.08);
  border-radius: 6px;
}

.agent-feed__earlier-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  padding-left: 4px;
}

.agent-status {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  outline: none;
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: rgba(148, 163, 184, 0.7);
  background: transparent;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 4px;
  text-align: left;
  transition: background 0.15s ease;
}

.agent-status:hover {
  background: rgba(148, 163, 184, 0.06);
}

.agent-status--expanded {
  border-radius: 4px 4px 0 0;
}

.agent-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.4);
  animation: status-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.agent-status-text {
  flex: 1;
  min-width: 0;
}

.agent-status-chevron {
  flex-shrink: 0;
  font-size: 9px;
  opacity: 0.4;
  transition: opacity 0.15s ease;
}

.agent-status:hover .agent-status-chevron {
  opacity: 0.7;
}

.agent-answer {
  margin: 4px 0 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.agent-answer--streaming {
  border-color: rgba(88, 166, 255, 0.22);
  box-shadow: inset 0 0 0 1px rgba(88, 166, 255, 0.06);
}
</style>
