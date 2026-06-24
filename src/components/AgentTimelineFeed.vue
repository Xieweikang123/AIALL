<template>
  <div class="agent-timeline">
    <details
      v-if="shouldWrapProcess"
      class="timeline-fold timeline-process-fold"
      :open="processExpanded"
      @toggle="onProcessToggle"
    >
      <summary class="timeline-fold-summary timeline-process-fold-summary">
        <span class="timeline-process-fold-label">{{ processSummary }}</span>
      </summary>
      <AgentTimelineToolScroll
        ref="toolScrollRef"
        :entries="toolEntries"
        :should-limit-scroll="shouldLimitScroll"
        :scroll-fade-top="scrollFadeTop"
        :is-entry-last="(index) => isToolEntryLast(index, true)"
        @open-file="(path) => emit('openFile', path)"
        @scroll="onToolScroll"
      />
    </details>

    <div v-else-if="toolEntries.length" class="timeline-tools">
      <AgentTimelineToolScroll
        ref="toolScrollRef"
        :entries="toolEntries"
        :should-limit-scroll="shouldLimitScroll"
        :scroll-fade-top="scrollFadeTop"
        :is-entry-last="(index) => isToolEntryLast(index, false)"
        @open-file="(path) => emit('openFile', path)"
        @scroll="onToolScroll"
      />
    </div>

    <details
      v-if="thoughtEntries.length"
      class="timeline-fold timeline-thought-fold"
      :open="thoughtsExpanded"
      @toggle="onThoughtToggle"
    >
      <summary class="timeline-fold-summary timeline-thought-fold-summary">
        <span
          class="timeline-thought-fold-label"
          :class="{ 'shimmer-text--fast': isRunning && !hasAnswerBlock }"
        >
          {{ thoughtSummary }}
        </span>
      </summary>
      <div class="timeline-thought-fold-body">
        <AgentTimelineNode
          v-for="(entry, index) in thoughtEntries"
          :key="entryRenderKey(entry, index)"
          variant="thought"
          :thought-text="entry.text"
          :thought-streaming="isRunning && entry.key === lastThoughtKey"
          :is-last="index === thoughtEntries.length - 1"
          @open-file="(path) => emit('openFile', path)"
        />
      </div>
    </details>

    <AgentTimelineNode
      v-for="(entry, index) in answerEntries"
      :key="entryRenderKey(entry, index)"
      variant="answer"
      :answer-streaming="entry.streaming && isRunning"
      :is-last="index === answerEntries.length - 1 && !liveFooterStatus"
      @open-file="(path) => emit('openFile', path)"
    >
      <div v-if="entry.streaming && isRunning && !entry.text.trim()" class="timeline-answer-placeholder">
        <span class="shimmer-text--fast">正在生成回答…</span>
      </div>
      <PlanDocumentBlock
        v-else
        :content="entry.text"
        :chat-mode="chatMode"
        :streaming="entry.streaming && isRunning"
        :can-execute="canExecutePlan && !isRunning && !entry.streaming"
        :enhance-layout="layoutEnhanceReady && !isRunning && !entry.streaming"
        @execute="emit('execute-plan')"
      >
        <ChatMarkdown
          class="timeline-answer__markdown"
          :content="answerMarkdown(entry.text)"
          :streaming="entry.streaming && isRunning"
          :interactive="true"
          @select-option="(option) => emit('select-option', option)"
        />
      </PlanDocumentBlock>
    </AgentTimelineNode>

    <div v-if="liveFooterStatus" class="timeline-footer">
      <span class="timeline-footer-dot" />
      <span class="timeline-footer-text shimmer-text--fast">{{ liveFooterStatus }}</span>
      <button
        v-if="showDebug"
        type="button"
        class="timeline-footer-debug"
        :title="debugExpanded ? '收起调试' : '展开调试'"
        @click="emit('toggle-debug')"
      >
        {{ debugExpanded ? "▾" : "▸" }}
      </button>
    </div>

    <div v-if="showTruncatedWarning" class="timeline-truncated">
      <span class="timeline-truncated__text">回答可能不完整（以冒号、省略号或未闭合格式结尾）。</span>
      <button
        v-if="canResume"
        type="button"
        class="timeline-truncated__action"
        @click="emit('resume')"
      >
        {{ resumeLabel || "继续生成" }}
      </button>
    </div>

    <slot v-if="debugExpanded" name="debug" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import PlanDocumentBlock from "./PlanDocumentBlock.vue";
