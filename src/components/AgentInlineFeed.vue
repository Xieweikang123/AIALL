<template>
  <div class="agent-stream">
    <div
      v-if="streamStatus"
      class="stream-status"
      :class="{ 'stream-status--live': isRunning }"
    >
      <span v-if="isRunning" class="stream-status-dot" aria-hidden="true" />
      <span
        class="stream-status-text"
        :class="{ 'shimmer-text--fast': isRunning && !hasAnswer }"
      >
        {{ streamStatus }}
      </span>
      <button
        v-if="showDebug"
        type="button"
        class="stream-status-debug"
        :title="debugExpanded ? '收起调试' : '展开调试'"
        @click="emit('toggle-debug')"
      >
        {{ debugExpanded ? "▾" : "▸" }}
      </button>
    </div>

    <details
      v-if="showProcessPanel"
      class="stream-process"
      :open="processOpen"
      @toggle="onProcessToggle"
    >
      <summary class="stream-process-summary">{{ processSummary }}</summary>
      <div class="stream-process-body">
        <AgentInlineFeedItems
          :items="processItems"
          :is-running="isRunning"
          :chat-mode="chatMode"
          :can-execute-plan="false"
          :layout-enhance-ready="layoutEnhanceReady"
          tool-display="inline"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>
    </details>

    <AgentProcessFlowLine
      v-else-if="isRunning && liveTools.length && !activityDetailed"
      :tools="liveTools"
      :is-running="true"
      @open-file="(path) => emit('openFile', path)"
    />

    <div v-if="answerItem" class="stream-answer">
      <AgentInlineFeedItems
        :items="answerItems"
        :is-running="isRunning"
        :chat-mode="chatMode"
        :can-execute-plan="canExecutePlan"
        :layout-enhance-ready="layoutEnhanceReady"
        answer-only
        @execute-plan="emit('execute-plan')"
        @select-option="(option) => emit('select-option', option)"
        @open-file="(path) => emit('openFile', path)"
      />
    </div>

    <div v-if="showTruncatedWarning" class="stream-truncated">
      <span class="stream-truncated__text">回答可能不完整。</span>
      <button
        v-if="canResume"
        type="button"
        class="stream-truncated__action"
        @click="emit('resume')"
      >
        {{ resumeLabel || "继续生成" }}
      </button>
    </div>

    <slot v-if="debugExpanded" name="debug" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AgentInlineFeedItems from "./AgentInlineFeedItems.vue";
import AgentProcessFlowLine from "./AgentProcessFlowLine.vue";
import { buildAgentLiveFooterStatus } from "../services/agentCompactStatus";
import {
  collectToolsFromInlineFeed,
  splitInlineFeedItems,
  summarizeInlineFeedProcess,
  type InlineFeedItem,
} from "../services/agentInlineFeed";
import type { AiOption } from "../utils/parseAiOptions";

const props = defineProps<{
  items: InlineFeedItem[];
  isRunning: boolean;
  hasAnswer: boolean;
  toolCount?: number;
  chatMode?: "ask" | "build" | "plan" | "explore";
  canExecutePlan?: boolean;
  layoutEnhanceReady?: boolean;
  showDebug?: boolean;
  debugExpanded?: boolean;
  showTruncatedWarning?: boolean;
  canResume?: boolean;
  resumeLabel?: string;
  currentStatus?: string;
  hasRunningTool?: boolean;
  activityDetailed?: boolean;
  activityExpanded?: boolean;
}>();

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  "toggle-debug": [];
  openFile: [path: string];
  resume: [];
  "toggle-process": [expanded: boolean];
}>();

const splitFeed = computed(() => splitInlineFeedItems(props.items));
const processItems = computed(() => splitFeed.value.process);
const answerItem = computed(() => splitFeed.value.answer);
const answerItems = computed((): InlineFeedItem[] =>
  answerItem.value ? [answerItem.value] : [],
);

const liveTools = computed(() => collectToolsFromInlineFeed(processItems.value));

const processSummary = computed(() =>
  summarizeInlineFeedProcess(
    processItems.value,
    props.toolCount ?? liveTools.value.length,
    false,
  ),
);

const processOpen = computed(
  () => Boolean(props.activityExpanded) || Boolean(props.activityDetailed),
);

const showProcessPanel = computed(() => {
  if (!processItems.value.length) return false;
  if (props.isRunning) return Boolean(props.activityDetailed);
  return true;
});

const streamStatus = computed((): string | null => {
  if (!props.isRunning) return null;

  const status = props.currentStatus?.trim();
  if (status) return status;

  const footer = buildAgentLiveFooterStatus({
    currentStatus: props.currentStatus,
    isRunning: props.isRunning,
    hasAnswer: props.hasAnswer,
    hasRunningTool: props.hasRunningTool,
    hasActionBlocks: (props.toolCount ?? 0) > 0,
  });
  if (footer) return footer;

  if (!props.hasAnswer && processItems.value.length) {
    return summarizeInlineFeedProcess(
      processItems.value,
      props.toolCount ?? liveTools.value.length,
      true,
    );
  }

  return null;
});

function onProcessToggle(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  emit("toggle-process", target.open);
}
</script>

<style scoped>
.agent-stream {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 2px 0 4px;
}

.stream-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0 6px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(148, 163, 184, 0.78);
}

.stream-status--live {
  color: rgba(165, 205, 255, 0.88);
}

.stream-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.55);
  flex-shrink: 0;
  animation: stream-status-pulse 1.4s ease-in-out infinite;
}

@keyframes stream-status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.stream-status-text {
  flex: 1;
  min-width: 0;
}

.stream-status-debug {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: rgba(148, 163, 184, 0.45);
  font-size: 9px;
  cursor: pointer;
  padding: 0 2px;
}

.stream-status-debug:hover {
  color: rgba(148, 163, 184, 0.75);
}

.stream-process {
  margin: 0 0 4px;
  min-width: 0;
}

.stream-process-summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  padding: 2px 0 4px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(148, 163, 184, 0.72);
}

.stream-process-summary::-webkit-details-marker {
  display: none;
}

.stream-process-summary::before {
  content: "▸ ";
  font-size: 9px;
  color: rgba(148, 163, 184, 0.45);
}

.stream-process[open] > .stream-process-summary::before {
  content: "▾ ";
}

.stream-process-summary:hover {
  color: rgba(165, 214, 255, 0.88);
}

.stream-process-body {
  padding: 2px 0 4px 10px;
  border-left: 2px solid rgba(148, 163, 184, 0.12);
  margin-left: 2px;
}

.stream-answer {
  min-width: 0;
}

.stream-truncated {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(210, 153, 34, 0.06);
  border: 1px solid rgba(210, 153, 34, 0.14);
}

.stream-truncated__text {
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 214, 130, 0.88);
}

.stream-truncated__action {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid rgba(210, 153, 34, 0.3);
  background: rgba(210, 153, 34, 0.1);
  color: rgba(255, 230, 170, 0.96);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .stream-status-dot {
    animation: none;
  }
}
</style>
