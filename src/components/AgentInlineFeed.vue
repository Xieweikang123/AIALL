<template>
  <div class="agent-stream" :class="{ 'agent-stream--running': isRunning }">
    <div
      v-if="showLiveTimeline"
      class="stream-timeline"
      :class="{ 'stream-timeline--running': isRunning }"
    >
      <AgentInlineFeedItems
        :items="liveTimelineItems"
        :is-running="isRunning"
        :chat-mode="chatMode"
        :can-execute-plan="false"
        :layout-enhance-ready="layoutEnhanceReady"
        :preserve-collapsed="true"
        :tool-default-visible="isRunning ? 3 : 8"
        tool-display="inline"
        @open-file="(path) => emit('openFile', path)"
      />
    </div>

    <details
      v-if="showCompletedProcessDetails"
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
          :items="completedProcessDetails"
          :is-running="false"
          :chat-mode="chatMode"
          :can-execute-plan="false"
          :layout-enhance-ready="layoutEnhanceReady"
          tool-display="inline"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>
    </details>

    <div v-if="showAnswerBlock" class="stream-answer">
      <AgentInlineFeedItems
        v-if="answerItem"
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

    <div
      v-if="isRunning && liveRailVisible"
      class="stream-live-rail"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        v-if="isWaitingModel"
        class="stream-live-rail-progress stream-live-rail-progress--indeterminate"
        aria-hidden="true"
      >
        <div class="stream-live-rail-progress-indeterminate" />
      </div>
      <div class="stream-live-rail-row">
        <span class="stream-live-rail-dot" aria-hidden="true" />
        <div class="stream-live-rail-body">
          <div class="stream-live-rail-line">
            <span
              class="stream-live-rail-phase"
              :class="{ 'shimmer-text--fast': !hasAnswer }"
            >
              {{ liveRailParts.phase }}
            </span>
            <span
              v-for="(meta, index) in liveRailParts.meta"
              :key="`${meta}-${index}`"
              class="stream-live-rail-chip"
            >
              {{ meta }}
            </span>
          </div>
          <span v-if="liveRailSecondary" class="stream-live-rail-secondary">
            {{ liveRailSecondary }}
          </span>
        </div>
        <button
          v-if="showDebug"
          type="button"
          class="stream-live-rail-debug"
          :title="debugExpanded ? '收起调试' : '展开调试'"
          @click="emit('toggle-debug')"
        >
          {{ debugExpanded ? "▾" : "▸" }}
        </button>
      </div>
    </div>

    <div v-if="showTruncatedWarning" class="stream-truncated">
      <span class="stream-truncated__text">回答可能不完整</span>
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
import { formatCursorActionLabel } from "../services/agentCursorFeed";
import { buildAgentLiveFooterStatus } from "../services/agentCompactStatus";
import {
  collectToolsFromInlineFeed,
  filterInlineTimelineItems,
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
  agentPhase?: string;
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

const showAnswerBlock = computed(() => {
  if (answerItem.value?.text.trim()) return true;
  if (answerItem.value?.streaming && props.isRunning) return true;
  if (!props.isRunning && answerItem.value) return true;
  return false;
});

const answerPreviewText = computed(() => answerItem.value?.text.trim() ?? "");

const liveTimelineItems = computed((): InlineFeedItem[] => {
  if (!processItems.value.length) return [];
  return filterInlineTimelineItems(processItems.value, {
    answerPreview: answerPreviewText.value,
    hideNarratives: !props.isRunning && Boolean(answerPreviewText.value || props.hasAnswer),
  });
});

const showLiveTimeline = computed(
  () => props.isRunning && liveTimelineItems.value.length > 0,
);

const showCompletedProcessDetails = computed(
  () => !props.isRunning && processItems.value.length > 0,
);

const completedProcessDetails = computed((): InlineFeedItem[] => {
  if (props.isRunning) return [];
  return filterInlineTimelineItems(processItems.value, {
    answerPreview: answerPreviewText.value,
    hideNarratives: Boolean(answerPreviewText.value || props.hasAnswer),
  });
});

const MODEL_WAIT_PHASES = new Set(["waiting_model", "sending_request", "retrying_model"]);

const liveRailPrimary = computed((): string => {
  const status = props.currentStatus?.trim();
  if (status) return status;

  if (showLiveTimeline.value && (props.hasRunningTool || liveTools.value.some((step) => step.running))) {
    const footer = buildAgentLiveFooterStatus({
      currentStatus: props.currentStatus,
      isRunning: true,
      hasAnswer: props.hasAnswer,
      hasRunningTool: true,
      hasActionBlocks: (props.toolCount ?? 0) > 0,
    });
    if (footer) return footer;
    return "执行工具中…";
  }

  const running = liveTools.value.find((step) => step.running);
  if (running) return formatCursorActionLabel(running);

  const footer = buildAgentLiveFooterStatus({
    currentStatus: props.currentStatus,
    isRunning: true,
    hasAnswer: props.hasAnswer,
    hasRunningTool: props.hasRunningTool,
    hasActionBlocks: (props.toolCount ?? 0) > 0,
  });
  if (footer) return footer;

  if (processItems.value.length) {
    return summarizeInlineFeedProcess(
      processItems.value,
      props.toolCount ?? liveTools.value.length,
      true,
    );
  }

  return "Agent 运行中…";
});

const liveRailParts = computed(() => {
  const primary = liveRailPrimary.value.trim();
  if (!primary) return { phase: "运行中…", meta: [] as string[] };
  const segments = primary.split(" · ").map((part) => part.trim()).filter(Boolean);
  if (segments.length <= 1) return { phase: primary, meta: [] as string[] };
  return { phase: segments[0]!, meta: segments.slice(1) };
});

const isWaitingModel = computed(() => {
  if (props.hasRunningTool) return false;
  if (props.agentPhase && MODEL_WAIT_PHASES.has(props.agentPhase)) return true;
  return liveRailParts.value.phase.includes("等待模型");
});

const liveRailSecondary = computed((): string | null => {
  if (props.isRunning) return null;

  const count = props.toolCount ?? liveTools.value.length;
  if (count <= 0) return null;

  const stats = summarizeInlineFeedProcess(processItems.value, count, true);
  const primary = liveRailPrimary.value;
  if (stats === primary || primary.includes(stats)) return null;

  const running = liveTools.value.find((step) => step.running);
  if (running && primary === formatCursorActionLabel(running)) return stats;

  if (!props.currentStatus?.trim() && !running) return null;
  return stats;
});

const liveRailVisible = computed(() => {
  if (!props.isRunning) return false;
  if (props.hasRunningTool || liveTools.value.some((step) => step.running)) return false;
  if (answerPreviewText.value && props.agentPhase === "streaming_model") return false;
  return Boolean(liveRailPrimary.value.trim());
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
  gap: 6px;
  min-width: 0;
  padding: 0;
}

.stream-timeline {
  min-width: 0;
}

.stream-timeline--running :deep(.process-step-list) {
  max-height: none;
  background: transparent;
}

.stream-timeline--running :deep(.stream-narrative) {
  padding: 2px 0 6px;
}

.stream-process {
  margin: 0;
  min-width: 0;
}

.stream-process--debug {
  margin-top: 6px;
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

.stream-live-rail {
  margin: 0;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(88, 166, 255, 0.14);
  background: rgba(11, 18, 32, 0.55);
  min-width: 0;
  overflow: hidden;
}

.stream-live-rail-progress {
  height: 2px;
  background: rgba(88, 166, 255, 0.1);
}

.stream-live-rail-progress--indeterminate {
  position: relative;
  overflow: hidden;
}

.stream-live-rail-progress-indeterminate {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 38%;
  background: linear-gradient(
    90deg,
    rgba(31, 111, 235, 0),
    rgba(31, 111, 235, 0.85),
    rgba(88, 166, 255, 0.95),
    rgba(31, 111, 235, 0.85),
    rgba(31, 111, 235, 0)
  );
  animation: stream-live-rail-indeterminate 1.35s ease-in-out infinite;
}

@keyframes stream-live-rail-indeterminate {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

.stream-live-rail-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
}

.stream-live-rail-dot {
  width: 7px;
  height: 7px;
  margin-top: 4px;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.85);
  box-shadow: 0 0 8px rgba(88, 166, 255, 0.45);
  flex-shrink: 0;
  animation: stream-live-pulse 1.4s ease-in-out infinite;
}

@keyframes stream-live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.88); }
}