import AgentTimelineNode from "./AgentTimelineNode.vue";
import AgentTimelineToolScroll from "./AgentTimelineToolScroll.vue";
import { buildAgentLiveFooterStatus } from "../services/agentCompactStatus";
import {
  buildTimelineFeedFromBlocks,
  buildTimelineProcessSummaryFromSteps,
  buildTimelineThoughtSummary,
  selectVisibleTimelineThoughts,
  shouldAutoExpandTimelineThoughts,
  shouldCollapseTimelineProcess,
  type TimelineRenderEntry,
} from "../services/agentTimelineNodes";
import type { CursorFeedBlock } from "../services/agentCursorFeed";
import { scrollElementToBottom, isScrollNearBottom } from "../utils/scrollViewport";
import { enrichPlanMarkdownForDisplay } from "../services/planDocumentDisplay";
import type { AiOption } from "../utils/parseAiOptions";

const props = defineProps<{
  blocks: CursorFeedBlock[];
  isRunning: boolean;
  compactTools?: boolean;
  chatMode?: "ask" | "build" | "plan";
  canExecutePlan?: boolean;
  layoutEnhanceReady?: boolean;
  showDebug?: boolean;
  debugExpanded?: boolean;
  showTruncatedWarning?: boolean;
  canResume?: boolean;
  resumeLabel?: string;
  currentStatus?: string;
  hasRunningTool?: boolean;
  activityDetailed?: boolean;
}>();

const emit = defineEmits<{
  "execute-plan": [];
  "select-option": [option: AiOption];
  "toggle-debug": [];
  openFile: [path: string];
  resume: [];
}>();

const displayBlocks = computed(() => props.blocks.filter((block) => block.kind !== "status"));

const TIMELINE_SCROLL_VISIBLE_COUNT = 3;

const toolScrollRef = ref<InstanceType<typeof AgentTimelineToolScroll> | null>(null);
const processExpanded = ref(true);
const userExpandedProcess = ref(false);
const thoughtsExpanded = ref(false);
const userExpandedThoughts = ref(false);
const scrollFadeTop = ref(false);

const timelineFeed = computed(() => buildTimelineFeedFromBlocks(displayBlocks.value));

const toolEntries = computed(() => timelineFeed.value.toolEntries);

const answerEntries = computed(() => timelineFeed.value.answerEntries);

const showTimelineThoughts = computed(() => answerEntries.value.length === 0);

const thoughtEntries = computed(() =>
  selectVisibleTimelineThoughts(timelineFeed.value.thoughtEntries, {
    showThoughts: showTimelineThoughts.value,
    isRunning: props.isRunning,
    hasAnswer: answerEntries.value.length > 0,
    answerText: answerEntries.value.map((entry) => entry.text).join("\n\n"),
  }),
);

const hasThoughtFold = computed(() => thoughtEntries.value.length > 0);

const thoughtSummary = computed(() =>
  buildTimelineThoughtSummary(thoughtEntries.value, {
    streaming: props.isRunning && !hasAnswerBlock.value,
  }),
);

const shouldWrapProcess = computed(() =>
  shouldCollapseTimelineProcess({
    activityDetailed: props.activityDetailed,
    hasAnswer: answerEntries.value.length > 0,
    toolCount: toolEntries.value.length,
  }),
);

const shouldLimitScroll = computed(
  () => toolEntries.value.length > TIMELINE_SCROLL_VISIBLE_COUNT,
);

const processSummary = computed(() =>
  buildTimelineProcessSummaryFromSteps(timelineFeed.value.actionSteps),
);

watch(
  shouldWrapProcess,
  (wrap) => {
    if (wrap && !userExpandedProcess.value) {
      processExpanded.value = false;
    }
    if (!wrap) {
      processExpanded.value = true;
      userExpandedProcess.value = false;
    }
  },
  { immediate: true },
);

function onProcessToggle(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  processExpanded.value = target.open;
  if (target.open) userExpandedProcess.value = true;
  syncScrollFadeTop();
}

function onThoughtToggle(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  thoughtsExpanded.value = target.open;
  if (target.open) userExpandedThoughts.value = true;
}

watch(
  () => props.isRunning,
  (running) => {
    if (running && !userExpandedThoughts.value) {
      thoughtsExpanded.value = false;
    }
  },
);

watch(
  () =>
    [
      thoughtEntries.value.length,
      props.isRunning,
      answerEntries.value.length > 0,
      props.activityDetailed,
    ] as const,
  ([thoughtCount, running, hasAnswer, detailed]) => {
    if (userExpandedThoughts.value) return;
    thoughtsExpanded.value = shouldAutoExpandTimelineThoughts({
      isRunning: running,
      hasAnswer,
      thoughtCount,
      activityDetailed: detailed,
    });
  },
  { immediate: true },
);

function isToolEntryLast(index: number, inProcessFold: boolean): boolean {
  const isLastEntry = index === toolEntries.value.length - 1;
  if (inProcessFold) return isLastEntry;
  return isLastEntry && !hasThoughtFold.value && answerEntries.value.length === 0 && !liveFooterStatus.value;
}

