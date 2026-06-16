<template>
  <div class="cursor-agent-wrap" :class="{ collapsed: isFolded }">
    <!-- 折叠视图 -->
    <AgentFoldedView
      v-if="isFolded"
      :summary="summary"
      @expand="toggleActivityExpanded(msg)"
    />

    <!-- 展开时间线 -->
    <div v-else class="cursor-timeline">
      <!-- 合并内容：文字 + 工具调用穿插显示 -->
      <AgentMergedContent
        :round-groups="agentRoundGroupViews(msg)"
        :final-answer="timelineAnswerContent(msg)"
        :is-running="isAgentRunning(msg)"
        :current-status="currentAgentStatus(msg)"
      />

      <!-- 调试面板 -->
      <AgentDebugPanel
        :groups="agentRoundGroupViews(msg)"
        :agent-context="msg.agentContext"
        :show-debug="showDebug"
      />

      <!-- 收起按钮 -->
      <button
        v-if="!isAgentRunning(msg)"
        type="button"
        class="cursor-activity-collapse"
        @click="collapseAgentActivity(msg)"
      >
        收起过程
      </button>

      <!-- 跳转到底部 -->
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
import { computed, toRef, type Ref } from "vue";
import AgentFoldedView from "./AgentFoldedView.vue";
import AgentMergedContent from "./AgentMergedContent.vue";
import AgentDebugPanel from "./AgentDebugPanel.vue";
import { useAgentMessage, type AgentMessage } from "../composables/useAgentMessage";

const props = defineProps<{
  msg: AgentMessage;
  isAgentRunning: (msg: any) => boolean;
  agentUiTick: number;
  patchAssistantMsg: (id: string, patch: Record<string, unknown>) => void;
  schedulePersistChat: () => void;
  messageDisplayContent: (msg: any) => string;
  showJump?: boolean;
}>();

const emit = defineEmits<{
  "jump-latest": [];
}>();

const {
  isFolded,
  showDebug,
  isActivityExpanded,
  isActivityDetailed,
  agentRoundGroupViews,
  toggleActivityExpanded,
  collapseAgentActivity,
  toggleActivityDetailed,
  collapseActivityDetailed,
  cursorActivitySummary,
  timelineAnswerContent,
  currentAgentStatus,
} = useAgentMessage(
  computed(() => props.msg),
  {
    isAgentRunning: props.isAgentRunning,
    agentUiTick: toRef(props, 'agentUiTick'),
    patchAssistantMsg: props.patchAssistantMsg,
    schedulePersistChat: props.schedulePersistChat,
    messageDisplayContent: props.messageDisplayContent,
  },
);

const summary = computed(() => cursorActivitySummary(props.msg));

function jumpToLatest() {
  emit("jump-latest");
}
</script>

<style scoped>
.cursor-agent-wrap {
  margin: 0 0 4px;
  padding: 2px 0;
}

.cursor-agent-wrap.collapsed {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 0;
  padding: 0;
}

.cursor-timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
}

.cursor-activity-collapse {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  color: rgba(139, 148, 158, 0.6);
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
