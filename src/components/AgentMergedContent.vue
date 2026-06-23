<template>
  <div class="agent-feed">
    <template v-if="showProcess">
      <div v-if="explorationTimeline.length" class="agent-exploration-timeline">
        <span class="agent-exploration-timeline__label">探索</span>
        <div class="agent-exploration-timeline__track">
          <button
            v-for="chip in explorationTimeline"
            :key="chip.key"
            type="button"
            class="agent-exploration-timeline__chip"
            :class="[
              `agent-exploration-timeline__chip--${chip.kind}`,
              { 'agent-exploration-timeline__chip--clickable': Boolean(chip.path) },
            ]"
            :title="chip.path || chip.label"
            :disabled="!chip.path"
            @click="chip.path && emit('openFile', chip.path)"
          >
            {{ chip.label }}
          </button>
        </div>
      </div>

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
            @open-file="(path) => emit('openFile', path)"
          />
        </div>
      </details>

      <AgentTurnCard
        v-for="view in visibleTurnViews"
        :key="view.key"
        :turn="view.turn"
        :running="view.running"
        :show-tools="view.showTools"
        @open-file="(path) => emit('openFile', path)"
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
    </template>

    <section
      v-if="showAnswerSection"
      class="agent-answer-section"
      :class="{
        'agent-answer-section--streaming': answerStreaming,
        'agent-answer-section--exploring': showExplorationProgress,
      }"
    >
      <div class="agent-answer-section__head">
        <span class="agent-answer-section__label">{{ sectionLabel }}</span>
      </div>

      <div v-if="showExplorationProgress" class="agent-exploration-progress">
        <p v-if="progressNarrative" class="agent-exploration-progress__narrative">{{ progressNarrative }}</p>
        <template v-if="explorationProgress">
          <p class="agent-exploration-progress__summary">{{ explorationProgress.summary }}</p>
          <p v-if="explorationProgress.activeTool" class="agent-exploration-progress__active">
            当前：{{ explorationProgress.activeTool }}
          </p>
          <p v-if="explorationProgress.detail" class="agent-exploration-progress__meta">
            {{ explorationProgress.detail }}
          </p>
        </template>
      </div>

      <div
        v-if="showTruncatedWarning"
        class="agent-answer-warning"
      >
        <span class="agent-answer-warning__text">回答可能不完整（以冒号、省略号或未闭合格式结尾）。</span>
        <button
          v-if="canResume"
          type="button"
          class="agent-answer-warning__action"
          @click="emit('resume')"
        >
          {{ resumeLabel || "继续生成" }}
        </button>
      </div>

      <PlanDocumentBlock
        v-if="displayFinalAnswer.trim()"
        :content="displayFinalAnswer"
        :streaming="answerStreaming || isRunning"
        :can-execute="canExecutePlan && !isRunning && !answerStreaming"
        :enhance-layout="!isRunning && !answerStreaming"
        @execute="emit('execute-plan')"
      >
        <ChatMarkdown
          class="agent-answer"
          :class="{ 'agent-answer--streaming': answerStreaming }"
          :content="markdownContent"
          :streaming="answerStreaming"
          :interactive="true"
          @select-option="(option) => emit('select-option', option)"
        />
      </PlanDocumentBlock>
    </section>
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
import type { AgentRoundGroupView, AgentRoundTool } from "../services/agentRoundGroups";
import { buildAgentExplorationProgress, buildAgentExplorationTimeline } from "../services/agentCursorFeed";
import {
  buildWrittenFilesSummary,
  isTruncatedAssistantAnswer,
  resolveLatestAgentProgressNarrative,
} from "../services/agentMessageDisplay";
import type { AiOption } from "../utils/parseAiOptions";

const props = withDefaults(
  defineProps<{
    roundGroups: AgentRoundGroupView[];
    finalAnswer: string;
    answerStreaming?: boolean;
    isRunning: boolean;
    currentStatus?: string;
    activityDetailed?: boolean;
    canExecutePlan?: boolean;
    showDebug?: boolean;
    debugExpanded?: boolean;
    showProcess?: boolean;
    tools?: AgentRoundTool[];
    agentTurn?: number;
    agentMaxTurns?: number;
    canResume?: boolean;
    resumeLabel?: string;
    writtenFiles?: string[];
    wasAborted?: boolean;
  }>(),
  {
    showProcess: true,
  },
);

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  "toggle-debug": [];
  openFile: [path: string];
  resume: [];
}>();

const markdownContent = computed(() =>
  enrichPlanMarkdownForDisplay(displayFinalAnswer.value, {
    whileStreaming: Boolean(props.answerStreaming || props.isRunning),
  }),
);

const progressNarrative = computed(() =>
  props.isRunning
    ? resolveLatestAgentProgressNarrative({
        roundGroups: props.roundGroups,
        agentTurn: props.agentTurn,
      })
    : "",
);

