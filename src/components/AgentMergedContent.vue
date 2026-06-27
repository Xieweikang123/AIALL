<template>
  <div class="agent-feed">
    <AgentCursorTimeline
      v-if="showTimeline"
      :process-blocks="agentTimeline.processBlocks"
      :answer-text="answerText"
      :answer-streaming="Boolean(answerStreaming)"
      :is-running="isRunning"
      :has-answer="hasAnswer"
      :tool-count="toolCount"
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
      :message-id="messageId"
      :bind-status-log-scroll="bindStatusLogScroll"
      :on-status-log-scroll="onStatusLogScroll"
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
    </AgentCursorTimeline>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AgentCursorTimeline from "./AgentCursorTimeline.vue";
import { useStableAgentAnswer } from "../composables/useStableAgentAnswer";
import { buildUnifiedAgentTimeline } from "../services/agentCompactStatus";
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
    messageId?: string;
    bindStatusLogScroll?: (el: HTMLElement | null, msgId: string) => void;
    onStatusLogScroll?: (msgId: string) => void;
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

const agentTimeline = computed(() =>
  buildUnifiedAgentTimeline({
    roundGroups: props.showProcess === false ? [] : props.roundGroups,
    answerPreview: displayFinalAnswer.value,
    answerStreaming: Boolean(props.answerStreaming),
    isRunning: props.isRunning,
    activityDetailed: Boolean(props.activityDetailed),
    compactFeed: props.compactFeed,
    agentPhase: props.agentPhase,
    agentDetail: props.agentDetail,
  }),
);

const answerText = computed(() => agentTimeline.value.answer?.text ?? displayFinalAnswer.value);
const answerStreaming = computed(
  () => agentTimeline.value.answer?.streaming ?? Boolean(props.answerStreaming),
);
const hasAnswer = computed(() => Boolean(agentTimeline.value.answer));
const toolCount = computed(() => {
  let count = 0;
  for (const block of agentTimeline.value.processBlocks) {
    if (block.kind === "actions") {
      count += block.collapsed.length + block.visible.length;
    }
  }
  return count || props.tools?.length || 0;
});

const showTimeline = computed(
  () =>
    agentTimeline.value.blocks.length > 0 ||
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
