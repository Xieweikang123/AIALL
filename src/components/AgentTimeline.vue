<template>
  <div class="cursor-timeline-body">
    <!-- 控制按钮（仅在有步骤时显示） -->
    <div v-if="blocks.length" class="cursor-timeline-controls">
      <button
        v-if="isRunning && showCompact"
        type="button"
        class="cursor-activity-detailed"
        @click="$emit('toggle-detailed')"
      >
        展开步骤
      </button>
      <button
        v-if="isRunning && isDetailed"
        type="button"
        class="cursor-activity-detailed"
        @click="$emit('collapse-detailed')"
      >
        收起步骤
      </button>
    </div>
    <!-- 步骤列表 -->
    <div class="cursor-timeline-steps">
      <template v-for="block in blocks" :key="block.key">
        <AgentThoughtBlock
          v-if="block.kind === 'thought'"
          :block="block"
          :streaming="isRunning"
        />
        <AgentActionBlock
          v-else-if="block.kind === 'actions'"
          :block="block"
        />
        <p v-else-if="block.kind === 'status'" class="cursor-action planning">{{ block.text }}</p>
      </template>
    </div>
    <!-- 回到最新按钮 -->
    <button
      v-if="showJump"
      type="button"
      class="cursor-chain-jump"
      title="回到最新"
      aria-label="回到最新"
      @click="$emit('jump-latest')"
    >
      ↓
    </button>
  </div>
</template>

<script setup lang="ts">
import AgentThoughtBlock from "./AgentThoughtBlock.vue";
import AgentActionBlock from "./AgentActionBlock.vue";
import type { CursorFeedProcessBlock } from "../services/agentCursorFeed";

defineProps<{
  blocks: CursorFeedProcessBlock[];
  isRunning: boolean;
  isDetailed: boolean;
  showCompact: boolean;
  showJump: boolean;
}>();

defineEmits<{
  "toggle-detailed": [];
  "collapse-detailed": [];
  "jump-latest": [];
}>();
</script>

<style scoped>
.cursor-timeline-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cursor-timeline-controls {
  display: flex;
  gap: 6px;
  margin-bottom: 2px;
  padding: 0 0 4px;
}

.cursor-timeline-controls button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  color: rgba(139, 148, 158, 0.75);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cursor-timeline-controls button:hover {
  color: rgba(230, 237, 243, 0.9);
  background: rgba(88, 166, 255, 0.08);
  border-color: rgba(88, 166, 255, 0.2);
}

.cursor-timeline-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cursor-action.planning {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-style: normal;
  color: rgba(88, 166, 255, 0.85);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(88, 166, 255, 0.04);
  border-radius: 4px;
  margin: 2px 0;
  font-size: 11.5px;
}

.cursor-action.planning::before {
  content: "";
  width: 10px;
  height: 10px;
  border: 1.5px solid rgba(88, 166, 255, 0.25);
  border-top-color: rgba(88, 166, 255, 0.8);
  border-radius: 50%;
  animation: planning-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes planning-spin {
  to { transform: rotate(360deg); }
}

.cursor-chain-jump {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 8px;
  border: 1px solid rgba(88, 166, 255, 0.2);
  border-radius: 4px;
  background: rgba(1, 4, 9, 0.85);
  color: rgba(88, 166, 255, 0.85);
  font-size: 11px;
  cursor: pointer;
  z-index: 10;
  transition: all 0.15s ease;
}

.cursor-chain-jump:hover {
  background: rgba(88, 166, 255, 0.12);
  border-color: rgba(88, 166, 255, 0.35);
}
</style>
