<template>
  <div class="cursor-merged-content">
    <template v-for="block in mergedBlocks" :key="block.key">
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

    <!-- 当前状态（运行中显示） -->
    <p v-if="isRunning && currentStatus" class="cursor-action planning">{{ currentStatus }}</p>

    <!-- 最终回答（仅完成后显示） -->
    <ChatMarkdown
      v-if="!isRunning && finalAnswer && finalAnswer.trim()"
      class="cursor-merged-answer"
      :content="finalAnswer"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import AgentThoughtBlock from "./AgentThoughtBlock.vue";
import AgentActionBlock from "./AgentActionBlock.vue";
import {
  layoutCursorFeedBlocks,
  type CursorFeedItem,
  type CursorFeedProcessBlock,
} from "../services/agentCursorFeed";
import type { AgentRoundGroupView } from "../services/agentRoundGroups";

const props = defineProps<{
  roundGroups: AgentRoundGroupView[];
  finalAnswer: string;
  isRunning: boolean;
  currentStatus?: string;
}>();

const mergedBlocks = computed<CursorFeedProcessBlock[]>(() => {
  const items: CursorFeedItem[] = [];

  for (const group of props.roundGroups) {
    if (group.turn <= 0 && !group.narrative) continue;

    // 添加思考/推理文本
    if (group.narrative?.trim()) {
      items.push({
        kind: "thought",
        key: `thought-${group.turn}`,
        text: group.narrative.trim(),
      });
    }

    // 添加工具调用
    for (const tool of group.tools) {
      items.push({
        kind: "action",
        key: tool.id,
        step: tool,
      });
    }
  }

  return layoutCursorFeedBlocks(items, {
    keepVisible: 3,
    collapseAfter: 3,
  });
});
</script>

<style scoped>
.cursor-merged-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
}

.cursor-action.planning {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-style: normal;
  color: rgba(139, 148, 158, 0.85);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(139, 148, 158, 0.06);
  border-radius: 6px;
  margin: 2px 0;
  font-size: 12px;
}

.cursor-action.planning::before {
  content: "";
  width: 8px;
  height: 8px;
  border: 1.5px solid rgba(139, 148, 158, 0.3);
  border-top-color: rgba(139, 148, 158, 0.8);
  border-radius: 50%;
  animation: planning-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes planning-spin {
  to { transform: rotate(360deg); }
}

.cursor-merged-answer {
  margin: 4px 0 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
</style>
