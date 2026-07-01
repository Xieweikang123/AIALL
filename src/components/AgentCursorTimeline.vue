<template>
  <div
    ref="timelineRoot"
    class="agent-stream"
    :class="{ 'agent-stream--running': isRunning }"
    @scroll="onTimelineScroll"
  >
    <div v-if="isRunning" class="stream-unified">
      <AgentInlineFeedItems
        :items="inlineItems"
        :is-running="true"
        :chat-mode="chatMode"
        :can-execute-plan="canExecutePlan"
        :layout-enhance-ready="layoutEnhanceReady"
        :plan-file-path="planFilePath"
        :message-id="messageId"
        :tool-display="'inline'"
        :tool-default-visible="toolDefaultVisible"
        :progress-hint="progressHint"
        @execute-plan="emit('execute-plan')"
        @select-option="(option) => emit('select-option', option)"
        @open-file="(path) => emit('openFile', path)"
      />
    </div>

    <template v-else-if="useCompletedLayout">
      <details
        v-if="completedProcessItems.length"
        class="stream-process"
        :open="processOpen"
        @toggle="onProcessToggle"
      >
        <summary class="stream-process-summary">
          <span class="stream-process-label">执行过程</span>
          <span class="stream-process-meta">{{ processSummary }}</span>
        </summary>
        <div class="stream-process-body">
          <AgentInlineFeedItems
            :items="completedProcessItems"
            :is-running="false"
            :chat-mode="chatMode"
            :can-execute-plan="false"
            :layout-enhance-ready="layoutEnhanceReady"
            tool-display="inline"
            @open-file="(path) => emit('openFile', path)"
          />
        </div>
      </details>
      <div v-if="answerItems.length" class="stream-answer">
        <AgentInlineFeedItems
          :items="answerItems"
          :is-running="false"
          :chat-mode="chatMode"
          :can-execute-plan="canExecutePlan"
          :layout-enhance-ready="layoutEnhanceReady"
          :plan-file-path="planFilePath"
          :message-id="messageId"
          answer-only
          @execute-plan="emit('execute-plan')"
          @select-option="(option) => emit('select-option', option)"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>
    </template>

    <div v-else class="stream-unified">
      <AgentInlineFeedItems
        :items="inlineItems"
        :is-running="isRunning"
        :chat-mode="chatMode"
        :can-execute-plan="canExecutePlan"
        :layout-enhance-ready="layoutEnhanceReady"
        :plan-file-path="planFilePath"
        :message-id="messageId"
        :tool-display="'inline'"
        :tool-default-visible="toolDefaultVisible"
        :progress-hint="progressHint"
        @execute-plan="emit('execute-plan')"
        @select-option="(option) => emit('select-option', option)"
        @open-file="(path) => emit('openFile', path)"
      />
    </div>

    <AgentLiveStatusRail
      v-if="liveRailVisible"
      :status-line="liveRailPrimary"
      :waiting-model="isWaitingModel"
      :shimmer="isWaitingModel || !hasAnswerContent"
    />

    <slot v-if="debugExpanded" name="debug" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AgentInlineFeedItems from "./AgentInlineFeedItems.vue";
import AgentLiveStatusRail from "./AgentLiveStatusRail.vue";
import {
  buildAgentLiveFooterStatus,
  isAgentWaitingModelPhase,
} from "../services/agentCompactStatus";
import {
  collectToolsFromInlineFeed,
  filterInlineTimelineItems,
  splitInlineFeedItems,
  summarizeInlineFeedProcess,
  type InlineFeedItem,
} from "../services/agentInlineFeed";
import { formatExplorationSummary, computeExplorationStats } from "../services/agentCursorFeed";
import type { AiOption } from "../utils/parseAiOptions";

const props = withDefaults(
  defineProps<{
    inlineItems: InlineFeedItem[];
    isRunning: boolean;
    chatMode?: "ask" | "build" | "plan" | "explore";
    canExecutePlan?: boolean;
    layoutEnhanceReady?: boolean;
    planFilePath?: string;
    showDebug?: boolean;
    debugExpanded?: boolean;
    currentStatus?: string;
    hasRunningTool?: boolean;
    activityDetailed?: boolean;
    activityExpanded?: boolean;
    agentPhase?: string;
    messageId?: string;
    bindStatusLogScroll?: (el: HTMLElement | null, msgId: string) => void;
    onStatusLogScroll?: (msgId: string) => void;
  }>(),
  {
    inlineItems: () => [],
  },
);

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  "toggle-debug": [];
  openFile: [path: string];
  "open-plan-file": [];
  resume: [];
  "toggle-process": [expanded: boolean];
}>();

const timelineRoot = ref<HTMLElement | null>(null);

