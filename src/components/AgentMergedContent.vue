<template>
  <div class="agent-feed">
    <AgentCursorTimeline
      v-if="showTimeline"
      :inline-items="inlineFeed.items"
      :is-running="isRunning"
      :chat-mode="chatMode"
      :can-execute-plan="canExecutePlan"
      :intent-trace="intentTrace"
      :layout-enhance-ready="layoutEnhanceReady"
      :current-status="currentStatus"
      :has-running-tool="hasRunningTool"
      :activity-detailed="activityDetailed"
      :activity-expanded="activityExpanded"
      :agent-phase="agentPhase"
      :agent-turn="agentTurn"
      :round-groups="roundGroups"
      :message-id="messageId"
      :plan-file-path="planFilePath"
      :bind-status-log-scroll="bindStatusLogScroll"
      :on-status-log-scroll="onStatusLogScroll"
      @execute-plan="emit('execute-plan')"
      @select-option="(option) => emit('select-option', option)"
      @toggle-debug="emit('toggle-debug')"
      @toggle-process="(v: boolean) => emit('toggle-process', v)"
      @open-file="(path) => emit('openFile', path)"
      @open-plan-file="emit('open-plan-file')"
    >
    </AgentCursorTimeline>

    <button
      v-if="agentDebugEnabled && roundGroups.length"
      type="button"
      class="agent-trace-entry"
      title="在右侧抽屉中查看数据流轨迹"
      @click="openTraceDrawer(messageId ?? null, roundGroups)"
    >
      <span class="agent-trace-entry-icon">⟲</span>
      <span>数据流轨迹</span>
      <span class="agent-trace-entry-meta">{{ roundGroups.length }} 轮</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AgentCursorTimeline from "./AgentCursorTimeline.vue";
import { agentDebugEnabled } from "../utils/agentDebugFlag";
import { openTraceDrawer, registerLatestTrace } from "../services/agentTraceDrawer";
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
    intentTrace?: {
      aiRawResponse?: string;
      aiMessages?: Array<{ role: string; content: string }>;
      finalResult?: string;
      skippedAi?: boolean;
      aiModel?: string;
      elapsedMs?: number;
      aiPrimary?: string;
      aiFailed?: boolean;
      aiError?: string;
      aiStage?: string;
    };
    chatMode?: "ask" | "build" | "plan" | "explore" | "auto";
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

let traceSeq = 0;

// 注册为「最新一条」轨迹，供调试按钮直开抽屉时展示
watch(
  () => [props.messageId, props.roundGroups, props.isRunning] as const,
  ([messageId, groups, running]) => {
    if (running) return;
    registerLatestTrace(messageId ?? `trace-${traceSeq++}`, groups);
  },
  { immediate: true, deep: false },
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

.agent-trace-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin: 6px 0 2px;
  padding: 4px 10px;
  border: 1px solid rgba(126, 182, 255, 0.22);
  border-radius: 6px;
  background: rgba(88, 166, 255, 0.08);
  color: rgba(165, 214, 255, 0.92);
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.agent-trace-entry:hover {
  background: rgba(88, 166, 255, 0.16);
  border-color: rgba(126, 182, 255, 0.4);
  color: rgba(190, 225, 255, 1);
}

.agent-trace-entry-icon {
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
}

.agent-trace-entry-meta {
  color: rgba(126, 182, 255, 0.6);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
}
</style>
