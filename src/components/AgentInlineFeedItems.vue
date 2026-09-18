<template>
  <IntentTraceCard
    v-if="intentTrace && !nested"
    :trace="intentTrace"
  />
  <!-- kind=status 由时间线底栏统一展示；有工具在跑时底栏会收起，活态落在步骤行上 -->
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
          :class="{
            'stream-reasoning-body--clamped': isReasoningClamped(item.key),
            'stream-reasoning-body--live': isReasoningLivePinned(item.key),
          }"
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
/** Explicit user toggles only — thinking never auto-expands (avoids layout jump). */
const reasoningOverrides = ref<Map<string, boolean>>(new Map());
/** Measured full/max heights per reasoning key — drives the 3-line preview clamp. */
const reasoningHeights = ref<Map<string, { full: number; max: number }>>(new Map());

const REASONING_COLLAPSED_LINES = 3;
/** Fallback ~3 lines before first measure (12.5px × 1.55 ≈ reasoning markdown). */
const REASONING_FALLBACK_MAX_PX = Math.round(12.5 * 1.55 * REASONING_COLLAPSED_LINES);

let reasoningMeasureObserver: ResizeObserver | null = null;
const reasoningBodyEls = new Map<string, HTMLElement>();
/** Throttle smooth stick-to-bottom so consecutive deltas don't cancel each other. */
const reasoningPinAt = new Map<string, number>();

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
  if (prev && prev.full === full && prev.max === max) {
    pinReasoningScroll(key, el);
    return;
  }
  const next = new Map(reasoningHeights.value);
  next.set(key, { full, max });
  reasoningHeights.value = next;
  pinReasoningScroll(key, el);
}

/** While thinking inside the 3-line viewport, keep the newest lines in view. */
function pinReasoningScroll(key: string, el?: HTMLElement | null) {
  if (!isReasoningLivePinned(key)) return;
  const target = el ?? reasoningBodyEls.get(key);
  if (!target) return;
  const maxScroll = target.scrollHeight - target.clientHeight;
  if (maxScroll <= 1) return;

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const last = reasoningPinAt.get(key) ?? 0;
  const gap = now - last;
  reasoningPinAt.set(key, now);

  // Smooth when deltas are spaced out; snap when they arrive in a burst so we
  // don't queue competing smooth scrolls.
  const behavior: ScrollBehavior = gap >= 90 ? "smooth" : "auto";
  if (typeof target.scrollTo === "function") {
    target.scrollTo({ top: maxScroll, behavior });
  } else {
    target.scrollTop = maxScroll;
  }
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
    reasoningPinAt.delete(key);
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

/** Live teleprompter: only when thinking and the viewport is actually overflowing. */
function isReasoningLivePinned(key: string): boolean {
  return isReasoningActive(key) && isReasoningClamped(key);
}

function reasoningBodyStyle(key: string): Record<string, string> | undefined {
  const heights = reasoningHeights.value.get(key);
  if (isReasoningExpanded(key)) {
    if (!heights || heights.full <= 0) return undefined;
    return { maxHeight: `${heights.full}px` };
  }
  // Cap while thinking (even before overflow) so the box never grows past ~3 lines.
  if (!isReasoningActive(key) && !hasReasoningOverflow(key)) return undefined;
  const max = heights && heights.max > 0 ? heights.max : REASONING_FALLBACK_MAX_PX;
  return { maxHeight: `${Math.max(max, 1)}px` };
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
  reasoningPinAt.clear();
});

onMounted(() => scheduleReasoningMeasure());

/**
 * Key of the reasoning stream currently being produced. Drives the live label /
 * pulse; the body stays clamped unless the user expands it.
 */
const activeReasoningKey = computed(() => resolveActiveReasoningKey(props.items, props.isRunning));

watch(
  () => props.items.map((item) => (item.kind === "collapsed" ? item.key : "")).join("|"),
  () => {
    expandedCollapsedKeys.value = new Set();
  },
);

watch(
  () =>
    props.items
      .filter((item): item is Extract<InlineFeedItem, { kind: "reasoning" }> => item.kind === "reasoning")
      .map((item) => `${item.key}:${item.text.length}`)
      .join("|"),
  () => scheduleReasoningMeasure(),
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
  // Default collapsed preview — never auto-expand while thinking (that caused the jump).
  return reasoningOverrides.value.get(key) === true;
}

