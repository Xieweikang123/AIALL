<template>
  <Transition name="reasoning-panel">
    <section
      v-if="state.open"
      class="reasoning-panel"
      aria-label="思考过程"
    >
      <header class="reasoning-panel-head">
        <span
          v-if="entry?.active"
          class="reasoning-panel-dot"
          aria-hidden="true"
        />
        <span class="reasoning-panel-title">
          {{ entry?.active ? "思考中…" : "思考过程" }}
        </span>
        <span v-if="entry" class="reasoning-panel-sub">{{ charCount }} 字</span>
        <button
          type="button"
          class="reasoning-panel-follow"
          :class="{ 'reasoning-panel-follow--on': state.follow }"
          :title="state.follow ? '正在跟随最新内容，点击暂停' : '已暂停跟随，点击回到底部'"
          @click="toggleFollow"
        >
          {{ state.follow ? "跟随中" : "已暂停" }}
        </button>
        <button
          type="button"
          class="reasoning-panel-close"
          title="收起思考过程"
          @click="closeReasoningDrawer"
        >
          ✕
        </button>
      </header>

      <div
        ref="bodyEl"
        class="reasoning-panel-body"
        @scroll="onScroll"
        @wheel="markUserIntent"
        @touchstart="markUserIntent"
        @mousedown="markUserIntent"
      >
        <ChatMarkdown
          v-if="entry && entry.text.trim()"
          class="reasoning-panel-markdown"
          :content="displayText"
          :streaming="Boolean(entry.active)"
          :interactive="false"
        />
        <div v-else class="reasoning-panel-empty">
          等待思考内容…
        </div>
      </div>
    </section>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import {
  closeReasoningDrawer,
  resolveReasoningDrawerEntry,
  setReasoningDrawerFollow,
  useReasoningDrawerState,
} from "../services/agentReasoningDrawer";
import { sanitizeFeedThoughtText } from "../services/agentProgressMarker";
import { computeScrollFollowStep, prefersReducedMotion } from "../utils/scrollViewport";

const state = useReasoningDrawerState();
const bodyEl = ref<HTMLElement | null>(null);

/** 与消息内思考块同一条清洗链路，保证两处显示一致 */
const entry = computed(() => (state.open ? resolveReasoningDrawerEntry() : null));
const displayText = computed(() => (entry.value ? sanitizeFeedThoughtText(entry.value.text) : ""));
const charCount = computed(() => displayText.value.length);

let raf = 0;
let velocity = 0;
let lastTs = 0;

function stopFollow() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  velocity = 0;
}

/**
 * 用户主动上滚 → 暂停跟随；回到底部 → 自动恢复。
 * 只有用户操作（wheel/touch/拖滚动条）打开的窗口内才做判定，
 * 弹簧吸底自己写 scrollTop 时忽略，避免自我打断。
 */
let userIntent = false;
let userIntentTimer: ReturnType<typeof setTimeout> | null = null;

function onScroll() {
  const el = bodyEl.value;
  if (!el || !state.follow) return;
  if (!userIntent) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight <= 24) return;
  setReasoningDrawerFollow(false);
  stopFollow();
}

function markUserIntent() {
  userIntent = true;
  if (userIntentTimer) clearTimeout(userIntentTimer);
  // scroll 事件异步派发，留一个短窗口让紧随其后的 scroll 按「用户操作」判定。
  userIntentTimer = setTimeout(() => {
    userIntent = false;
    userIntentTimer = null;
  }, 160);
}

function writeScroll(el: HTMLElement, top: number) {
  el.scrollTop = top;
}

function toggleFollow() {
  setReasoningDrawerFollow(!state.follow);
  if (state.follow) pinToBottom();
  else stopFollow();
}

