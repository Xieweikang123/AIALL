<template>
  <IntentTraceCard
    v-if="intentTrace && !nested"
    :trace="intentTrace"
  />
  <!-- kind=status 项的实时状态由时间线底栏 AgentLiveStatusRail 统一展示，这里刻意不渲染，避免同屏双重状态行 -->
  <template v-for="item in displayItems" :key="renderKey(item)">
    <div
      v-if="item.kind === 'text' && item.variant === 'narrative' && item.text.trim()"
      class="stream-narrative"
      :class="{
        'stream-narrative--nested': nested,
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
      v-else-if="item.kind === 'reasoning'"
      class="stream-reasoning-wrap"
      :class="{ 'stream-reasoning-wrap--nested': nested }"
    >
      <button
        type="button"
        class="stream-reasoning-btn"
        :class="{
          'stream-reasoning-btn--active': isReasoningActive(item.key),
          'stream-reasoning-btn--static': !hasReasoningOverflow(item.key),
        }"
        :aria-expanded="hasReasoningOverflow(item.key) ? isReasoningExpanded(item.key) : undefined"
        @click="toggleReasoning(item.key)"
      >
        <span
          v-if="hasReasoningOverflow(item.key)"
          class="stream-reasoning-chevron"
          aria-hidden="true"
        >{{ isReasoningExpanded(item.key) ? "▾" : "▸" }}</span>
        <span
          v-if="isReasoningActive(item.key)"
          class="stream-reasoning-dot"
          aria-hidden="true"
        />
        <span class="stream-reasoning-prompt" aria-hidden="true">&gt;</span>
        <span
          class="stream-reasoning-label"
          :class="{ 'shimmer-text--fast': isReasoningActive(item.key) }"
        >{{ reasoningLabel(item.key) }}</span>
      </button>
      <div class="stream-reasoning-reveal">
        <div
          :ref="reasoningBodyRef(item.key)"
          class="stream-reasoning-body"
          :class="{ 'stream-reasoning-body--clamped': isReasoningClamped(item.key) }"
          :style="reasoningBodyStyle(item.key)"
        >
          <ChatMarkdown
            class="inline-feed-markdown inline-feed-markdown--reasoning"
            :content="reasoningMarkdown(item.text)"
            :streaming="isReasoningActive(item.key)"
            :interactive="false"
          />
        </div>
      </div>
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
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import PlanDocumentBlock from "./PlanDocumentBlock.vue";
import ProjectReportBlock from "./ProjectReportBlock.vue";
import AgentProcessStepList from "./AgentProcessStepList.vue";
import IntentTraceCard from "./IntentTraceCard.vue";
import type { InlineFeedItem, InlineFeedProcessItem } from "../services/agentInlineFeed";
import { resolveActiveReasoningKey } from "../services/agentInlineFeed";
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
    if (item.kind === "collapsed") {
      merged.push({ kind: "collapsed", key: item.key, summary: item.summary, items: item.items });
      continue;
    }
    merged.push(item);
  }
  flushTools();
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

function reasoningMarkdown(text: string) {
  return sanitizeFeedThoughtText(text);
}

function answerMarkdown(text: string) {
  return enrichPlanMarkdownForDisplay(text, {
    whileStreaming: Boolean(props.isRunning),
  });
}

const expandedCollapsedKeys = ref<Set<string>>(new Set());
/** Explicit user toggles win over the auto expand-while-thinking behavior. */
const reasoningOverrides = ref<Map<string, boolean>>(new Map());
/** Measured full/max heights per reasoning key — drives the 3-line preview clamp. */
const reasoningHeights = ref<Map<string, { full: number; max: number }>>(new Map());

const REASONING_COLLAPSED_LINES = 3;

let reasoningMeasureObserver: ResizeObserver | null = null;
const reasoningBodyEls = new Map<string, HTMLElement>();

