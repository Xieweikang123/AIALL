<template>
  <div class="agent-timeline">
    <div
      ref="scrollContainerRef"
      class="agent-timeline-scroll"
      :class="{ 'agent-timeline-scroll--limited': shouldLimitScroll }"
    >
      <AgentTimelineNode
        v-for="(entry, index) in toolEntries"
        :key="entryRenderKey(entry, index)"
        :variant="entryVariant(entry)"
        :node="entry.kind === 'node' ? entry.node : undefined"
        :collapsed-summary="entry.kind === 'collapsed' ? entry.summary : undefined"
        :collapsed-nodes="entry.kind === 'collapsed' ? entry.nodes : undefined"
        :is-last="index === toolEntries.length - 1 && thoughtEntries.length === 0 && answerEntries.length === 0 && !liveFooterStatus"
        @open-file="(path) => emit('openFile', path)"
      />
    </div>

    <AgentTimelineNode
      v-for="(entry, index) in thoughtEntries"
      :key="entryRenderKey(entry, index)"
      variant="thought"
      :thought-text="entry.text"
      :thought-streaming="isRunning && entry.key === lastThoughtKey"
      :is-last="index === thoughtEntries.length - 1 && answerEntries.length === 0 && !liveFooterStatus"
      @open-file="(path) => emit('openFile', path)"
    />

    <AgentTimelineNode
      v-for="(entry, index) in answerEntries"
      :key="entryRenderKey(entry, index)"
      variant="answer"
      :is-last="index === answerEntries.length - 1 && !liveFooterStatus"
      @open-file="(path) => emit('openFile', path)"
    >
      <PlanDocumentBlock
        :content="entry.text"
        :chat-mode="chatMode"
        :streaming="entry.streaming || isRunning"
        :can-execute="canExecutePlan && !isRunning && !entry.streaming"
        :enhance-layout="layoutEnhanceReady && !isRunning && !entry.streaming"
        @execute="emit('execute-plan')"
      >
        <ChatMarkdown
          class="timeline-answer__markdown"
          :content="answerMarkdown(entry.text)"
          :streaming="entry.streaming || isRunning"
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
import { buildAgentLiveFooterStatus } from "../services/agentCompactStatus";
import { buildTimelineEntriesFromBlocks, type TimelineRenderEntry } from "../services/agentTimelineNodes";
import type { CursorFeedBlock } from "../services/agentCursorFeed";
import { scrollElementToBottom, isScrollNearBottom } from "../utils/scrollViewport";
import { sanitizeFeedThoughtText } from "../services/agentProgressMarker";
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

const scrollContainerRef = ref<HTMLElement | null>(null);

const renderEntries = computed(() => buildTimelineEntriesFromBlocks(displayBlocks.value));

const toolEntries = computed(() =>
  renderEntries.value.filter((entry) => entry.kind === "node" || entry.kind === "collapsed"),
);

const answerEntries = computed(() =>
  renderEntries.value.filter((entry): entry is Extract<TimelineRenderEntry, { kind: "answer" }> => entry.kind === "answer"),
);

const showTimelineThoughts = computed(
  () => props.activityDetailed || answerEntries.value.length === 0,
);

const thoughtEntries = computed(() => {
  if (!showTimelineThoughts.value) return [];
  return renderEntries.value.filter(
    (entry): entry is Extract<TimelineRenderEntry, { kind: "thought" }> =>
      entry.kind === "thought" && Boolean(sanitizeFeedThoughtText(entry.text)),
  );
});

const shouldLimitScroll = computed(
  () => toolEntries.value.length > TIMELINE_SCROLL_VISIBLE_COUNT,
);

const hasAnswerBlock = computed(() => props.blocks.some((block) => block.kind === "answer"));

const hasActionBlocks = computed(() => props.blocks.some((block) => block.kind === "actions"));

const lastThoughtKey = computed(() => {
  for (let index = props.blocks.length - 1; index >= 0; index -= 1) {
    const block = props.blocks[index];
    if (block?.kind === "thought") return block.key;
  }
  return "";
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

function entryVariant(entry: TimelineRenderEntry): "node" | "thought" | "collapsed" | "answer" {
  if (entry.kind === "thought") return "thought";
  if (entry.kind === "collapsed") return "collapsed";
  if (entry.kind === "answer") return "answer";
  return "node";
}

function entryRenderKey(entry: TimelineRenderEntry, index: number): string {
  return `${entry.kind}:${entry.key}:${index}`;
}

function answerMarkdown(text: string) {
  return enrichPlanMarkdownForDisplay(text, {
    whileStreaming: Boolean(props.isRunning),
  });
}

function scrollTimelineToBottom() {
  const el = scrollContainerRef.value;
  if (!el) return;
  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  scrollElementToBottom(el, behavior);
  if (behavior === "auto") return;
  window.setTimeout(() => {
    const current = scrollContainerRef.value;
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
  },
  { flush: "post" },
);
</script>

<style scoped>
.agent-timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  padding: 4px 0 2px 2px;
}

.agent-timeline-scroll {
  min-width: 0;
}

.agent-timeline-scroll--limited {
  max-height: calc(var(--timeline-scroll-row-height, 60px) * 3);
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: rgba(88, 166, 255, 0.28) transparent;
  padding-right: 2px;
}

.agent-timeline-scroll--limited::-webkit-scrollbar {
  width: 5px;
}

.agent-timeline-scroll--limited::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(88, 166, 255, 0.28);
}

.agent-timeline-scroll--limited::-webkit-scrollbar-thumb:hover {
  background: rgba(88, 166, 255, 0.42);
}

@media (prefers-reduced-motion: reduce) {
  .agent-timeline-scroll--limited {
    scroll-behavior: auto;
  }
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
