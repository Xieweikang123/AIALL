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
          'stream-reasoning-btn--expanded':
            hasReasoningOverflow(item.key) && isReasoningExpanded(item.key),
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
          <!--
            惰性渲染：已经结束的 reasoning，折叠态只放纯文本预览，展开后才挂 ChatMarkdown。

            长会话（几十条 reasoning，每条上千字）切进来时，若每条都无条件渲染
            ChatMarkdown，会一次性构建上百份 Markdown→HTML（还各自触发
            sanitize + 高亮 + 行内代码），主线程被塞满，表现为「切到这个 tab 就卡」。
            历史 reasoning 折叠态本来就被 CSS 裁成一行，渲染完整 markdown 是纯浪费。

            正在思考的那条仍走 ChatMarkdown：它的 1 行窗口靠内部滚动做「提词器」
            （isReasoningLivePinned + pinReasoningScroll），纯文本没有滚动容器会破坏该效果。

            注意必须保留一个可测量的 DOM：折叠态高度由 measureReasoningBody 量出，
            hasReasoningOverflow 依赖它决定显不显示展开箭头（见该函数里的双选择器回退）。
          -->
          <div
            v-if="!isReasoningExpanded(item.key) && !isReasoningActive(item.key)"
            class="stream-reasoning-plain"
          >{{ reasoningPreviewText(item.text) }}</div>
          <ChatMarkdown
            v-else
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
import {
  computeScrollFollowStep,
  prefersReducedMotion,
  SCROLL_FOLLOW_SNAP_PX,
} from "../utils/scrollViewport";
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

/**
 * 折叠态的纯文本预览。
 *
 * 只做「去标记 + 压空白」，不做 Markdown 解析 —— 折叠态被 CSS 裁成一行，
 * 渲染完整 markdown 没有意义，却要为每条 reasoning 付一次解析/净化成本。
 * 文本仍经 sanitizeFeedThoughtText，保证与展开态显示的内容一致（不漏掉清洗规则）。
 */
