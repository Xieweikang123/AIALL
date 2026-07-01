<template>
  <div class="agent-feed">
    <AgentCursorTimeline
      v-if="showTimeline"
      :inline-items="inlineFeed.items"
      :is-running="isRunning"
      :chat-mode="chatMode"
      :can-execute-plan="canExecutePlan"
      :layout-enhance-ready="layoutEnhanceReady"
      :show-debug="showDebug"
      :debug-expanded="debugExpanded"
      :current-status="currentStatus"
      :has-running-tool="hasRunningTool"
      :activity-detailed="activityDetailed"
      :agent-phase="agentPhase"
      :message-id="messageId"
      :plan-file-path="planFilePath"
      :bind-status-log-scroll="bindStatusLogScroll"
      :on-status-log-scroll="onStatusLogScroll"
      @execute-plan="emit('execute-plan')"
      @select-option="(option) => emit('select-option', option)"
      @toggle-debug="emit('toggle-debug')"
      @open-file="(path) => emit('openFile', path)"
      @open-plan-file="emit('open-plan-file')"
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
import { buildInlineAgentFeed } from "../services/agentInlineFeed";
import type { AgentRoundGroupView, AgentRoundTool } from "../services/agentRoundGroups";
import { buildWrittenFilesSummary } from "../services/agentMessageDisplay";
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
    planFilePath?: string;
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
  "open-plan-file": [];
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

const inlineFeed = computed(() =>
  buildInlineAgentFeed({
    roundGroups: props.showProcess === false ? [] : props.roundGroups,
    answerPreview: displayFinalAnswer.value,
    answerStreaming: Boolean(props.answerStreaming),
    isRunning: props.isRunning,
    activityDetailed: Boolean(props.activityDetailed),
    compactFeed: props.compactFeed,
    agentPhase: props.agentPhase,
    agentDetail: props.agentDetail,
    chatMode: props.chatMode,
    showProcess: props.showProcess !== false,
  }),
);

const showTimeline = computed(
  () => props.isRunning || inlineFeed.value.items.length > 0,
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