const splitFeed = computed(() => splitInlineFeedItems(props.inlineItems));
const processItems = computed(() => splitFeed.value.process);
const answerItem = computed(() => splitFeed.value.answer);
const answerItems = computed((): InlineFeedItem[] =>
  answerItem.value ? [answerItem.value] : [],
);

const liveTools = computed(() => collectToolsFromInlineFeed(processItems.value));
const toolCount = computed(() => liveTools.value.length);
const hasAnswerContent = computed(() => Boolean(answerItem.value?.text.trim()));
const answerPreviewText = computed(() => answerItem.value?.text.trim() ?? "");

const toolDefaultVisible = computed(() => {
  if (props.activityDetailed) return 12;
  if (props.chatMode === "ask") return 3;
  if (props.chatMode === "build" || props.chatMode === "plan") return 5;
  return 4;
});

const useCompletedLayout = computed(
  () =>
    !props.isRunning &&
    hasAnswerContent.value &&
    completedProcessItems.value.length > 0,
);

const completedProcessItems = computed((): InlineFeedItem[] => {
  if (props.isRunning) return [];
  return filterInlineTimelineItems(processItems.value, {
    answerPreview: answerPreviewText.value,
    hideNarratives: true,
  });
});

const processSummary = computed(() =>
  summarizeInlineFeedProcess(processItems.value, toolCount.value, false),
);

const processOpen = computed(
  () => Boolean(props.activityExpanded) || Boolean(props.activityDetailed),
);

const liveRailPrimary = computed((): string => {
  if (!props.isRunning) return "";

  if (props.hasRunningTool || liveTools.value.some((step) => step.running)) {
    return "";
  }

  const footer = buildAgentLiveFooterStatus({
    currentStatus: props.currentStatus,
    isRunning: true,
    hasAnswer: hasAnswerContent.value,
    hasRunningTool: props.hasRunningTool,
    hasActionBlocks: toolCount.value > 0,
    agentPhase: props.agentPhase,
  });
  if (footer) return footer;

  const status = props.currentStatus?.trim();
  if (status && !/^探索代码库 ·/.test(status)) return status;

  if (toolCount.value > 0) {
    const stats = computeExplorationStats(liveTools.value);
    return formatExplorationSummary(stats, true);
  }

  return "规划下一步…";
});

const isWaitingModel = computed(() =>
  isAgentWaitingModelPhase({
    agentPhase: props.agentPhase,
    statusLine: liveRailPrimary.value,
    hasRunningTool: props.hasRunningTool,
  }),
);

const liveRailVisible = computed(() => {
  if (!props.isRunning) return false;
  if (props.hasRunningTool || liveTools.value.some((step) => step.running)) return false;
  if (hasAnswerContent.value && props.agentPhase === "streaming_model") return false;
  return Boolean(liveRailPrimary.value.trim());
});

const progressHint = computed((): string | undefined => {
  if (!props.isRunning || hasAnswerContent.value || answerItem.value?.streaming) return undefined;
  if (!toolCount.value || !isWaitingModel.value) return undefined;
  const stats = computeExplorationStats(liveTools.value);
  const summary = formatExplorationSummary(stats, true).replace(/^探索代码库 · /, "");
  return summary ? `已${summary}，正在整理结论…` : "正在整理结论…";
});

function onProcessToggle(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  emit("toggle-process", target.open);
}

function onTimelineScroll() {
  if (props.messageId && props.onStatusLogScroll) {
    props.onStatusLogScroll(props.messageId);
  }
}

function bindScrollEl(el: HTMLElement | null) {
  if (!props.messageId || !props.bindStatusLogScroll) return;
  props.bindStatusLogScroll(el, props.messageId);
}

onMounted(() => bindScrollEl(timelineRoot.value));
onUnmounted(() => bindScrollEl(null));
watch(timelineRoot, (el) => bindScrollEl(el));
</script>

<style scoped>
.agent-stream {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 0;
}

.stream-unified {
  min-width: 0;
}

.stream-process {
  margin: 0;
  min-width: 0;
}

.stream-process-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  list-style: none;
  cursor: pointer;
  user-select: none;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(148, 163, 184, 0.78);
  transition: background 120ms ease, color 120ms ease;
}

.stream-process-summary::-webkit-details-marker {
  display: none;
}

.stream-process-summary::before {
  content: "▸";
  font-size: 9px;
  color: rgba(148, 163, 184, 0.45);
  flex-shrink: 0;
}

.stream-process[open] > .stream-process-summary::before {
  content: "▾";
}

.stream-process-summary:hover {
  color: rgba(165, 214, 255, 0.92);
  background: rgba(255, 255, 255, 0.03);
}

.stream-process-label {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(148, 163, 184, 0.55);
}

.stream-process-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stream-process-body {
  padding: 4px 0 2px;
  margin: 2px 0 0;
}

.stream-answer {
  min-width: 0;
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.agent-stream--running :deep(.process-step-list) {
  max-height: none;
  background: transparent;
}
</style>