function pinToBottom() {
  const el = bodyEl.value;
  if (!el || !state.follow) return;
  const maxScroll = el.scrollHeight - el.clientHeight;
  if (maxScroll <= 1) {
    stopFollow();
    return;
  }
  if (prefersReducedMotion()) {
    writeScroll(el, maxScroll);
    stopFollow();
    return;
  }
  const distance = maxScroll - el.scrollTop;
  if (distance <= 0.6) {
    writeScroll(el, maxScroll);
    stopFollow();
    return;
  }
  if (raf) return;
  lastTs = 0;
  raf = requestAnimationFrame(step);
}

function step(ts: number) {
  raf = 0;
  const el = bodyEl.value;
  if (!el || !state.follow) {
    stopFollow();
    return;
  }
  const last = lastTs || ts;
  const dt = Math.min(0.064, Math.max(0.001, (ts - last) / 1000));
  lastTs = ts;
  const result = computeScrollFollowStep(
    el.scrollTop,
    el.scrollHeight,
    el.clientHeight,
    velocity,
    dt,
    { stiffness: 62, damping: 16.2 },
  );
  velocity = result.velocity;
  if (result.nextScrollTop !== el.scrollTop) writeScroll(el, result.nextScrollTop);
  if (result.settled) {
    stopFollow();
    return;
  }
  raf = requestAnimationFrame(step);
}

function resetView() {
  const el = bodyEl.value;
  if (el) writeScroll(el, el.scrollHeight);
  stopFollow();
}

// 每次面板出现 / 切换到新的一段 → 落到底部（避免看到中间态）
watch(
  () => [state.open, state.key],
  () => {
    if (!state.open) {
      stopFollow();
      return;
    }
    setReasoningDrawerFollow(true);
    requestAnimationFrame(() => resetView());
  },
);

// 新内容到达 → 跟随吸底
watch(
  () => entry.value?.text.length ?? 0,
  () => pinToBottom(),
);

onUnmounted(() => {
  if (userIntentTimer) {
    clearTimeout(userIntentTimer);
    userIntentTimer = null;
  }
  stopFollow();
});
</script>

<style scoped>
.reasoning-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 320px;
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
  background: #070708;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.reasoning-panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 9px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}

.reasoning-panel-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(126, 182, 255, 0.9);
  animation: reasoning-panel-breathe 1.6s ease-in-out infinite;
  flex-shrink: 0;
}

.reasoning-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reasoning-panel-sub {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.7);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.reasoning-panel-follow {
  margin-left: auto;
  padding: 2px 7px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(139, 148, 158, 0.85);
  font-size: 10px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.reasoning-panel-follow:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.reasoning-panel-follow--on {
  border-color: rgba(126, 182, 255, 0.28);
  background: rgba(88, 166, 255, 0.1);
  color: rgba(165, 214, 255, 0.92);
}

.reasoning-panel-close {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 5px;
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.reasoning-panel-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
}

.reasoning-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px 20px;
  min-height: 0;
  overscroll-behavior: contain;
}

.reasoning-panel-markdown {
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.74);
  word-break: break-word;
}

.reasoning-panel-empty {
  font-size: 11.5px;
  color: rgba(139, 148, 158, 0.65);
  padding: 12px 2px;
  line-height: 1.6;
}

@keyframes reasoning-panel-breathe {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

/* 从右侧滑入并让出宽度 */
.reasoning-panel-enter-active,
.reasoning-panel-leave-active {
  transition: width 0.2s ease, opacity 0.2s ease;
}

.reasoning-panel-enter-from,
.reasoning-panel-leave-to {
  width: 0;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .reasoning-panel-enter-active,
  .reasoning-panel-leave-active {
    transition: none;
  }
}

/*
 * 窄屏（手机 tab 布局）：并排会把聊天挤没，改成盖在聊天区上，
 * 宽度收到 ~72vw，保证两边都还能看。
 */
@media (max-width: 768px) {
  .reasoning-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 72vw;
    z-index: 5;
    box-shadow: -12px 0 32px rgba(0, 0, 0, 0.5);
  }
}
</style>
