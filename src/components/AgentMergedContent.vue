<template>
  <div class="agent-feed">
    <AgentInlineFeed
      v-if="showTimeline"
      :items="inlineFeed.items"
      :is-running="isRunning"
      :has-answer="inlineFeed.hasAnswer"
      :tool-count="inlineFeed.toolCount"
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
      :activity-expanded="activityExpanded"
      :agent-phase="agentPhase"
      @execute-plan="emit('execute-plan')"
      @select-option="(option) => emit('select-option', option)"
      @toggle-debug="emit('toggle-debug')"
      @toggle-process="(expanded) => emit('toggle-process', expanded)"
      @open-file="(path) => emit('openFile', path)"
      @resume="emit('resume')"
    >
      <template #debug>
        <slot name="debug" />
      </template>
    </AgentInlineFeed>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AgentInlineFeed from "./AgentInlineFeed.vue";
import { useStableAgentAnswer } from "../composables/useStableAgentAnswer";
import { buildInlineAgentFeed } from "../services/agentInlineFeed";
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
    activityExpanded?: boolean;
    canExecutePlan?: boolean;
    chatMode?: "ask" | "build" | "plan" | "explore";
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
  "toggle-process": [expanded: boolean];
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

const inlineFeed = computed(() =>
  buildInlineAgentFeed({
    roundGroups: props.roundGroups,
    answerPreview: displayFinalAnswer.value,
    answerStreaming: Boolean(props.answerStreaming),
    isRunning: props.isRunning,
    activityDetailed: Boolean(props.activityDetailed),
    compactFeed: props.compactFeed,
    showProcess: props.showProcess,
    agentPhase: props.agentPhase,
    agentDetail: props.agentDetail,
  }),
);

const showTimeline = computed(
  () =>
    inlineFeed.value.items.length > 0 ||
    (props.isRunning && Boolean(props.currentStatus?.trim()) && !displayFinalAnswer.value.trim()),
);
</script>

<style scoped>
.agent-feed {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
