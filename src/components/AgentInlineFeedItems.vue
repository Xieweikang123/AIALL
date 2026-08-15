<template>
  <IntentTraceCard
    v-if="intentTrace && !nested"
    :trace="intentTrace"
  />
  <template v-for="item in displayItems" :key="renderKey(item)">
    <div
      v-if="item.kind === 'text' && item.variant === 'narrative' && item.text.trim()"
      class="stream-narrative"
      :class="{
        'stream-narrative--nested': nested,
        'stream-narrative--action-summary': isActionSummary(item.text),
      }"
    >
      <ChatMarkdown
        class="inline-feed-markdown inline-feed-markdown--narrative"
        :content="narrativeMarkdown(item.text)"
        :streaming="false"
        :interactive="false"
      />
    </div>

    <div
      v-else-if="item.kind === 'collapsed'"
      class="stream-process-collapsed-wrap"
      :class="{ 'stream-process-collapsed-wrap--nested': nested }"
    >
      <button
        type="button"
        class="stream-process-collapsed-btn"
        :aria-expanded="isCollapsedExpanded(item.key)"
        @click="toggleCollapsed(item.key)"
      >
        <span class="stream-process-collapsed-chevron" aria-hidden="true">
          {{ isCollapsedExpanded(item.key) ? "▾" : "▸" }}
        </span>
        <span class="stream-process-collapsed-label">{{ item.summary }}</span>
      </button>
      <div
        v-if="isCollapsedExpanded(item.key)"
        class="stream-process-collapsed-body"
      >
        <AgentInlineFeedItems
          :items="item.items"
          :is-running="isRunning"
          :chat-mode="chatMode"
          :can-execute-plan="canExecutePlan"
          :layout-enhance-ready="layoutEnhanceReady"
          :plan-file-path="planFilePath"
          :message-id="messageId"
          :progress-hint="progressHint"
          nested
          :tool-default-visible="toolDefaultVisible"
          tool-display="inline"
          @execute-plan="emit('execute-plan')"
          @select-option="(option) => emit('select-option', option)"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>
    </div>

    <AgentProcessStepList
      v-else-if="item.kind === 'tool-batch'"
      :tools="item.steps"
      :is-running="isRunning"
      :default-visible="toolDefaultVisible"
      :compact="chatMode === 'ask'"
      :show-detail="agentDebugEnabled"
      @open-file="(path) => emit('openFile', path)"
    />

    <div
      v-else-if="item.kind === 'text' && item.variant === 'answer'"
      class="inline-feed-segment inline-feed-segment--answer"
    >
      <div
        v-if="progressHint && isRunning && !item.text.trim() && !item.streaming"
        class="stream-progress-hint"
      >
        <span class="shimmer-text--fast">{{ progressHint }}</span>
      </div>
      <div
        v-if="item.streaming && isRunning && !item.text.trim()"
        class="inline-feed-placeholder"
      >
        <span class="shimmer-text--fast">正在生成…</span>
      </div>
      <ProjectReportBlock
        v-else-if="item.text.trim() || (!item.streaming && item.variant === 'answer')"
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
          :plan-file-path="planFilePath"
          :plan-panel-active="planPanelActive"
          :enhance-layout="layoutEnhanceReady && !isRunning && !item.streaming"
          :external-view="planExternalViewFor(item.text)"
          @execute="emit('execute-plan')"
          @open-plan-file="() => chatCtx?.openPlanFileInEditor(planFilePath)"
          @focus-panel="focusPlanPanel"
        >
          <ChatMarkdown
            v-if="!planExternalViewFor(item.text)"
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
import { computed, inject, ref, watch } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import PlanDocumentBlock from "./PlanDocumentBlock.vue";
import ProjectReportBlock from "./ProjectReportBlock.vue";
import AgentProcessStepList from "./AgentProcessStepList.vue";
import IntentTraceCard from "./IntentTraceCard.vue";
import type { InlineFeedItem, InlineFeedProcessItem } from "../services/agentInlineFeed";
import { sanitizeFeedThoughtText } from "../services/agentProgressMarker";
import { enrichPlanMarkdownForDisplay } from "../services/planDocumentDisplay";
import { shouldUsePlanExternalView } from "../services/planFile";
import { vibeChatMessageContextKey } from "../composables/vibeChatMessageContext";
import { agentDebugEnabled } from "../utils/agentDebugFlag";
import type { AgentRoundTool } from "../services/agentRoundGroups";
import type { AiOption } from "../utils/parseAiOptions";

