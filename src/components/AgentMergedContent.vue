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

    <!-- 最终回答 -->
    <ChatMarkdown
      v-if="finalAnswer && finalAnswer.trim()"
      class="cursor-merged-answer"
      :content="finalAnswer"
      :streaming="isRunning && !finalAnswerComplete"
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
  finalAnswerComplete: boolean;
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
    keepVisible: 8,
    collapseAfter: 6,
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

.cursor-merged-answer {
  margin: 4px 0 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
</style>
