<template>
  <template v-for="item in items" :key="renderKey(item)">
    <details
      v-if="item.kind === 'collapsed'"
      class="inline-feed-collapsed"
      :open="collapsedOpen"
      @toggle="onCollapsedToggle"
    >
      <summary class="inline-feed-collapsed-summary">
        <span class="inline-feed-collapsed-label">{{ item.summary }}</span>
      </summary>
      <div class="inline-feed-collapsed-body">
        <AgentInlineFeedItems
          :items="item.items"
          :is-running="isRunning"
          :chat-mode="chatMode"
          :can-execute-plan="canExecutePlan"
          :layout-enhance-ready="layoutEnhanceReady"
          nested
          @execute-plan="emit('execute-plan')"
          @select-option="(option) => emit('select-option', option)"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>
    </details>

    <div
      v-else-if="item.kind === 'text'"
      class="inline-feed-segment"
      :class="{ 'inline-feed-segment--answer': item.variant === 'answer' }"
    >
      <div
        v-if="item.variant === 'answer' && item.streaming && isRunning && !item.text.trim()"
        class="inline-feed-placeholder"
      >
        <span class="shimmer-text--fast">正在生成…</span>
      </div>
      <PlanDocumentBlock
        v-else-if="item.variant === 'answer'"
        :content="item.text"
        :chat-mode="chatMode"
        :streaming="item.streaming && isRunning"
        :can-execute="canExecutePlan && !isRunning && !item.streaming"
        :enhance-layout="layoutEnhanceReady && !isRunning && !item.streaming"
        @execute="emit('execute-plan')"
      >
        <ChatMarkdown
          class="inline-feed-markdown inline-feed-markdown--answer"
          :content="answerMarkdown(item.text)"
          :streaming="item.streaming && isRunning"
          :interactive="true"
          @select-option="(option) => emit('select-option', option)"
        />
      </PlanDocumentBlock>
      <ChatMarkdown
        v-else-if="item.text.trim()"
        class="inline-feed-markdown inline-feed-markdown--narrative"
        :class="{ 'inline-feed-markdown--nested': nested }"
        :content="narrativeMarkdown(item.text)"
        :streaming="false"
        :interactive="false"
      />
    </div>

    <AgentInlineToolCard
      v-else-if="item.kind === 'tool'"
      :step="item.step"
      @open-file="(path) => emit('openFile', path)"
    />
  </template>
</template>

<script setup lang="ts">
import { ref } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import PlanDocumentBlock from "./PlanDocumentBlock.vue";
import AgentInlineToolCard from "./AgentInlineToolCard.vue";
import type { InlineFeedItem } from "../services/agentInlineFeed";
import { sanitizeFeedThoughtText } from "../services/agentProgressMarker";
import { enrichPlanMarkdownForDisplay } from "../services/planDocumentDisplay";
import type { AiOption } from "../utils/parseAiOptions";

defineOptions({ name: "AgentInlineFeedItems" });

const props = withDefaults(
  defineProps<{
    items: InlineFeedItem[];
    isRunning: boolean;
    chatMode?: "ask" | "build" | "plan";
    canExecutePlan?: boolean;
    layoutEnhanceReady?: boolean;
    nested?: boolean;
  }>(),
  { nested: false },
);

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  openFile: [path: string];
}>();

const collapsedOpen = ref(false);

function onCollapsedToggle(event: Event) {
  const target = event.target;
  if (target instanceof HTMLDetailsElement) {
    collapsedOpen.value = target.open;
  }
}

function renderKey(item: InlineFeedItem): string {
  return `${item.kind}:${item.key}`;
}

function narrativeMarkdown(text: string) {
  return sanitizeFeedThoughtText(text);
}

function answerMarkdown(text: string) {
  return enrichPlanMarkdownForDisplay(text, {
    whileStreaming: Boolean(props.isRunning),
  });
}
</script>

<style scoped>
.inline-feed-segment {
  min-width: 0;
}

.inline-feed-segment--answer {
  margin-top: 2px;
}

.inline-feed-markdown {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
}

.inline-feed-markdown--narrative :deep(.msg-markdown) {
  font-size: 13px;
  line-height: 1.55;
  color: rgba(230, 237, 243, 0.92);
}

.inline-feed-markdown--narrative.inline-feed-markdown--nested :deep(.msg-markdown) {
  font-size: 12px;
  color: rgba(186, 196, 208, 0.88);
}

.inline-feed-markdown--narrative :deep(.msg-markdown p) {
  margin: 0 0 0.5em;
}

.inline-feed-markdown--narrative :deep(.msg-markdown p:last-child) {
  margin-bottom: 0.35em;
}

.inline-feed-placeholder {
  padding: 2px 0 6px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(148, 163, 184, 0.78);
}

.inline-feed-collapsed {
  margin: 4px 0 6px;
  min-width: 0;
}

.inline-feed-collapsed-summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  padding: 2px 0 4px;
}

.inline-feed-collapsed-summary::-webkit-details-marker {
  display: none;
}

.inline-feed-collapsed-summary::before {
  content: "▸ ";
  font-size: 8px;
  color: rgba(148, 163, 184, 0.35);
}

.inline-feed-collapsed[open] > .inline-feed-collapsed-summary::before {
  content: "▾ ";
}

.inline-feed-collapsed-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.62);
}

.inline-feed-collapsed-summary:hover .inline-feed-collapsed-label {
  color: rgba(165, 214, 255, 0.88);
}

.inline-feed-collapsed-body {
  padding: 4px 0 2px 12px;
  border-left: 2px solid rgba(148, 163, 184, 0.1);
  margin-left: 4px;
}
</style>
