<template>
  <div class="agent-feed">
    <AgentTimelineFeed
      v-if="showTimeline"
      :blocks="visibleBlocks"
      :is-running="isRunning"
      :compact-tools="compactFeed"
      :chat-mode="chatMode"
      :can-execute-plan="canExecutePlan"
      :layout-enhance-ready="layoutEnhanceReady"
      :show-debug="showDebug"
      :debug-expanded="debugExpanded"
      :show-truncated-warning="showTruncatedWarning"
      :can-resume="canResume"
      :resume-label="resumeLabel"
      :current-status="currentStatus"
      :has-running-tool="hasRunningTool"
      :activity-detailed="activityDetailed"
      @execute-plan="emit('execute-plan')"
      @select-option="(option) => emit('select-option', option)"
      @toggle-debug="emit('toggle-debug')"
      @open-file="(path) => emit('openFile', path)"
      @resume="emit('resume')"
    >
      <template #debug>
        <slot name="debug" />
      </template>
    </AgentTimelineFeed>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AgentTimelineFeed from "./AgentTimelineFeed.vue";
import { useStableAgentAnswer } from "../composables/useStableAgentAnswer";
import { buildUnifiedAgentTimelineBlocks } from "../services/agentCompactStatus";
import type { AgentRoundGroupView, AgentRoundTool } from "../services/agentRoundGroups";
import {
  buildWrittenFilesSummary,
  isTruncatedAssistantAnswer,
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
    chatMode?: "ask" | "build" | "plan";
    showDebug?: boolean;
    debugExpanded?: boolean;
    showProcess?: boolean;
    compactFeed?: boolean;
    tools?: AgentRoundTool[];
    agentTurn?: number;
    agentMaxTurns?: number;
    agentPhase?: string;
    agentDetail?: string;
    canResume?: boolean;
    resumeLabel?: string;
    writtenFiles?: string[];
    wasAborted?: boolean;
  }>(),
  {
    showProcess: true,
    compactFeed: false,
  },
);

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  "toggle-debug": [];
  openFile: [path: string];
  resume: [];
}>();

const layoutEnhanceReady = ref(false);

const { stableAnswer } = useStableAgentAnswer(
  () => props.finalAnswer,
  () => props.isRunning,
);

watch(
  () => props.isRunning || props.answerStreaming,
  (active) => {
    if (active) {
      layoutEnhanceReady.value = false;
      return;
    }
    void nextTick(() => {
      layoutEnhanceReady.value = true;
    });
  },
  { immediate: true },
);

const writtenFilesSummary = computed(() => {
  if (!props.writtenFiles?.length || props.isRunning) return "";
  return buildWrittenFilesSummary(props.writtenFiles, Boolean(props.wasAborted));
});

const displayFinalAnswer = computed(() => {
  const raw = props.isRunning && stableAnswer.value.trim() ? stableAnswer.value : props.finalAnswer;
  const base = raw.trim();
  if (base) return raw;
  return writtenFilesSummary.value;
});

const hasRunningTool = computed(() => Boolean(props.tools?.some((tool) => tool.running)));

const showTruncatedWarning = computed(
  () =>
    !props.isRunning &&
    Boolean(displayFinalAnswer.value.trim()) &&
    isTruncatedAssistantAnswer(displayFinalAnswer.value),
);

const timelineBlocks = computed(() =>
  buildUnifiedAgentTimelineBlocks({
    roundGroups: props.roundGroups,
    answerPreview: displayFinalAnswer.value,
    answerStreaming: Boolean(props.answerStreaming),
    isRunning: props.isRunning,
    activityDetailed: Boolean(props.activityDetailed),
    compactFeed: props.compactFeed,
    agentPhase: props.agentPhase,
    agentDetail: props.agentDetail,
  }),
);

const visibleBlocks = computed(() => {
  if (props.showProcess) return timelineBlocks.value;
  return timelineBlocks.value.filter((block) => block.kind === "answer");
});

const showTimeline = computed(
  () =>
    visibleBlocks.value.length > 0 ||
    (props.isRunning && Boolean(props.currentStatus?.trim()) && !displayFinalAnswer.value.trim()),
);
</script>

<style scoped>
.agent-feed {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 0;
  min-width: 0;
  overflow: hidden;
}
</style>