function measureReasoningBody(key: string, el: HTMLElement | null) {
  if (!el) {
    reasoningBodyEls.delete(key);
    return;
  }
  reasoningBodyEls.set(key, el);
  const markdown = el.querySelector<HTMLElement>(".msg-markdown");
  if (!markdown) return;
  const styles = window.getComputedStyle(markdown);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 16;
  const max = Math.round(lineHeight * REASONING_COLLAPSED_LINES);
  // scrollHeight ignores max-height, so this stays the true full height even while clamped.
  const full = markdown.scrollHeight;
  const prev = reasoningHeights.value.get(key);
  if (prev && prev.full === full && prev.max === max) return;
  const next = new Map(reasoningHeights.value);
  next.set(key, { full, max });
  reasoningHeights.value = next;
}

let reasoningMeasureRaf = 0;
function scheduleReasoningMeasure() {
  if (reasoningMeasureRaf) return;
  if (typeof requestAnimationFrame === "undefined") {
    for (const [key, el] of reasoningBodyEls) measureReasoningBody(key, el);
    return;
  }
  reasoningMeasureRaf = requestAnimationFrame(() => {
    reasoningMeasureRaf = 0;
    for (const [key, el] of reasoningBodyEls) measureReasoningBody(key, el);
  });
}

function bindReasoningBody(key: string, el: unknown) {
  const previous = reasoningBodyEls.get(key);
  const target = el instanceof HTMLElement ? el : null;
  if (previous && previous !== target) {
    reasoningMeasureObserver?.unobserve(previous);
    reasoningBodyEls.delete(key);
  }
  if (!target) return;
  reasoningBodyEls.set(key, target);
  if (typeof ResizeObserver !== "undefined") {
    reasoningMeasureObserver ??= new ResizeObserver(() => scheduleReasoningMeasure());
    reasoningMeasureObserver.observe(target);
  }
  // Measure synchronously so history items never flash their full text before clamping.
  measureReasoningBody(key, target);
}

/** Stable per-key ref callbacks — an inline arrow would re-bind (and re-observe) on every patch. */
const reasoningBodyRefFns = new Map<string, (el: unknown) => void>();

function reasoningBodyRef(key: string) {
  let fn = reasoningBodyRefFns.get(key);
  if (!fn) {
    fn = (el: unknown) => bindReasoningBody(key, el);
    reasoningBodyRefFns.set(key, fn);
  }
  return fn;
}

function hasReasoningOverflow(key: string): boolean {
  const heights = reasoningHeights.value.get(key);
  if (!heights) return false;
  return heights.full > heights.max + 1;
}

function isReasoningClamped(key: string): boolean {
  if (isReasoningExpanded(key)) return false;
  return hasReasoningOverflow(key);
}

function reasoningBodyStyle(key: string): Record<string, string> | undefined {
  const heights = reasoningHeights.value.get(key);
  if (isReasoningExpanded(key)) {
    // While streaming the text grows continuously — capping it would lag the reveal.
    if (isReasoningActive(key)) return undefined;
    return heights ? { maxHeight: `${heights.full}px` } : undefined;
  }
  if (!heights || !hasReasoningOverflow(key)) return undefined;
  return { maxHeight: `${heights.max}px` };
}

onBeforeUnmount(() => {
  reasoningMeasureObserver?.disconnect();
  reasoningMeasureObserver = null;
  if (reasoningMeasureRaf) {
    cancelAnimationFrame(reasoningMeasureRaf);
    reasoningMeasureRaf = 0;
  }
  reasoningBodyEls.clear();
  reasoningBodyRefFns.clear();
});

onMounted(() => scheduleReasoningMeasure());

/**
 * Key of the reasoning stream currently being produced. While active the body
 * stays unclamped; once real content follows, overflow (>3 lines) clamps to a
 * preview and shorter thoughts stay fully visible.
 */
const activeReasoningKey = computed(() => resolveActiveReasoningKey(props.items, props.isRunning));

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

function isReasoningActive(key: string): boolean {
  return activeReasoningKey.value === key;
}

function reasoningLabel(key: string): string {
  return isReasoningActive(key) ? "思考中…" : "思考过程";
}

function isReasoningExpanded(key: string): boolean {
  const override = reasoningOverrides.value.get(key);
  if (override !== undefined) return override;
  return isReasoningActive(key);
}

