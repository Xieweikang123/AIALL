<template>
  <div
    ref="timelineRoot"
    class="agent-stream"
    :class="{ 'agent-stream--running': isRunning }"
    @scroll="onTimelineScroll"
  >
    <template v-if="isRunning">
      <div v-if="processBlocks.length" class="stream-timeline stream-timeline--running">
        <AgentCursorProcessBlocks
          :blocks="processBlocks"
          :is-running="true"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>

      <div v-if="showAnswerBlock" class="stream-answer">
        <AgentTimelineAnswer
          :text="answerText"
          :streaming="answerStreaming && isRunning"
          :is-running="isRunning"
          :chat-mode="chatMode"
          :can-execute-plan="canExecutePlan"
          :layout-enhance-ready="layoutEnhanceReady"
          :message-id="messageId"
          :plan-file-path="planFilePath"
          @execute-plan="emit('execute-plan')"
          @select-option="(option) => emit('select-option', option)"
          @open-plan-file="emit('open-plan-file')"
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
          :class="{ 'shimmer-text--fast': isWaitingModel || !hasAnswer }"
        >
          {{ liveRailPrimary }}
        </span>
      </div>
    </template>

    <template v-else>
      <template v-if="activityExpanded && processBlocks.length">
        <div class="stream-timeline stream-timeline--expanded">
          <AgentCursorProcessBlocks
            :blocks="processBlocks"
            :is-running="false"
            nested
            @open-file="(path) => emit('openFile', path)"
          />
        </div>
        <div v-if="showAnswerBlock" class="stream-answer stream-answer--after-process">
          <AgentTimelineAnswer
            :text="answerText"
            :streaming="false"
            :is-running="false"
            :chat-mode="chatMode"
            :can-execute-plan="canExecutePlan"
            :layout-enhance-ready="layoutEnhanceReady"
            :message-id="messageId"
            :plan-file-path="planFilePath"
            @execute-plan="emit('execute-plan')"
            @select-option="(option) => emit('select-option', option)"
            @open-plan-file="emit('open-plan-file')"
          />
        </div>
      </template>

      <template v-else>
        <div v-if="showAnswerBlock" class="stream-answer">
          <AgentTimelineAnswer
            :text="answerText"
            :streaming="false"
            :is-running="false"
            :chat-mode="chatMode"
            :can-execute-plan="canExecutePlan"
            :layout-enhance-ready="layoutEnhanceReady"
            :message-id="messageId"
            :plan-file-path="planFilePath"
            @execute-plan="emit('execute-plan')"
            @select-option="(option) => emit('select-option', option)"
            @open-plan-file="emit('open-plan-file')"
          />
        </div>

        <details
          v-if="processBlocks.length"
          class="stream-process"
          :open="processOpen"
          @toggle="onProcessToggle"
        >
          <summary class="stream-process-summary">
            <span class="stream-process-meta">{{ processSummary }}</span>
          </summary>
          <div class="stream-process-body">
            <AgentCursorProcessBlocks
              :blocks="processBlocks"
              :is-running="false"
              nested
              @open-file="(path) => emit('openFile', path)"
            />
          </div>
        </details>
      </template>
    </template>

    <slot v-if="debugExpanded" name="debug" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AgentCursorProcessBlocks from "./AgentCursorProcessBlocks.vue";
import AgentTimelineAnswer from "./AgentTimelineAnswer.vue";
import {
  buildAgentLiveFooterStatus,
  summarizeCursorProcessBlocks,
} from "../services/agentCompactStatus";
import type { CursorFeedProcessBlock } from "../services/agentCursorFeed";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import type { AiOption } from "../utils/parseAiOptions";

