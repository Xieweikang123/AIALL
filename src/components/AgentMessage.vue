<template>
  <div class="cursor-agent-wrap">
    <div class="cursor-timeline">
      <AgentMergedContent
        :compact-feed="showCompact"
        :round-groups="agentRoundGroupViews(msg)"
        :final-answer="timelineAnswerDisplay"
        :answer-streaming="timelineAnswerStreamingDisplay"
        :is-running="isAgentRunning(msg)"
        :current-status="displayAgentStatus(msg)"
        :activity-detailed="isActivityDetailed(msg)"
        :activity-expanded="isActivityExpanded(msg)"
        :can-execute-plan="canExecutePlan"
        :chat-mode="msg.chatMode"
        :show-debug="showDebug"
        :debug-expanded="isActivityDetailed(msg)"
        :tools="msg.tools"
        :agent-turn="activeAgentTurn(msg)"
        :agent-max-turns="msg.agentMaxTurns"
        :agent-phase="activeAgentPhase(msg)"
        :agent-detail="activeAgentDetail(msg)"
        :can-resume="canResume"
        :resume-label="resumeLabel"
        :written-files="msg.writtenFiles"
        :was-aborted="msg.agentAborted"
        :message-id="msg.id"
        :plan-file-path="msg.planFilePath"
        :bind-status-log-scroll="bindStatusLogScroll"
        :on-status-log-scroll="onStatusLogScroll"
        @execute-plan="emit('execute-plan')"
        @select-option="(option) => emit('select-option', option)"
        @toggle-debug="toggleActivityDetailed(msg)"
        @toggle-process="onToggleProcess"
        @open-file="(path) => emit('open-file', path)"
        @open-plan-file="emit('open-plan-file')"
        @resume="emit('resume')"
      >
        <template #debug>
          <AgentDebugPanel
            :groups="agentRoundGroupViews(msg)"
            :agent-context="msg.agentContext"
            :show-debug="showDebug"
          />
        </template>
      </AgentMergedContent>

      <button
        v-if="!isAgentRunning(msg) && isActivityExpanded(msg) && hasProcessSteps(msg)"
        type="button"
        class="cursor-activity-collapse"
        @click="collapseAgentActivity(msg)"
      >
        收起步骤
      </button>

      <button
        v-if="showJump"
        type="button"
        class="cursor-chain-jump"
        title="跳转到底部"
        @click="jumpToLatest"
      >
        ↓
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";
import AgentMergedContent from "./AgentMergedContent.vue";
import AgentDebugPanel from "./AgentDebugPanel.vue";
import { useAgentMessage, type AgentMessage } from "../composables/useAgentMessage";
import { hasAgentProcessSteps } from "../utils/vibeHelpers";
import type { AiOption } from "../utils/parseAiOptions";

const props = defineProps<{
  msg: AgentMessage;
  isAgentRunning: (msg: AgentMessage) => boolean;
  agentStatusDisplay?: (msg: AgentMessage) => string;
  agentLiveRevision: number;
  patchAssistantMsg: (id: string, patch: Record<string, unknown>) => void;
  schedulePersistChat: () => void;
  messageDisplayContent: (msg: AgentMessage) => string;
  resolveLiveAgentSource?: (msg: AgentMessage) => import("../services/agentMessageDisplay").LiveAgentAnswerSource;
  showJump?: boolean;
  canExecutePlan?: boolean;
  canResume?: boolean;
  resumeLabel?: string;
  bindStatusLogScroll?: (el: HTMLElement | null, msgId: string) => void;
  onStatusLogScroll?: (msgId: string) => void;
}>();

const emit = defineEmits<{
  "jump-latest": [];
  "execute-plan": [];
  "select-option": [option: AiOption];
  "open-file": [path: string];
  "open-plan-file": [];
  resume: [];
}>();

const {
  showDebug,
  isActivityExpanded,
  isActivityDetailed,
  agentRoundGroupViews,
  collapseAgentActivity,
  toggleActivityDetailed,
  toggleActivityExpanded,
  timelineAnswerDisplay,
  timelineAnswerStreamingDisplay,
  currentAgentStatus,
  showCompact,
} = useAgentMessage(
  computed(() => props.msg),
  {
    isAgentRunning: props.isAgentRunning,
    agentLiveRevision: toRef(props, 'agentLiveRevision'),
    patchAssistantMsg: props.patchAssistantMsg,
    schedulePersistChat: props.schedulePersistChat,
    messageDisplayContent: props.messageDisplayContent,
    resolveLiveAgentSource: props.resolveLiveAgentSource,
  },
);

function hasProcessSteps(m: AgentMessage): boolean {
  return hasAgentProcessSteps(m);
}

function onToggleProcess(expanded: boolean) {
  const currently = isActivityExpanded(props.msg);
  if (expanded === currently) return;
  if (expanded) {
    if (!currently) toggleActivityExpanded(props.msg);
    return;
  }
  collapseAgentActivity(props.msg);
}

/** Prefer ephemeral run.live text (planning_tools / waiting_model); fall back to persisted msg fields. */
function displayAgentStatus(m: AgentMessage): string {
  if (!props.isAgentRunning(m)) return "";
  const live = props.agentStatusDisplay?.(m)?.trim();
  if (live) return live;
  return currentAgentStatus(m);
}

function activeAgentTurn(m: AgentMessage): number | undefined {
  return props.resolveLiveAgentSource?.(m)?.agentTurn ?? m.agentTurn;
}

function activeAgentPhase(m: AgentMessage): string | undefined {
  return props.resolveLiveAgentSource?.(m)?.agentPhase ?? m.agentPhase;
}

function activeAgentDetail(m: AgentMessage): string | undefined {
  return m.agentDetail;
}

function jumpToLatest() {
  emit("jump-latest");
}
</script>

<style scoped>
.cursor-agent-wrap {
  margin: 0;
  padding: 0;
}

.cursor-timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.cursor-activity-collapse {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0;
  padding: 3px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(139, 148, 158, 0.72);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  align-self: flex-start;
}

.cursor-activity-collapse:hover {
  color: rgba(230, 237, 243, 0.85);
  background: rgba(88, 166, 255, 0.06);
  border-color: rgba(88, 166, 255, 0.15);
}

.cursor-chain-jump {
  position: sticky;
  bottom: 10px;
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(88, 166, 255, 0.42);
  background: rgba(1, 8, 18, 0.92);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  color: rgba(126, 182, 255, 0.96);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transform: translateX(-50%);
  transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
}

.cursor-chain-jump:hover {
  background: rgba(14, 28, 48, 0.96);
  border-color: rgba(126, 182, 255, 0.65);
  transform: translateX(-50%) translateY(-1px);
}
</style>