.stream-live-rail-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.stream-live-rail-line {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.stream-live-rail-phase {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.45;
  font-weight: 600;
  color: rgba(190, 218, 255, 0.96);
}

.stream-live-rail-chip {
  flex-shrink: 0;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(165, 205, 255, 0.82);
  background: rgba(88, 166, 255, 0.1);
  border: 1px solid rgba(88, 166, 255, 0.14);
}

.stream-live-rail-secondary {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(148, 163, 184, 0.58);
}

.stream-live-rail-debug {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: rgba(148, 163, 184, 0.45);
  font-size: 9px;
  cursor: pointer;
  padding: 2px 0 0;
}

.stream-live-rail-debug:hover {
  color: rgba(148, 163, 184, 0.75);
}

.stream-answer {
  min-width: 0;
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.agent-stream--running .stream-answer:not(:empty) {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid rgba(88, 166, 255, 0.1);
}

.agent-stream:not(.agent-stream--running) .stream-answer {
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.stream-truncated {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
  padding: 6px 10px;
  border-radius: 8px;
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
  .stream-live-rail-dot {
    animation: none;
  }

  .stream-live-rail-progress-indeterminate {
    animation: none;
    width: 100%;
    background: linear-gradient(90deg, rgba(31, 111, 235, 0.85), rgba(88, 166, 255, 0.95));
  }
}
</style>
