<template>
  <template v-for="item in displayItems" :key="renderKey(item)">
    <div
      v-if="item.kind === 'text' && item.variant === 'narrative' && item.text.trim()"
      class="stream-narrative"
      :class="{ 'stream-narrative--nested': nested }"
    >
      <ChatMarkdown
        class="inline-feed-markdown inline-feed-markdown--narrative"
        :content="narrativeMarkdown(item.text)"
        :streaming="false"
        :interactive="false"
      />
    </div>

    <AgentProcessFlowLine
      v-else-if="item.kind === 'tool-batch'"
      :tools="item.steps"
      :is-running="isRunning"
      @open-file="(path) => emit('openFile', path)"
    />

    <div
      v-else-if="item.kind === 'text' && item.variant === 'answer'"
      class="inline-feed-segment inline-feed-segment--answer"
    >
      <div
        v-if="item.streaming && isRunning && !item.text.trim()"
        class="inline-feed-placeholder"
      >
        <span class="shimmer-text--fast">正在生成…</span>
      </div>
      <ProjectReportBlock
        v-else-if="item.variant === 'answer'"
        :content="item.text"
        :chat-mode="chatMode"
        :streaming="item.streaming && isRunning"
        @open-file="(path) => emit('openFile', path)"
      >
        <PlanDocumentBlock
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
      </ProjectReportBlock>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import PlanDocumentBlock from "./PlanDocumentBlock.vue";
import ProjectReportBlock from "./ProjectReportBlock.vue";
import AgentProcessFlowLine from "./AgentProcessFlowLine.vue";
import type { InlineFeedItem, InlineFeedProcessItem } from "../services/agentInlineFeed";
import { sanitizeFeedThoughtText } from "../services/agentProgressMarker";
import { enrichPlanMarkdownForDisplay } from "../services/planDocumentDisplay";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import type { AiOption } from "../utils/parseAiOptions";

defineOptions({ name: "AgentInlineFeedItems" });

type DisplayItem =
  | InlineFeedProcessItem
  | { kind: "tool-batch"; key: string; steps: AgentRoundTool[] };

const props = withDefaults(
  defineProps<{
    items: InlineFeedItem[];
    isRunning: boolean;
    chatMode?: "ask" | "build" | "plan" | "explore";
    canExecutePlan?: boolean;
    layoutEnhanceReady?: boolean;
    nested?: boolean;
    answerOnly?: boolean;
    toolDisplay?: "card" | "inline";
  }>(),
  {
    nested: false,
    answerOnly: false,
    toolDisplay: "inline",
  },
);

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  openFile: [path: string];
}>();

function flattenProcessItems(items: InlineFeedItem[]): InlineFeedProcessItem[] {
  const flat: InlineFeedProcessItem[] = [];
  for (const item of items) {
    if (item.kind === "collapsed") flat.push(...flattenProcessItems(item.items));
    else if (item.kind !== "text" || item.variant !== "answer") flat.push(item);
  }
  return flat;
}

const displayItems = computed((): DisplayItem[] => {
  const source = props.answerOnly
    ? props.items.filter((item) => item.kind === "text" && item.variant === "answer")
    : flattenProcessItems(props.items);

  if (props.toolDisplay !== "inline") {
    return source;
  }

  const merged: DisplayItem[] = [];
  let toolBatch: AgentRoundTool[] = [];

  const flushTools = () => {
    if (!toolBatch.length) return;
    merged.push({
      kind: "tool-batch",
      key: `tools-${toolBatch[0]?.id}-${toolBatch.length}`,
      steps: toolBatch,
    });
    toolBatch = [];
  };

  for (const item of source) {
    if (item.kind === "tool") {
      toolBatch.push(item.step);
      continue;
    }
    flushTools();
    merged.push(item);
  }
  flushTools();
  return merged;
});

function renderKey(item: DisplayItem): string {
  if (item.kind === "tool-batch") return item.key;
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
  margin-top: 0;
}

.inline-feed-markdown {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
}

.stream-narrative {
  padding: 0 0 4px;
}

.inline-feed-markdown--narrative :deep(.msg-markdown) {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(186, 196, 208, 0.82);
}

.stream-narrative--nested .inline-feed-markdown--narrative :deep(.msg-markdown) {
  font-size: 11px;
}

.inline-feed-markdown--narrative :deep(.msg-markdown p) {
  margin: 0 0 0.45em;
}

.inline-feed-markdown--narrative :deep(.msg-markdown p:last-child) {
  margin-bottom: 0;
}

.inline-feed-placeholder {
  padding: 2px 0 6px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(148, 163, 184, 0.78);
}
</style>
