<template>
  <div
    class="agent-timeline-scroll-wrap"
    :class="{ 'agent-timeline-scroll-wrap--fade-top': shouldLimitScroll && scrollFadeTop }"
  >
    <div
      ref="scrollEl"
      class="agent-timeline-scroll"
      :class="{ 'agent-timeline-scroll--limited': shouldLimitScroll }"
      @scroll="onScroll"
    >
      <AgentTimelineNode
        v-for="(entry, index) in entries"
        :key="entryRenderKey(entry, index)"
        :variant="entryVariant(entry)"
        :node="entry.kind === 'node' ? entry.node : undefined"
        :collapsed-summary="entry.kind === 'collapsed' ? entry.summary : undefined"
        :collapsed-nodes="entry.kind === 'collapsed' ? entry.nodes : undefined"
        :is-last="isEntryLast(index)"
        @open-file="(path) => emit('openFile', path)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import AgentTimelineNode from "./AgentTimelineNode.vue";
import type { TimelineCollapsedEntry, TimelineNodeEntry, TimelineRenderEntry } from "../services/agentTimelineNodes";

defineProps<{
  entries: Array<TimelineNodeEntry | TimelineCollapsedEntry>;
  shouldLimitScroll: boolean;
  scrollFadeTop: boolean;
  isEntryLast: (index: number) => boolean;
}>();

const emit = defineEmits<{
  openFile: [path: string];
  scroll: [scrollTop: number];
}>();

const scrollEl = ref<HTMLElement | null>(null);

defineExpose({ scrollEl });

function entryVariant(entry: TimelineRenderEntry): "node" | "collapsed" {
  return entry.kind === "collapsed" ? "collapsed" : "node";
}

function entryRenderKey(entry: TimelineRenderEntry, index: number): string {
  return `${entry.kind}:${entry.key}:${index}`;
}

function onScroll(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  emit("scroll", target.scrollTop);
}
</script>

<style scoped>
.agent-timeline-scroll {
  min-width: 0;
}

.agent-timeline-scroll-wrap {
  position: relative;
  min-width: 0;
}

.agent-timeline-scroll-wrap--fade-top::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 28px;
  z-index: 2;
  pointer-events: none;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(
    to bottom,
    rgba(11, 18, 32, 0.98) 0%,
    rgba(11, 18, 32, 0.72) 42%,
    rgba(11, 18, 32, 0) 100%
  );
  box-shadow: inset 0 10px 12px -10px rgba(0, 0, 0, 0.42);
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
</style>
