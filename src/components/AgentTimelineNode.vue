<template>
  <div
    class="timeline-node"
    :class="[
      `timeline-node--${variant}`,
      node ? `timeline-node--${node.kind}` : '',
      node ? `timeline-node--${node.status}` : '',
      { 'timeline-node--nested': nested, 'timeline-node--last': isLast },
    ]"
  >
    <div class="timeline-node-rail" aria-hidden="true">
      <span class="timeline-node-dot" :class="dotClass">
        <span v-if="showCheck" class="timeline-node-check">✓</span>
      </span>
      <span v-if="!isLast" class="timeline-node-line" />
    </div>

    <div class="timeline-node-body">
      <details
        v-if="variant === 'collapsed'"
        class="timeline-collapsed"
        :open="collapsedOpen"
        @toggle="onCollapsedToggle"
      >
        <summary class="timeline-collapsed-summary">
          <span class="timeline-collapsed-label">{{ collapsedSummary }}</span>
        </summary>
        <div class="timeline-collapsed-children">
          <AgentTimelineNode
            v-for="(child, index) in collapsedNodes"
            :key="child.key"
            variant="node"
            :node="child"
            :nested="true"
            :is-last="index === collapsedNodes.length - 1"
            @open-file="(path) => emit('openFile', path)"
          />
        </div>
      </details>

      <div v-else-if="variant === 'thought' && displayThoughtText" class="timeline-thought-body">
        <ChatMarkdown :content="displayThoughtText" :streaming="thoughtStreaming" />
      </div>

      <div v-else-if="node" class="timeline-node-content">
        <div class="timeline-node-head">
          <span class="timeline-node-icon">{{ node.icon }}</span>
          <div class="timeline-node-text">
            <span class="timeline-node-title">{{ node.title }}</span>
            <span v-if="node.subtitle && !hasChips" class="timeline-node-subtitle">{{ node.subtitle }}</span>
          </div>
        </div>

        <div v-if="hasChips" class="timeline-node-chips" :class="{ 'timeline-node-chips--chain': node.kind === 'explore' }">
          <template v-for="(chip, index) in node.chips" :key="chip.key">
            <span v-if="node.kind === 'explore' && index > 0" class="timeline-chip-arrow" aria-hidden="true">→</span>
            <button
              v-if="chip.path"
              type="button"
              class="timeline-chip timeline-chip--link"
              :title="chip.title || chip.path"
              @click="emit('openFile', chip.path!)"
            >
              {{ chip.label }}
            </button>
            <span v-else class="timeline-chip" :title="chip.title">{{ chip.label }}</span>
          </template>
        </div>

        <details v-if="node.expandable && node.previewLines.length" class="timeline-node-details">
          <summary class="timeline-node-details-summary">
            {{ node.kind === "search" ? "查看匹配" : "展开详情" }}
          </summary>
          <ul class="timeline-node-preview">
            <li v-for="(line, index) in node.previewLines" :key="index">{{ line }}</li>
          </ul>
        </details>
      </div>

      <div v-else-if="variant === 'answer'" class="timeline-answer-body">
        <div class="timeline-answer-label">
          <span v-if="answerStreaming" class="timeline-answer-label--live shimmer-text--fast">回答中</span>
          <span v-else>回答</span>
        </div>
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import { sanitizeFeedThoughtText } from "../services/agentProgressMarker";
import type { TimelineNode } from "../services/agentTimelineNodes";

defineOptions({ name: "AgentTimelineNode" });

const props = withDefaults(
  defineProps<{
    variant: "node" | "thought" | "collapsed" | "answer";
    node?: TimelineNode;
    thoughtText?: string;
    thoughtStreaming?: boolean;
    collapsedSummary?: string;
    collapsedNodes?: TimelineNode[];
    answerStreaming?: boolean;
    nested?: boolean;
    isLast?: boolean;
  }>(),
  {
    nested: false,
    isLast: false,
    answerStreaming: false,
    collapsedNodes: () => [],
  },
);

const emit = defineEmits<{
  openFile: [path: string];
}>();

const collapsedOpen = ref(false);

const displayThoughtText = computed(() =>
  props.variant === "thought" ? sanitizeFeedThoughtText(props.thoughtText || "") : "",
);

const hasChips = computed(() => Boolean(props.node?.chips.length));

const dotClass = computed(() => {
  if (props.variant === "thought") return "timeline-node-dot--thought";
  if (props.variant === "answer") {
    return props.answerStreaming ? "timeline-node-dot--answer-streaming" : "timeline-node-dot--answer";
  }
  if (props.variant === "collapsed") return "timeline-node-dot--collapsed";
  if (props.node?.status === "running") return "timeline-node-dot--running";
  if (props.node?.status === "fail") return "timeline-node-dot--fail";
  return "timeline-node-dot--ok";
});

const showCheck = computed(
  () => props.variant === "node" && props.node?.status === "ok" && !props.nested,
);

function onCollapsedToggle(event: Event) {
  const target = event.target;
  if (target instanceof HTMLDetailsElement) {
    collapsedOpen.value = target.open;
  }
}
</script>

<style scoped>
.timeline-node {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 0 10px;
  min-width: 0;
  animation: timeline-node-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.timeline-node--nested {
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 0 8px;
}

@keyframes timeline-node-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.timeline-node-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 18px;
  min-height: 100%;
  padding-top: 6px;
}

.timeline-node--nested .timeline-node-rail {
  width: 14px;
  padding-top: 5px;
}

