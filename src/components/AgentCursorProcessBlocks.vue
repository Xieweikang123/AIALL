<template>
  <div class="cursor-process-blocks" :class="{ 'cursor-process-blocks--nested': nested }">
    <template v-for="block in blocks" :key="block.key">
      <div
        v-if="block.kind === 'thought' && block.text.trim()"
        class="cursor-thought"
      >
        <ChatMarkdown
          class="inline-feed-markdown inline-feed-markdown--narrative"
          :content="narrativeMarkdown(block.text)"
          :streaming="false"
          :interactive="false"
        />
      </div>

      <AgentActionBlock
        v-else-if="block.kind === 'actions'"
        :block="block"
        @open-file="(path) => emit('openFile', path)"
      />

      <div
        v-else-if="block.kind === 'status' && block.text.trim()"
        class="cursor-status"
        :class="{ 'cursor-status--active': block.active }"
      >
        <span
          class="cursor-status-text"
          :class="{ 'shimmer-text--fast': block.active }"
        >
          {{ block.text }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import ChatMarkdown from "./ChatMarkdown.vue";
import AgentActionBlock from "./AgentActionBlock.vue";
import type { CursorFeedProcessBlock } from "../services/agentCursorFeed";
import { sanitizeFeedThoughtText } from "../services/agentProgressMarker";

withDefaults(
  defineProps<{
    blocks: CursorFeedProcessBlock[];
    nested?: boolean;
  }>(),
  {
    nested: false,
  },
);

defineEmits<{
  openFile: [path: string];
}>();

function narrativeMarkdown(text: string) {
  return sanitizeFeedThoughtText(text);
}
</script>

<style scoped>
.cursor-process-blocks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cursor-process-blocks--nested {
  padding-left: 2px;
}

.cursor-thought {
  padding: 0 0 4px;
}

.inline-feed-markdown--narrative :deep(.msg-markdown) {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(148, 163, 184, 0.72);
}

.cursor-status {
  padding: 2px 0 4px;
}

.cursor-status-text {
  font-size: 12px;
  line-height: 1.45;
  color: rgba(148, 163, 184, 0.65);
}

.cursor-status--active .cursor-status-text {
  color: rgba(190, 218, 255, 0.88);
}
</style>
