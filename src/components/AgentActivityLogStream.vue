<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { isScrollNearBottom, scrollElementToBottom } from "../utils/scrollViewport";

export type AgentLogLineItem = {
  key: string;
  label: string;
  state: "done" | "running" | "fail";
};

const props = withDefaults(
  defineProps<{
    items: AgentLogLineItem[];
    liveStatus?: string | null;
    hiddenCount?: number;
  }>(),
  { liveStatus: null, hiddenCount: 0 },
);

const viewportRef = ref<HTMLElement | null>(null);
const pinnedToBottom = ref(true);
const showJumpToLatest = ref(false);

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function updateJumpVisibility() {
  const el = viewportRef.value;
  if (!el) {
    showJumpToLatest.value = false;
    return;
  }
  showJumpToLatest.value =
    !isScrollNearBottom(el) && el.scrollHeight > el.clientHeight + 8;
}

function onViewportScroll() {
  const el = viewportRef.value;
  if (!el) return;
  pinnedToBottom.value = isScrollNearBottom(el);
  updateJumpVisibility();
}

function scrollToBottom(force = false) {
  void nextTick(() => {
    const el = viewportRef.value;
    if (!el) return;
    if (!force && !pinnedToBottom.value) {
      updateJumpVisibility();
      return;
    }
    el.scrollTo({
      top: el.scrollHeight,
      behavior: force || prefersReducedMotion() ? "auto" : "smooth",
    });
    pinnedToBottom.value = true;
    showJumpToLatest.value = false;
  });
}

function jumpToLatest() {
  const el = viewportRef.value;
  if (!el) return;
  scrollElementToBottom(el, prefersReducedMotion() ? "auto" : "smooth");
  pinnedToBottom.value = true;
  showJumpToLatest.value = false;
}

watch(
  () => [props.items.length, props.items[props.items.length - 1]?.key, props.liveStatus],
  () => scrollToBottom(),
  { deep: true },
);

onMounted(() => scrollToBottom(true));
</script>

<template>
  <div class="log-stream">
    <p v-if="hiddenCount > 0" class="log-stream-ghost">↑ 另有 {{ hiddenCount }} 步</p>
    <div class="log-stream-viewport-wrap">
      <div ref="viewportRef" class="log-stream-viewport" @scroll="onViewportScroll">
        <TransitionGroup name="log-line" tag="div" class="log-stream-lines">
          <div
            v-for="item in items"
            :key="item.key"
            class="log-line"
            :class="item.state"
          >
            {{ item.label }}
          </div>
        </TransitionGroup>
      </div>
      <button
        v-if="showJumpToLatest"
        type="button"
        class="log-stream-jump"
        title="回到最新"
        aria-label="回到最新"
        @click="jumpToLatest"
      >
        ↓
      </button>
    </div>
    <div v-if="liveStatus" class="log-stream-live">
      <span class="log-stream-live-dot" aria-hidden="true" />
      <span class="log-stream-live-text">{{ liveStatus }}</span>
    </div>
  </div>
</template>

<style scoped>
.log-stream {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(1, 4, 9, 0.72);
  border: 1px solid rgba(48, 54, 61, 0.85);
  border-left: 2px solid rgba(88, 166, 255, 0.35);
}

.log-stream-ghost {
  margin: 0;
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(139, 148, 158, 0.55);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.log-stream-viewport-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.log-stream-viewport {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 168px;
  overflow: hidden auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  mask-image: linear-gradient(to bottom, transparent 0, #000 16px, #000 calc(100% - 12px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 16px, #000 calc(100% - 12px), transparent 100%);
}

.log-stream-viewport::before {
  content: "";
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  display: block;
  height: 16px;
  margin: 0 0 -16px;
  pointer-events: none;
  z-index: 1;
  background: linear-gradient(to bottom, rgba(1, 4, 9, 0.94) 0%, rgba(1, 4, 9, 0.5) 60%, transparent 100%);
}

.log-stream-jump {
  position: absolute;
  bottom: 8px;
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(88, 166, 255, 0.42);
  background: rgba(1, 8, 18, 0.92);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.32);
  color: rgba(126, 182, 255, 0.96);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transform: translateX(-50%);
}

.log-stream-jump:hover {
  border-color: rgba(126, 182, 255, 0.65);
  background: rgba(14, 28, 48, 0.96);
}

.log-stream-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-line {
  margin: 0;
  padding: 1px 0;
  font-size: 11.5px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.01em;
  color: rgba(171, 178, 191, 0.88);
  word-break: break-word;
}

.log-line.done {
  color: rgba(139, 148, 158, 0.72);
}

.log-line.done::before {
  content: "· ";
  color: rgba(88, 166, 255, 0.28);
}

.log-line.running {
  color: rgba(126, 182, 255, 0.95);
}

.log-line.running::before {
  content: "› ";
  color: rgba(126, 182, 255, 0.9);
}

.log-line.fail {
  color: rgba(248, 143, 143, 0.92);
}

.log-line.fail::before {
  content: "× ";
  color: rgba(248, 143, 143, 0.65);
}

.log-line-enter-active {
  transition: transform 180ms ease-out, opacity 180ms ease-out;
}

.log-line-leave-active {
  overflow: hidden;
  transition: opacity 80ms ease-in, max-height 80ms ease-in, margin 80ms ease-in, padding 80ms ease-in;
  max-height: 24px;
}

.log-line-enter-from {
  transform: translateY(8px);
  opacity: 0;
}

.log-line-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.log-line-move {
  transition: transform 180ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .log-line-enter-active,
  .log-line-leave-active,
  .log-line-move {
    transition: none;
  }

  .log-line-enter-from {
    transform: none;
    opacity: 1;
  }
}

.log-stream-live {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
  flex-shrink: 0;
  padding-top: 2px;
  border-top: 1px solid rgba(48, 54, 61, 0.6);
}

.log-stream-live-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(126, 182, 255, 0.95);
  animation: log-stream-pulse 1.15s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .log-stream-live-dot {
    animation: none;
    opacity: 0.85;
  }
}

@keyframes log-stream-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.82);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.log-stream-live-text {
  font-size: 11.5px;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: rgba(121, 192, 255, 0.55);
}
</style>