.timeline-node-dot {
  position: relative;
  z-index: 1;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 2px solid rgba(88, 166, 255, 0.35);
  background: rgba(13, 17, 23, 0.95);
  box-sizing: border-box;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.timeline-node--nested .timeline-node-dot {
  width: 7px;
  height: 7px;
}

.timeline-node-dot--thought {
  width: 7px;
  height: 7px;
  border-color: rgba(148, 163, 184, 0.35);
  background: transparent;
}

.timeline-node-dot--answer {
  width: 10px;
  height: 10px;
  border-color: rgba(88, 166, 255, 0.75);
  background: rgba(88, 166, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.08);
}

.timeline-node-dot--answer-streaming {
  width: 10px;
  height: 10px;
  border-color: rgba(88, 166, 255, 0.9);
  background: rgba(88, 166, 255, 0.55);
  animation: timeline-dot-pulse 1.4s ease-in-out infinite;
}

.timeline-node-dot--running {
  border-color: rgba(88, 166, 255, 0.9);
  background: rgba(88, 166, 255, 0.55);
  animation: timeline-dot-pulse 1.4s ease-in-out infinite;
}

.timeline-node-dot--ok {
  border-color: rgba(63, 185, 80, 0.55);
  background: rgba(63, 185, 80, 0.2);
}

.timeline-node-dot--fail {
  border-color: rgba(248, 81, 73, 0.75);
  background: rgba(248, 81, 73, 0.35);
}

.timeline-node-dot--collapsed {
  border-color: rgba(148, 163, 184, 0.25);
  background: rgba(148, 163, 184, 0.08);
}

.timeline-node-check {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 7px;
  line-height: 1;
  color: rgba(126, 231, 135, 0.95);
  font-weight: 700;
}

.timeline-node-line {
  flex: 1;
  width: 2px;
  min-height: 8px;
  margin-top: 3px;
  border-radius: 1px;
  background: linear-gradient(
    to bottom,
    rgba(88, 166, 255, 0.22),
    rgba(88, 166, 255, 0.08)
  );
}

.timeline-node--last .timeline-node-line {
  display: none;
}

.timeline-node-body {
  min-width: 0;
  padding-bottom: 10px;
}

.timeline-node--last .timeline-node-body {
  padding-bottom: 2px;
}

.timeline-node-content {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.timeline-node-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.timeline-node-icon {
  font-size: 12px;
  line-height: 1.35;
  flex-shrink: 0;
  opacity: 0.85;
}

.timeline-node-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.timeline-node-title {
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.35;
  color: rgba(240, 246, 252, 0.92);
}

.timeline-node-subtitle {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.62);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-node-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.timeline-node-chips--chain {
  flex-wrap: nowrap;
  overflow-x: auto;
  padding-bottom: 1px;
  scrollbar-width: thin;
}

.timeline-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(148, 163, 184, 0.06);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(201, 209, 217, 0.88);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.timeline-chip--link {
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.timeline-chip--link:hover {
  border-color: rgba(88, 166, 255, 0.35);
  background: rgba(88, 166, 255, 0.1);
  color: rgba(165, 214, 255, 0.98);
}

.timeline-chip-arrow {
  flex-shrink: 0;
  font-size: 9px;
  color: rgba(148, 163, 184, 0.35);
}

.timeline-node-details {
  margin: 0;
}

.timeline-node-details-summary {
  list-style: none;
  font-size: 10px;
  color: rgba(148, 163, 184, 0.52);
  cursor: pointer;
  user-select: none;
  padding: 1px 0;
}

.timeline-node-details-summary::-webkit-details-marker {
  display: none;
}

.timeline-node-details-summary::before {
  content: "▸ ";
  font-size: 8px;
}

.timeline-node-details[open] > .timeline-node-details-summary::before {
  content: "▾ ";
}

.timeline-node-preview {
  margin: 2px 0 0;
  padding: 0 0 0 12px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeline-node-preview li {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.58);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-thought-body {
  padding: 1px 8px 2px 10px;
  border-left: 2px solid rgba(148, 163, 184, 0.14);
  font-size: 12px;
  line-height: 1.55;
  color: rgba(186, 196, 208, 0.82);
  font-style: italic;
}

.timeline-thought-body :deep(.msg-markdown) {
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  font-style: italic;
}

.timeline-thought-body :deep(.msg-markdown p) {
  margin: 0 0 0.35em;
}

.timeline-thought-body :deep(.msg-markdown p:last-child) {
  margin-bottom: 0;
}

.timeline-collapsed {
  margin: 0;
  min-width: 0;
}

.timeline-collapsed-summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  padding: 1px 0;
}

.timeline-collapsed-summary::-webkit-details-marker {
  display: none;
}

.timeline-collapsed-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(148, 163, 184, 0.55);
}

.timeline-collapsed-summary::before {
  content: "▸ ";
  font-size: 8px;
  color: rgba(148, 163, 184, 0.28);
}

.timeline-collapsed[open] > .timeline-collapsed-summary::before {
  content: "▾ ";
}

.timeline-collapsed-children {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 4px;
  padding-left: 2px;
}

.timeline-answer-body {
  padding-top: 2px;
}

.timeline-answer-label {
  margin-bottom: 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(126, 182, 255, 0.72);
}

@keyframes timeline-dot-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(88, 166, 255, 0.35);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(88, 166, 255, 0);
  }
}
</style>