const writtenFilesSummary = computed(() => {
  if (!props.writtenFiles?.length || props.isRunning) return "";
  return buildWrittenFilesSummary(props.writtenFiles, Boolean(props.wasAborted));
});

const displayFinalAnswer = computed(() => {
  const base = props.finalAnswer.trim();
  if (base) return props.finalAnswer;
  return writtenFilesSummary.value;
});

const VISIBLE_TURN_LIMIT = 2;
const VISIBLE_TURN_LIMIT_RUNNING = 3;
const VISIBLE_TURN_LIMIT_STREAMING = 1;

const explorationProgress = computed(() =>
  buildAgentExplorationProgress({
    tools: props.tools,
    agentTurn: props.agentTurn,
    agentMaxTurns: props.agentMaxTurns,
    isRunning: props.isRunning,
  }),
);

const explorationTimeline = computed(() => {
  if (!props.isRunning || !props.showProcess) return [];
  return buildAgentExplorationTimeline(props.tools);
});

const showExplorationProgress = computed(
  () =>
    props.isRunning &&
    !props.finalAnswer.trim() &&
    (Boolean(explorationProgress.value) || Boolean(progressNarrative.value)),
);

const showAnswerSection = computed(
  () => Boolean(displayFinalAnswer.value.trim()) || showExplorationProgress.value,
);

const sectionLabel = computed(() => {
  if (props.finalAnswer.trim() || writtenFilesSummary.value) return "回答";
  return "进行中";
});

const showTruncatedWarning = computed(
  () =>
    !props.isRunning &&
    Boolean(displayFinalAnswer.value.trim()) &&
    isTruncatedAssistantAnswer(displayFinalAnswer.value),
);

const turnCards = computed<AgentTurnCardModel[]>(() =>
  buildTurnCardsFromRoundGroups(props.roundGroups, {
    finalAnswer: props.finalAnswer,
    activityDetailed: props.activityDetailed,
    isRunning: props.isRunning,
  }),
);

const visibleTurnLimit = computed(() => {
  if (props.answerStreaming) return VISIBLE_TURN_LIMIT_STREAMING;
  return props.isRunning ? VISIBLE_TURN_LIMIT_RUNNING : VISIBLE_TURN_LIMIT;
});

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

.agent-exploration-timeline {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  margin-bottom: 2px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.08);
  min-width: 0;
}

.agent-exploration-timeline__label {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.55);
  letter-spacing: 0.04em;
}

.agent-exploration-timeline__track {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.2) transparent;
}

.agent-exploration-timeline__chip {
  flex-shrink: 0;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 999px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(226, 232, 240, 0.75);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.4;
  cursor: default;
}

.agent-exploration-timeline__chip--file {
  cursor: pointer;
}

.agent-exploration-timeline__chip--clickable:not(:disabled):hover {
  background: rgba(88, 166, 255, 0.1);
  border-color: rgba(88, 166, 255, 0.22);
  color: rgba(126, 182, 255, 0.95);
}

.agent-exploration-timeline__chip:disabled {
  opacity: 0.92;
  cursor: default;
}

.agent-exploration-timeline__chip--search {
  border-color: rgba(34, 197, 94, 0.15);
  color: rgba(134, 239, 172, 0.85);
}

.agent-exploration-timeline__chip--edit {
  border-color: rgba(251, 146, 60, 0.15);
  color: rgba(253, 186, 116, 0.85);
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

.agent-answer-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.agent-answer-section--streaming {
  border-color: rgba(88, 166, 255, 0.28);
  box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.06);
}

.agent-answer-section--exploring {
  border-color: rgba(148, 163, 184, 0.12);
  background: rgba(148, 163, 184, 0.04);
}

.agent-answer-section__head {
  display: flex;
  align-items: center;
  min-height: 18px;
}

.agent-answer-section__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.72);
}

.agent-answer-section--streaming .agent-answer-section__label {
  color: rgba(126, 182, 255, 0.92);
}

.agent-exploration-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-exploration-progress__narrative {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(226, 232, 240, 0.9);
  white-space: pre-wrap;
}

.agent-exploration-progress__summary {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(226, 232, 240, 0.88);
}

.agent-exploration-progress__active,
.agent-exploration-progress__meta {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(148, 163, 184, 0.72);
}

.agent-exploration-progress__active {
  color: rgba(126, 182, 255, 0.82);
}

.agent-answer {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 0;
}

.agent-answer--streaming {
  border: none;
  box-shadow: none;
}

.agent-answer-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(210, 153, 34, 0.08);
  border: 1px solid rgba(210, 153, 34, 0.18);
}

.agent-answer-warning__text {
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 214, 130, 0.92);
}

.agent-answer-warning__action {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid rgba(210, 153, 34, 0.35);
  background: rgba(210, 153, 34, 0.12);
  color: rgba(255, 230, 170, 0.96);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.agent-answer-warning__action:hover {
  background: rgba(210, 153, 34, 0.2);
}
</style>
