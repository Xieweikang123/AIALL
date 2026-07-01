<template>
  <div
    ref="timelineRoot"
    class="agent-stream"
    :class="{ 'agent-stream--running': isRunning }"
    @scroll="onTimelineScroll"
  >
    <div class="stream-unified">
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

    <div
      v-if="liveRailVisible"
      class="cursor-live-status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        class="cursor-status-text"
        :class="{ 'shimmer-text--fast': isWaitingModel || !hasAnswerContent }"
      >
        {{ liveRailPrimary }}
      </span>
    </div>

    <slot v-if="debugExpanded" name="debug" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AgentInlineFeedItems from "./AgentInlineFeedItems.vue";
import {
  buildAgentLiveFooterStatus,
} from "../services/agentCompactStatus";
import {
  collectToolsFromInlineFeed,
  type InlineFeedItem,
  type InlineFeedTextItem,
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

const liveTools = computed(() => collectToolsFromInlineFeed(props.inlineItems));

const toolCount = computed(() => liveTools.value.length);

const answerItem = computed((): InlineFeedTextItem | null => {
  for (const item of props.inlineItems) {
    if (item.kind === "text" && item.variant === "answer") return item;
  }
  return null;
});

const hasAnswerContent = computed(() => Boolean(answerItem.value?.text.trim()));

const toolDefaultVisible = computed(() => {
  if (props.activityDetailed) return 12;
  if (props.chatMode === "ask") return 3;
  if (props.chatMode === "build" || props.chatMode === "plan") return 5;
  return 4;
});

const MODEL_WAIT_PHASES = new Set(["waiting_model", "sending_request", "retrying_model"]);

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

  return "Planning next moves…";
});

const isWaitingModel = computed(() => {
  if (props.hasRunningTool) return false;
  if (props.agentPhase && MODEL_WAIT_PHASES.has(props.agentPhase)) return true;
  return liveRailPrimary.value.includes("等待模型");
});

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

.cursor-live-status {
  padding: 4px 0 2px;
  margin-top: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.cursor-live-status .cursor-status-text {
  font-size: 11px;
  line-height: 1.45;
  color: rgba(148, 163, 184, 0.62);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
