<template>
  <div class="cursor-merged-content">
    <template v-for="(block, blockIndex) in mergedBlocks" :key="block.key">
      <AgentThoughtBlock
        v-if="block.kind === 'thought'"
        :block="block"
        :streaming="false"
        :style="{ '--block-index': blockIndex }"
      />
      <AgentActionBlock
        v-else-if="block.kind === 'actions'"
        :block="block"
        :style="{ '--block-index': blockIndex }"
      />
      <p v-else-if="block.kind === 'status'" class="cursor-action planning" :style="{ '--block-index': blockIndex }"><span class="shimmer-text">{{ block.text }}</span></p>
    </template>

    <!-- 当前状态 + 调试面板（合并为可点击的一行）：流式回答已有实质内容后隐藏，避免冗余 -->
    <template v-if="isRunning && currentStatus && !(answerStreaming && finalAnswer.trim().length > 50)">
      <button
        type="button"
        class="cursor-action planning planning-clickable"
        :class="{ 'planning-expanded': debugExpanded }"
        @click="emit('toggle-debug')"
      >
        <span class="planning-text shimmer-text--fast">{{ currentStatus }}</span>
        <span v-if="showDebug" class="planning-chevron">{{ debugExpanded ? '▾' : '▸' }}</span>
      </button>
      <slot v-if="debugExpanded" name="debug" />
    </template>

    <!-- 最终回答：运行中流式输出，完成后展示完整 Markdown -->
    <PlanDocumentBlock
      :content="finalAnswer"
      :streaming="answerStreaming || isRunning"
      :can-execute="canExecutePlan && !isRunning && !answerStreaming"
      :enhance-layout="!isRunning && !answerStreaming"
      @execute="emit('execute-plan')"
    >
      <ChatMarkdown
        v-if="finalAnswer.trim()"
        class="cursor-merged-answer"
        :class="{ 'cursor-merged-answer--streaming': answerStreaming }"
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
import AgentThoughtBlock from "./AgentThoughtBlock.vue";
import AgentActionBlock from "./AgentActionBlock.vue";
import { filterDuplicateFeedThoughts } from "../services/agentMessageDisplay";
import { enrichPlanMarkdownForDisplay } from "../services/planDocumentDisplay";
import { stripTextToolCallMarkup } from "../services/textToolCallMarkup";
import {
  layoutCursorFeedBlocks,
  type CursorFeedItem,
  type CursorFeedProcessBlock,
} from "../services/agentCursorFeed";
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

const mergedBlocks = computed<CursorFeedProcessBlock[]>(() => {
  const items: CursorFeedItem[] = [];
  const answer = props.finalAnswer.trim();

  for (const group of props.roundGroups) {
    // Turn 0 holds transient setup phases (connect / prepare). Show live status via
    // `currentStatus` below — do not render every recorded step as permanent history.
    if (group.turn <= 0 && !group.narrative) continue;

    const narrativeText = stripTextToolCallMarkup(group.narrative || "").trim();
    if (narrativeText) {
      items.push({
        kind: "thought",
        key: `thought-${group.turn}`,
        text: narrativeText,
      });
    }

    for (const tool of group.tools) {
      items.push({
        kind: "action",
        key: tool.id,
        step: tool,
      });
    }
  }

  const filtered = filterDuplicateFeedThoughts(items, answer);

  const detailed = props.activityDetailed === true;
  const collapseAfter = props.isRunning ? 999 : detailed ? 10 : 5;
  return layoutCursorFeedBlocks(filtered, {
    keepVisible: detailed ? 8 : 6,
    collapseAfter,
  });
});
</script>

<style scoped>
.cursor-merged-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
  min-width: 0;
  overflow: hidden;
}

/* Agent 活动块入场动画 */
.cursor-thought,
.cursor-actions-block,
.cursor-action.planning {
  animation: agent-block-fade-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--block-index, 0) * 60ms);
}

@keyframes agent-block-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 最终回答淡入 */
.cursor-merged-answer {
  animation: answer-fade-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
}

@keyframes answer-fade-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.cursor-action.planning {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-style: normal;
  color: rgba(139, 148, 158, 0.85);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(139, 148, 158, 0.06);
  border-radius: 6px;
  margin: 2px 0;
  font-size: 12px;
}

.cursor-action.planning::before {
  content: "";
  width: 8px;
  height: 8px;
  border: 1.5px solid rgba(139, 148, 158, 0.3);
  border-top-color: rgba(139, 148, 158, 0.8);
  border-radius: 50%;
  animation: planning-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes planning-spin {
  to { transform: rotate(360deg); }
}

/* 可点击状态行：状态指示器 + 调试面板合并 */
.planning-clickable {
  width: 100%;
  border: none;
  outline: none;
  font: inherit;
  color: inherit;
  background: inherit;
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
  padding: 4px 10px;
}

.planning-clickable:hover {
  background: rgba(139, 148, 158, 0.1);
}

.planning-clickable.planning-expanded {
  border-radius: 6px 6px 0 0;
}

.planning-text {
  flex: 1;
  min-width: 0;
}

.planning-chevron {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.45;
  transition: opacity 0.15s ease;
  margin-left: 4px;
}

.planning-clickable:hover .planning-chevron {
  opacity: 0.7;
}

.cursor-merged-answer {
  margin: 4px 0 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.cursor-merged-answer--streaming {
  border-color: rgba(88, 166, 255, 0.22);
  box-shadow: inset 0 0 0 1px rgba(88, 166, 255, 0.06);
}
</style>