function reasoningPreviewText(text: string) {
  const cleaned = sanitizeFeedThoughtText(text || "");
  if (!cleaned) return "";
  return cleaned
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * 折叠态显示 1 行：思考过程默认只占一行，想看全文手动展开。
 * 高度靠「裁切」而非「内部滚动窗口」实现 —— 见下方 .stream-reasoning-body--clamped。
 */
const REASONING_COLLAPSED_LINES = 1;
/** Fallback ~1 line before first measure (12.5px × 1.55 ≈ reasoning markdown). */
const REASONING_FALLBACK_MAX_PX = Math.round(12.5 * 1.55 * REASONING_COLLAPSED_LINES);

let reasoningMeasureObserver: ResizeObserver | null = null;
const reasoningBodyEls = new Map<string, HTMLElement>();

/**
 * Softer than chat follow — the ~3-line teleprompter only moves a few dozen
 * px at a time; lower stiffness keeps those micro-chases from feeling snappy.
 */
const REASONING_FOLLOW_STIFFNESS = 62;
const REASONING_FOLLOW_DAMPING = 16.2;

type ReasoningFollowState = {
  raf: number;
  velocity: number;
  lastTs: number;
};

/** Per-key spring stick-to-bottom while thinking (replaces native smooth/auto). */
const reasoningFollow = new Map<string, ReasoningFollowState>();

function measureReasoningBody(key: string, el: HTMLElement | null) {
  if (!el) {
    stopReasoningFollow(key);
    reasoningBodyEls.delete(key);
    return;
  }
  reasoningBodyEls.set(key, el);
  // 折叠态用纯文本预览、展开态用 ChatMarkdown，两者都要能量出高度：
  // 优先取 markdown 根，取不到就回退到预览节点（否则折叠态量不到高度，
  // hasReasoningOverflow 恒为 false，展开箭头会消失）。
  const markdown =
    el.querySelector<HTMLElement>(".msg-markdown")
    ?? el.querySelector<HTMLElement>(".stream-reasoning-plain");
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

function stopReasoningFollow(key: string) {
  const state = reasoningFollow.get(key);
  if (!state) return;
  if (state.raf) cancelAnimationFrame(state.raf);
  reasoningFollow.delete(key);
}

function stopAllReasoningFollows() {
  for (const key of [...reasoningFollow.keys()]) stopReasoningFollow(key);
}

/**
 * While thinking inside the 3-line viewport, spring-chase the newest lines.
 * Settled frames sleep the RAF; text growth / ResizeObserver re-wakes via
 * measureReasoningBody → pinReasoningScroll (no warm idle spin while pinned).
 */
function pinReasoningScroll(key: string, el?: HTMLElement | null) {
  if (!isReasoningLivePinned(key)) {
    stopReasoningFollow(key);
    // 折叠态不再依赖滚动：把可能的残留 scrollTop 归零，保证稳定显示第 1 行。
    const settled = el ?? reasoningBodyEls.get(key);
    if (settled) settled.scrollTop = 0;
    return;
  }
  const target = el ?? reasoningBodyEls.get(key);
  if (!target) return;
  const maxScroll = target.scrollHeight - target.clientHeight;
  if (maxScroll <= 1) {
    stopReasoningFollow(key);
    return;
  }

  if (prefersReducedMotion()) {
    target.scrollTop = maxScroll;
    stopReasoningFollow(key);
    return;
  }

  const existing = reasoningFollow.get(key);
  // Already chasing, or already pinned — avoid a no-op spring tick.
  if (existing?.raf) return;
  if (maxScroll - target.scrollTop <= SCROLL_FOLLOW_SNAP_PX) {
    target.scrollTop = maxScroll;
    if (existing) stopReasoningFollow(key);
    return;
  }

  const state = existing ?? { raf: 0, velocity: 0, lastTs: 0 };
  if (!existing) reasoningFollow.set(key, state);
  state.raf = requestAnimationFrame((ts) => stepReasoningFollow(key, ts));
}

function stepReasoningFollow(key: string, ts: number) {
  const state = reasoningFollow.get(key);
  if (!state) return;
  state.raf = 0;

  const el = reasoningBodyEls.get(key);
  if (!el || !isReasoningLivePinned(key)) {
    stopReasoningFollow(key);
    return;
  }

  if (prefersReducedMotion()) {
    el.scrollTop = el.scrollHeight;
    stopReasoningFollow(key);
    return;
  }

  const last = state.lastTs || ts;
  const dt = Math.min(0.064, Math.max(0.001, (ts - last) / 1000));
  state.lastTs = ts;

  const { nextScrollTop, velocity, settled } = computeScrollFollowStep(
    el.scrollTop,
    el.scrollHeight,
    el.clientHeight,
    state.velocity,
    dt,
    {
      stiffness: REASONING_FOLLOW_STIFFNESS,
      damping: REASONING_FOLLOW_DAMPING,
    },
  );
  state.velocity = velocity;
  if (nextScrollTop !== el.scrollTop) {
    el.scrollTop = nextScrollTop;
  }

  if (settled) {
    stopReasoningFollow(key);
    return;
  }
  state.raf = requestAnimationFrame((nextTs) => stepReasoningFollow(key, nextTs));
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
    stopReasoningFollow(key);
    reasoningBodyEls.delete(key);
  }
  if (!target) {
    stopReasoningFollow(key);
    return;
  }
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
  stopAllReasoningFollows();
  reasoningBodyEls.clear();
  reasoningBodyRefFns.clear();
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
  const willExpand = !isReasoningExpanded(key);
  next.set(key, willExpand);
  reasoningOverrides.value = next;
  // 展开/收起都回到顶部，避免残留的 scrollTop 让「第 1 行」看起来没露头。
  const el = reasoningBodyEls.get(key);
  if (el) el.scrollTop = 0;
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
  transition:
    color 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease;
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

/*
 * 展开态：让折叠条在「收起 → 展开」时看得见变化。
 * 仅当内容溢出且已展开时挂上，收起 / 静态无溢出一律透明。
 * 底色与左侧引用竖线同色系（rgba(88, 166, 255, ...)），保持过程流视觉统一。
 */
.stream-reasoning-btn--expanded {
  color: rgba(190, 216, 240, 0.96);
  border-color: rgba(88, 166, 255, 0.32);
  background: rgba(88, 166, 255, 0.12);
  border-radius: 6px;
}

.stream-reasoning-btn--expanded:hover {
  color: rgba(210, 230, 250, 0.98);
  border-color: rgba(88, 166, 255, 0.46);
  background: rgba(88, 166, 255, 0.18);
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

/*
 * 折叠预览：只露出开头 N 行，底部渐隐提示「还有内容」。
 *
 * 刻意 **不是** 滚动容器（不用 overflow-y: auto）——否则鼠标落在思考过程上时
 * 滚轮会被它吃掉，用户没法继续滚整个对话，也收不到「回到底部」。
 * 想看全文走展开按钮（isReasoningExpanded），展开后随外层对话一起滚。
 */
.stream-reasoning-body--clamped {
  position: relative;
  overflow: hidden;
  mask-image: linear-gradient(180deg, #000 calc(100% - 16px), transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 16px), transparent 100%);
}

/*
 * 折叠态的纯文本预览。字号/行高/颜色/斜体刻意与
 * `.inline-feed-markdown--reasoning :deep(.msg-markdown)` 保持一致 ——
 * measureReasoningBody 用 getComputedStyle 读 lineHeight 来算一行高度，
 * 不一致会导致折叠态被裁得高低不对、或与展开态视觉跳变。
 */
.stream-reasoning-plain {
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.55;
  color: rgba(186, 196, 208, 0.78);
  font-style: italic;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/*
 * 思考中：程序把内容滚到最新一行（scrollTop 由测量逻辑写，用户滚不动这容器），
 * 两端渐隐让新文本像「浮上来」而不是硬裁。用户看不到滚动条，也不会被它吃掉滚轮。
 */
.stream-reasoning-body--clamped.stream-reasoning-body--live {
  scroll-behavior: auto;
  transition: none;
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