function toggleReasoning(key: string) {
  if (!hasReasoningOverflow(key)) return;
  const next = new Map(reasoningOverrides.value);
  next.set(key, !isReasoningExpanded(key));
  reasoningOverrides.value = next;
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
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.7;
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

.stream-reasoning-wrap {
  padding: 0 0 4px;
  position: relative;
}

.stream-reasoning-wrap--nested {
  padding-left: 4px;
}

/*
 * Idle keeps the label quiet (faint, no chrome). Body stays visible: ≤3 lines
 * show in full; longer thoughts clamp to a 3-line preview until expanded.
 * Chrome appears on hover/focus or while the model is streaming.
 */
.stream-reasoning-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 2px 8px 2px 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: rgba(148, 163, 184, 0.34);
  font-size: 11px;
  font-family: inherit;
  line-height: 1.35;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.stream-reasoning-wrap--nested .stream-reasoning-btn {
  font-size: 10px;
  padding: 2px 7px 2px 5px;
}

.stream-reasoning-wrap:hover .stream-reasoning-btn,
.stream-reasoning-btn:focus-visible {
  color: rgba(148, 163, 184, 0.8);
  background: rgba(255, 255, 255, 0.035);
  border-color: rgba(255, 255, 255, 0.08);
}

.stream-reasoning-btn:hover {
  color: rgba(165, 214, 255, 0.92);
  background: rgba(88, 166, 255, 0.06);
  border-color: rgba(88, 166, 255, 0.14);
}

.stream-reasoning-btn--active {
  color: rgba(165, 214, 255, 0.92);
  border-color: rgba(88, 166, 255, 0.18);
  background: rgba(88, 166, 255, 0.07);
}

.stream-reasoning-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: rgba(126, 182, 255, 0.95);
  box-shadow: 0 0 8px rgba(88, 166, 255, 0.5);
  animation: reasoning-dot-breathe 1.6s ease-in-out infinite;
}

.stream-reasoning-chevron {
  flex-shrink: 0;
  font-size: 9px;
  opacity: 0.7;
}

.stream-reasoning-prompt {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: rgba(88, 166, 255, 0.8);
  user-select: none;
}

.stream-reasoning-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Body is always visible; height animation lives on max-height clamp instead. */
.stream-reasoning-reveal {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  overflow: hidden;
}

/* Clamp/reveal is driven by the measured max-height — no layout thrash, no reflow jump. */
.stream-reasoning-body {
  min-height: 0;
  margin: 4px 0 2px 6px;
  padding-left: 10px;
  border-left: 2px solid rgba(88, 166, 255, 0.2);
  overflow: hidden;
  transition: max-height 220ms cubic-bezier(0.4, 0, 0.2, 1);
}

.stream-reasoning-body--clamped {
  position: relative;
  mask-image: linear-gradient(180deg, #000 calc(100% - 18px), transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 18px), transparent 100%);
}

.stream-reasoning-btn--static {
  cursor: default;
}

.stream-reasoning-btn--static:hover {
  color: rgba(148, 163, 184, 0.34);
  background: transparent;
  border-color: transparent;
}

@keyframes reasoning-dot-breathe {
  0%, 100% { opacity: 0.45; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

.inline-feed-markdown--reasoning :deep(.msg-markdown) {
  font-size: 12px;
  line-height: 1.55;
  color: rgba(148, 163, 184, 0.38);
  font-style: italic;
}

.inline-feed-markdown--reasoning :deep(.msg-markdown--streaming p:last-child::after) {
  content: "";
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.12em;
  background: rgba(148, 163, 184, 0.34);
  animation: stream-caret-blink 1s step-end infinite;
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
  gap: 6px;
  max-width: 100%;
  padding: 2px 8px 2px 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.025);
  color: rgba(148, 163, 184, 0.72);
  font-size: 11px;
  font-family: inherit;
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
  padding-left: 10px;
  border-left: 2px solid rgba(88, 166, 255, 0.16);
}

.stream-progress-hint {
  padding: 6px 0 8px;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(148, 163, 184, 0.82);
}

.inline-feed-markdown--narrative :deep(.msg-markdown) {
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.55;
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

@media (prefers-reduced-motion: reduce) {
  .stream-reasoning-dot {
    animation: none;
    opacity: 0.9;
  }

  .stream-reasoning-reveal {
    transition: none;
  }

  .stream-reasoning-body {
    transition: none;
  }
}
</style>