function toggleReasoning(key: string) {
  if (!hasReasoningOverflow(key) && !isReasoningExpanded(key)) return;
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
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.inline-feed-segment--answer:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
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
  padding: 2px 0 8px;
  position: relative;
}

.stream-reasoning-wrap {
  padding: 0 0 6px;
  position: relative;
}

.stream-reasoning-wrap--nested {
  padding-left: 4px;
}

/*
 * Idle keeps the label secondary. Body stays in a ~3-line viewport by default
 * (including while streaming) so tools arriving later do not jump the layout.
 * Overflow gets a chevron; live thinking pins newest lines to the bottom.
 */
.stream-reasoning-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 1px 4px 1px 2px;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: rgba(165, 184, 204, 0.72);
  font-size: 11px;
  font-family: inherit;
  line-height: 1.35;
  cursor: pointer;
  transition: color 120ms ease;
}

.stream-reasoning-wrap--nested .stream-reasoning-btn {
  font-size: 10px;
  padding: 1px 4px 1px 2px;
}

.stream-reasoning-wrap:hover .stream-reasoning-btn,
.stream-reasoning-btn:focus-visible {
  color: rgba(190, 210, 230, 0.92);
  background: transparent;
  border-color: transparent;
}

.stream-reasoning-btn:hover {
  color: rgba(165, 214, 255, 0.95);
  background: transparent;
  border-color: transparent;
}

.stream-reasoning-btn--active {
  color: rgba(165, 214, 255, 0.95);
  border-color: transparent;
  background: transparent;
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
  color: rgba(88, 166, 255, 0.85);
  user-select: none;
}

.stream-reasoning-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Avoid grid 1fr + min-height:0 collapse inside flex timelines. */
.stream-reasoning-reveal {
  display: block;
  overflow: visible;
}

.stream-reasoning-body {
  margin: 4px 0 4px 7px;
  padding-left: 10px;
  border-left: 2px solid rgba(88, 166, 255, 0.28);
  overflow: hidden;
  transition: max-height 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Idle overflow preview: show the start, fade the cut at the bottom. */
.stream-reasoning-body--clamped {
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  mask-image: linear-gradient(180deg, #000 calc(100% - 16px), transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 16px), transparent 100%);
}

.stream-reasoning-body--clamped::-webkit-scrollbar {
  display: none;
}

/*
 * Live thinking: stick newest lines at the bottom; fade older text out the top
 * so the viewport feels like a rising teleprompter instead of a hard crop.
 */
.stream-reasoning-body--clamped.stream-reasoning-body--live {
  scroll-behavior: auto;
  mask-image: linear-gradient(
    180deg,
    transparent 0%,
    #000 14px,
    #000 calc(100% - 4px),
    #000 100%
  );
  -webkit-mask-image: linear-gradient(
    180deg,
    transparent 0%,
    #000 14px,
    #000 calc(100% - 4px),
    #000 100%
  );
}

@media (prefers-reduced-motion: reduce) {
  .stream-reasoning-body {
    transition: none;
  }
}

.stream-reasoning-btn--static {
  cursor: default;
}

.stream-reasoning-btn--static:hover {
  color: rgba(165, 184, 204, 0.72);
  background: transparent;
  border-color: transparent;
}

@keyframes reasoning-dot-breathe {
  0%, 100% { opacity: 0.45; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}

.inline-feed-markdown--reasoning :deep(.msg-markdown) {
  font-size: 12.5px;
  line-height: 1.55;
  color: rgba(186, 196, 208, 0.78);
  font-style: italic;
}

.inline-feed-markdown--reasoning :deep(.msg-markdown--streaming p:last-child::after) {
  content: "";
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.12em;
  background: rgba(148, 163, 184, 0.45);
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
  padding: 2px 4px 2px 2px;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: rgba(148, 163, 184, 0.72);
  font-size: 11px;
  font-family: inherit;
  line-height: 1.35;
  cursor: pointer;
  transition: color 120ms ease;
}

.stream-process-collapsed-wrap--nested .stream-process-collapsed-btn {
  font-size: 10px;
  padding: 2px 4px 2px 2px;
}

.stream-process-collapsed-btn:hover {
  color: rgba(165, 214, 255, 0.92);
  background: transparent;
  border-color: transparent;
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
  margin: 4px 0 2px 7px;
  padding-left: 10px;
  border-left: 1.5px solid rgba(88, 166, 255, 0.14);
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

  .stream-reasoning-body {
    transition: none;
  }
}
</style>