function onToolScroll(scrollTop: number) {
  scrollFadeTop.value = scrollTop > 6;
}

function syncScrollFadeTop() {
  const el = toolScrollRef.value?.scrollEl;
  scrollFadeTop.value = Boolean(el && el.scrollTop > 6);
}

const hasAnswerBlock = computed(() => answerEntries.value.length > 0);

const hasActionBlocks = computed(() => timelineFeed.value.actionSteps.length > 0);

const lastThoughtKey = computed(() => {
  const thoughts = timelineFeed.value.thoughtEntries;
  return thoughts.length ? thoughts[thoughts.length - 1]!.key : "";
});

const liveFooterStatus = computed(() => {
  const fromCurrent = buildAgentLiveFooterStatus({
    currentStatus: props.currentStatus,
    isRunning: props.isRunning,
    hasAnswer: hasAnswerBlock.value,
    hasRunningTool: props.hasRunningTool,
    hasActionBlocks: hasActionBlocks.value,
  });
  if (fromCurrent) return fromCurrent;

  if (!props.isRunning || hasAnswerBlock.value) return null;

  for (let index = props.blocks.length - 1; index >= 0; index -= 1) {
    const block = props.blocks[index];
    if (block?.kind === "status" && block.text.trim()) {
      return block.text.trim();
    }
  }
  return null;
});

function entryRenderKey(entry: TimelineRenderEntry, index: number): string {
  return `${entry.kind}:${entry.key}:${index}`;
}

function answerMarkdown(text: string) {
  return enrichPlanMarkdownForDisplay(text, {
    whileStreaming: Boolean(props.isRunning),
  });
}

function scrollTimelineToBottom() {
  const el = toolScrollRef.value?.scrollEl;
  if (!el) return;
  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  scrollElementToBottom(el, behavior);
  if (behavior === "auto") return;
  window.setTimeout(() => {
    const current = toolScrollRef.value?.scrollEl;
    if (current && !isScrollNearBottom(current, 6)) {
      scrollElementToBottom(current, "smooth");
    }
  }, 320);
}

watch(
  () => [toolEntries.value.length, props.isRunning] as const,
  async ([entryCount, running]) => {
    if (!running || entryCount <= TIMELINE_SCROLL_VISIBLE_COUNT) return;
    await nextTick();
    scrollTimelineToBottom();
    syncScrollFadeTop();
  },
  { flush: "post" },
);

watch(shouldLimitScroll, async () => {
  await nextTick();
  syncScrollFadeTop();
});
</script>

<style scoped>
.agent-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  padding: 4px 0 2px 2px;
}

.timeline-process-fold :deep(.agent-timeline-scroll-wrap) {
  padding-left: 2px;
}

.timeline-fold {
  margin: 0 0 4px;
  min-width: 0;
}

.timeline-fold-summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  padding: 2px 0 6px 20px;
}

.timeline-fold-summary::-webkit-details-marker {
  display: none;
}

.timeline-fold-summary::before {
  content: "▸ ";
  font-size: 8px;
  color: rgba(148, 163, 184, 0.35);
}

.timeline-fold[open] > .timeline-fold-summary::before {
  content: "▾ ";
}

.timeline-process-fold-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.62);
}

.timeline-process-fold-summary:hover .timeline-process-fold-label {
  color: rgba(165, 214, 255, 0.88);
}

.timeline-thought-fold-label {
  font-size: 12px;
  line-height: 1.45;
  font-style: italic;
  color: rgba(186, 196, 208, 0.72);
}

.timeline-thought-fold-summary:hover .timeline-thought-fold-label {
  color: rgba(201, 209, 217, 0.92);
}

.timeline-thought-fold-body {
  padding-left: 2px;
}

.timeline-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 2px 20px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: rgba(148, 163, 184, 0.72);
}

.timeline-footer-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.55);
  flex-shrink: 0;
  animation: timeline-pulse 1.4s ease-in-out infinite;
}

@keyframes timeline-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.timeline-footer-text {
  flex: 1;
  min-width: 0;
}

.timeline-footer-debug {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: rgba(148, 163, 184, 0.45);
  font-size: 9px;
  cursor: pointer;
  padding: 0 2px;
}

.timeline-footer-debug:hover {
  color: rgba(148, 163, 184, 0.75);
}

.timeline-answer__markdown {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
}

.timeline-answer-placeholder {
  padding: 2px 0 4px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(148, 163, 184, 0.78);
}

.timeline-truncated {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(210, 153, 34, 0.08);
  border: 1px solid rgba(210, 153, 34, 0.18);
}

.timeline-truncated__text {
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 214, 130, 0.92);
}

.timeline-truncated__action {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid rgba(210, 153, 34, 0.35);
  background: rgba(210, 153, 34, 0.12);
  color: rgba(255, 230, 170, 0.96);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
</style>
