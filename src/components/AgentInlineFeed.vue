<template>
  <div class="agent-inline-feed">
    <AgentInlineFeedItems
      :items="items"
      :is-running="isRunning"
      :chat-mode="chatMode"
      :can-execute-plan="canExecutePlan"
      :layout-enhance-ready="layoutEnhanceReady"
      @execute-plan="emit('execute-plan')"
      @select-option="(option) => emit('select-option', option)"
      @open-file="(path) => emit('openFile', path)"
    />

    <div v-if="liveFooterStatus" class="inline-feed-footer">
      <span class="inline-feed-footer-dot" />
      <span class="inline-feed-footer-text shimmer-text--fast">{{ liveFooterStatus }}</span>
      <button
        v-if="showDebug"
        type="button"
        class="inline-feed-footer-debug"
        :title="debugExpanded ? '收起调试' : '展开调试'"
        @click="emit('toggle-debug')"
      >
        {{ debugExpanded ? "▾" : "▸" }}
      </button>
    </div>

    <div v-if="showTruncatedWarning" class="inline-feed-truncated">
      <span class="inline-feed-truncated__text">回答可能不完整（以冒号、省略号或未闭合格式结尾）。</span>
      <button
        v-if="canResume"
        type="button"
        class="inline-feed-truncated__action"
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
import { buildAgentLiveFooterStatus } from "../services/agentCompactStatus";
import type { InlineFeedItem } from "../services/agentInlineFeed";
import type { AiOption } from "../utils/parseAiOptions";

const props = defineProps<{
  items: InlineFeedItem[];
  isRunning: boolean;
  hasAnswer: boolean;
  toolCount?: number;
  chatMode?: "ask" | "build" | "plan";
  canExecutePlan?: boolean;
  layoutEnhanceReady?: boolean;
  showDebug?: boolean;
  debugExpanded?: boolean;
  showTruncatedWarning?: boolean;
  canResume?: boolean;
  resumeLabel?: string;
  currentStatus?: string;
  hasRunningTool?: boolean;
}>();

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  "toggle-debug": [];
  openFile: [path: string];
  resume: [];
}>();

const liveFooterStatus = computed(() =>
  buildAgentLiveFooterStatus({
    currentStatus: props.currentStatus,
    isRunning: props.isRunning,
    hasAnswer: props.hasAnswer,
    hasRunningTool: props.hasRunningTool,
    hasActionBlocks: (props.toolCount ?? 0) > 0,
  }),
);
</script>

<style scoped>
.agent-inline-feed {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 2px 0 4px;
}

.inline-feed-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: rgba(148, 163, 184, 0.72);
}

.inline-feed-footer-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.55);
  flex-shrink: 0;
  animation: inline-feed-pulse 1.4s ease-in-out infinite;
}

@keyframes inline-feed-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.inline-feed-footer-text {
  flex: 1;
  min-width: 0;
}

.inline-feed-footer-debug {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: rgba(148, 163, 184, 0.45);
  font-size: 9px;
  cursor: pointer;
  padding: 0 2px;
}

.inline-feed-footer-debug:hover {
  color: rgba(148, 163, 184, 0.75);
}

.inline-feed-truncated {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(210, 153, 34, 0.08);
  border: 1px solid rgba(210, 153, 34, 0.18);
}

.inline-feed-truncated__text {
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 214, 130, 0.92);
}

.inline-feed-truncated__action {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid rgba(210, 153, 34, 0.35);
  background: rgba(210, 153, 34, 0.12);
  color: rgba(255, 230, 170, 0.96);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
</style>
