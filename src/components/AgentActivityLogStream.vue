<script setup lang="ts">
import { nextTick, onMounted, onUpdated, ref, watch } from "vue";

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

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToBottom() {
  void nextTick(() => {
    const el = viewportRef.value;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  });
}

watch(
  () => [props.items.length, props.items[props.items.length - 1]?.key, props.liveStatus],
  () => scrollToBottom(),
  { deep: true },
);

onMounted(() => scrollToBottom());
onUpdated(() => scrollToBottom());
</script>

<template>
  <div class="log-stream">
    <p v-if="hiddenCount > 0" class="log-stream-ghost">↑ 另有 {{ hiddenCount }} 步</p>
    <div ref="viewportRef" class="log-stream-viewport">
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

.log-stream-viewport {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 148px;
  overflow: hidden auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  mask-image: linear-gradient(to bottom, transparent 0%, #000 14%, #000 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 14%, #000 100%);
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