defineOptions({ name: "AgentInlineFeedItems" });

type DisplayItem =
  | InlineFeedProcessItem
  | { kind: "tool-batch"; key: string; steps: AgentRoundTool[] }
  | { kind: "collapsed"; key: string; summary: string; items: InlineFeedItem[] };

const props = withDefaults(
  defineProps<{
    items: InlineFeedItem[];
    isRunning: boolean;
    chatMode?: "ask" | "build" | "plan" | "explore" | "auto";
    canExecutePlan?: boolean;
    intentTrace?: {
      ruleResult?: string;
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
    layoutEnhanceReady?: boolean;
    planFilePath?: string;
    messageId?: string;
    progressHint?: string;
    nested?: boolean;
    answerOnly?: boolean;
    toolDisplay?: "card" | "inline";
    preserveCollapsed?: boolean;
    toolDefaultVisible?: number;
  }>(),
  {
    nested: false,
    answerOnly: false,
    toolDisplay: "inline",
    preserveCollapsed: false,
    toolDefaultVisible: 8,
  },
);

const chatCtx = inject(vibeChatMessageContextKey, null);

const planPanelLinked = computed(() => {
  if (!chatCtx?.planPanelActive.value) return false;
  if (!props.messageId || !chatCtx.planPanelMessageId.value) return false;
  return chatCtx.planPanelMessageId.value === props.messageId;
});

const planPanelActive = computed(
  () => planPanelLinked.value && Boolean(chatCtx?.planWorkspaceOpen?.value),
);

function focusPlanPanel() {
  chatCtx?.focusPlanPanel(props.messageId);
}

function planExternalViewFor(text: string) {
  return shouldUsePlanExternalView(text, {
    chatMode: props.chatMode ?? "ask",
    planFilePath: props.planFilePath,
  });
}

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

function sourceProcessItems(items: InlineFeedItem[]): InlineFeedItem[] {
  if (props.answerOnly) {
    return items.filter((item) => item.kind === "text" && item.variant === "answer");
  }
  if (props.preserveCollapsed) {
    return items.filter((item) => item.kind !== "text" || item.variant !== "answer");
  }
  return flattenProcessItems(items);
}

function mergeInlineToolBatches(source: Array<InlineFeedProcessItem | InlineFeedItem>): DisplayItem[] {
  const merged: DisplayItem[] = [];
  let toolBatch: AgentRoundTool[] = [];
  let hasSeenText = false;
  const deferred: DisplayItem[] = [];

  const flushTools = () => {
    if (!toolBatch.length) return;
    const batch: DisplayItem = {
      kind: "tool-batch",
      key: `tools-${toolBatch[0]?.id}-${toolBatch.length}`,
      steps: toolBatch,
    };
    if (hasSeenText) {
      merged.push(batch);
    } else {
      deferred.push(batch);
    }
    toolBatch = [];
  };

  for (const item of source) {
    if (item.kind === "tool") {
      toolBatch.push(item.step);
      continue;
    }
    flushTools();
    if (item.kind === "collapsed") {
      merged.push({ kind: "collapsed", key: item.key, summary: item.summary, items: item.items });
      continue;
    }
    // First text item — flush deferred tool batches AFTER it,
    // so reading order is: text first, then supporting tool details.
    if (!hasSeenText) {
      hasSeenText = true;
      merged.push(item, ...deferred);
      deferred.length = 0;
    } else {
      merged.push(item);
    }
  }
  flushTools();
  // Remaining deferred batches (no text at all) go to end
  merged.push(...deferred);
  return merged;
}

function extractAnswerItems(items: InlineFeedItem[]) {
  return items.filter(
    (item): item is Extract<InlineFeedItem, { kind: "text"; variant: "answer" }> =>
      item.kind === "text" && item.variant === "answer",
  );
}

const displayItems = computed((): DisplayItem[] => {
  if (props.answerOnly) {
    return extractAnswerItems(props.items);
  }

  // Keep original item order — answer items stay in place, tool batches
  // merge adjacent tools (answer items naturally break the batch).
  const source: Array<InlineFeedProcessItem | InlineFeedItem> =
    props.preserveCollapsed
      ? props.items.filter((item) => item.kind !== "text" || item.variant !== "answer")
      : props.items;

  return props.toolDisplay !== "inline"
    ? (source as DisplayItem[])
    : mergeInlineToolBatches(source);
});

function renderKey(item: DisplayItem): string {
  if (item.kind === "tool-batch") return item.key;
  if (item.kind === "collapsed") return item.key;
  return `${item.kind}:${item.key}`;
}

function narrativeMarkdown(text: string) {
  return sanitizeFeedThoughtText(text);
}

function isActionSummary(text: string): boolean {
  return text.trim().startsWith("行动摘要 ·");
}

function answerMarkdown(text: string) {
  return enrichPlanMarkdownForDisplay(text, {
    whileStreaming: Boolean(props.isRunning),
  });
}

const expandedCollapsedKeys = ref<Set<string>>(new Set());

watch(
  () => props.items.map((item) => (item.kind === "collapsed" ? item.key : "")).join("|"),
  () => {
    expandedCollapsedKeys.value = new Set();
  },
);

function isCollapsedExpanded(key: string): boolean {
  return expandedCollapsedKeys.value.has(key);
}

function toggleCollapsed(key: string) {
  const next = new Set(expandedCollapsedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedCollapsedKeys.value = next;
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

.inline-feed-markdown--answer :deep(.msg-markdown) {
  font-size: 14px;
  line-height: 1.65;
  color: rgba(240, 245, 250, 0.96);
}

.inline-feed-markdown--answer :deep(.msg-markdown--streaming p:last-child::after) {
  content: "";
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.12em;
  background: rgba(88, 166, 255, 0.85);
  animation: stream-caret-blink 1s step-end infinite;
}

@keyframes stream-caret-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.stream-narrative {
  padding: 0 0 6px;
  position: relative;
}

.stream-narrative--action-summary {
  margin: 2px 0 4px 8px;
  padding: 5px 9px;
  border-left: 2px solid rgba(107, 181, 160, 0.55);
  border-radius: 0 6px 6px 0;
  background: rgba(107, 181, 160, 0.06);
}

.stream-narrative--action-summary .inline-feed-markdown--narrative :deep(.msg-markdown) {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(183, 204, 198, 0.84);
}

.stream-process-collapsed-wrap {
  padding: 0 0 4px;
  position: relative;
}

.stream-process-collapsed-wrap--nested {
  padding-left: 4px;
}

.stream-process-collapsed-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 8px 3px 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(148, 163, 184, 0.72);
  font-size: 11px;
  line-height: 1.35;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.stream-process-collapsed-wrap--nested .stream-process-collapsed-btn {
  font-size: 10px;
  padding: 2px 7px 2px 5px;
}

.stream-process-collapsed-btn:hover {
  color: rgba(165, 214, 255, 0.92);
  background: rgba(88, 166, 255, 0.06);
  border-color: rgba(88, 166, 255, 0.14);
}

.stream-process-collapsed-chevron {
  flex-shrink: 0;
  font-size: 9px;
  opacity: 0.7;
}

.stream-process-collapsed-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stream-process-collapsed-body {
  margin: 4px 0 2px 6px;
  padding-left: 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}

.stream-progress-hint {
  padding: 6px 0 8px;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(148, 163, 184, 0.82);
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