const props = withDefaults(
  defineProps<{
    processBlocks: CursorFeedProcessBlock[];
    answerText: string;
    answerStreaming?: boolean;
    isRunning: boolean;
    hasAnswer: boolean;
    toolCount?: number;
    chatMode?: "ask" | "build" | "plan" | "explore";
    canExecutePlan?: boolean;
    layoutEnhanceReady?: boolean;
    planFilePath?: string;
    showDebug?: boolean;
    debugExpanded?: boolean;
    canResume?: boolean;
    resumeLabel?: string;
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
    answerStreaming: false,
    toolCount: 0,
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

const liveTools = computed((): AgentRoundTool[] => {
  const tools: AgentRoundTool[] = [];
  for (const block of props.processBlocks) {
    if (block.kind === "actions") {
      for (const item of [...block.collapsed, ...block.visible]) {
        tools.push(item.step);
      }
    }
  }
  return tools;
});

const processSummary = computed(() =>
  summarizeCursorProcessBlocks(
    props.processBlocks,
    props.toolCount ?? liveTools.value.length,
    false,
  ),
);

const processOpen = computed(
  () => Boolean(props.activityExpanded) || Boolean(props.activityDetailed),
);

const showAnswerBlock = computed(() => {
  if (props.chatMode === "plan" && props.planFilePath?.trim()) return true;
  if (props.answerText.trim()) return true;
  if (props.answerStreaming && props.isRunning) return true;
  if (!props.isRunning && props.hasAnswer) return true;
  return false;
});

const MODEL_WAIT_PHASES = new Set(["waiting_model", "sending_request", "retrying_model"]);

const liveRailPrimary = computed((): string => {
  if (props.hasRunningTool || liveTools.value.some((step) => step.running)) {
    return "";
  }

  const footer = buildAgentLiveFooterStatus({
    currentStatus: props.currentStatus,
    isRunning: true,
    hasAnswer: props.hasAnswer,
    hasRunningTool: props.hasRunningTool,
    hasActionBlocks: (props.toolCount ?? 0) > 0,
    agentPhase: props.agentPhase,
  });
  if (footer) return footer;

  const status = props.currentStatus?.trim();
  if (status && !/^探索代码库 ·/.test(status)) return status;

  if (props.processBlocks.length) {
    return summarizeCursorProcessBlocks(
      props.processBlocks,
      props.toolCount ?? liveTools.value.length,
      true,
    );
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
  if (props.answerText.trim() && props.agentPhase === "streaming_model") return false;
  if (isWaitingModel.value) return Boolean(liveRailPrimary.value.trim());
  return Boolean(liveRailPrimary.value.trim());
});

function onProcessToggle(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  emit("toggle-process", target.open);
}

function bindScrollEl(el: HTMLElement | null) {
  if (!props.messageId || !props.bindStatusLogScroll) return;
  props.bindStatusLogScroll(el, props.messageId);
}

function onTimelineScroll() {
  if (props.messageId && props.onStatusLogScroll) {
    props.onStatusLogScroll(props.messageId);
  }
}

onMounted(() => bindScrollEl(timelineRoot.value));
onUnmounted(() => bindScrollEl(null));
watch(timelineRoot, (el) => bindScrollEl(el));
</script>

<style scoped>
.agent-stream {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 0;
}

.stream-timeline {
  min-width: 0;
}

.stream-timeline--running :deep(.cursor-thought) {
  padding: 2px 0 4px;
}

.cursor-live-status {
  padding: 2px 0 4px;
}

.cursor-live-status .cursor-status-text {
  font-size: 12px;
  line-height: 1.45;
  color: rgba(148, 163, 184, 0.65);
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
  padding: 3px 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(148, 163, 184, 0.58);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  transition: color 120ms ease;
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
  color: rgba(165, 214, 255, 0.82);
}

.stream-process-meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stream-process-body {
  padding: 2px 0 0;
  margin: 2px 0 0;
  padding-left: 10px;
  border-left: 1px solid rgba(148, 163, 184, 0.08);
}

.stream-answer {
  min-width: 0;
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.agent-stream--running .stream-answer:not(:empty) {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.stream-answer--after-process {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.agent-stream:not(.agent-stream--running) .stream-answer {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
</style>
