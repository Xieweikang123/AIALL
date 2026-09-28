<template>
  <div
    class="chat-scroll-rail"
    :class="{ 'chat-scroll-rail--engaged': engaged }"
  >
    <!-- 静止态：一列小横杠。每条对应用户提问，当前视口中心那条变蓝加长。
         整列可点：按点击位置吸附到最近的一条（不用去戳 2px 的细杠，指哪打哪）。 -->
    <button
      ref="handleRef"
      type="button"
      class="chat-scroll-rail-handle"
      :title="items.length ? `会话导航：${items.length} 个提问（点任意位置跳转，悬浮展开目录）` : '会话导航'"
      :tabindex="engaged ? -1 : 0"
      @mouseenter="engage"
      @mouseleave="scheduleDisengage"
      @focus="engage"
      @keydown="onHandleKeydown"
      @click="onHandleClick"
    >
      <span class="chat-scroll-rail-track" aria-hidden="true" />
      <span
        v-for="mark in marks"
        :key="mark.id"
        class="chat-scroll-rail-tick"
        :class="{ active: mark.id === activeId }"
        :style="{ top: `${mark.pos * 100}%` }"
      />
      <!-- 比例滑块：替代原生滚动条的位置指示，可拖 -->
      <span
        v-if="thumb"
        class="chat-scroll-rail-thumb"
        :style="{ top: `${thumb.top * 100}%`, height: `${thumb.size * 100}%` }"
        aria-hidden="true"
        @mousedown="startScrub"
      />
    </button>

    <!-- 展开态：右对齐的消息目录，放在导轨左侧，不遮挡刻度（刻度仍可点） -->
    <div
      v-if="engaged"
      ref="panelRef"
      class="chat-scroll-rail-panel"
      role="listbox"
      aria-label="会话导航"
      @mouseenter="keepEngaged"
      @mouseleave="scheduleDisengage"
      @keydown="onPanelKeydown"
    >
      <ol class="chat-scroll-rail-list">
        <li v-for="(item, i) in items" :key="item.id" role="none">
          <button
            type="button"
            role="option"
            class="chat-scroll-rail-row"
            :class="{ active: item.id === activeId, hovered: item.id === hoverId }"
            :aria-selected="item.id === activeId"
            :tabindex="item.id === effectiveActiveId ? 0 : -1"
            :data-rail-index="i"
            :data-rail-id="item.id"
            :title="item.preview"
            @mouseenter="hoverId = item.id"
            @click="jump(item.id)"
          >
            <span class="chat-scroll-rail-preview">{{ item.preview }}</span>
            <span class="chat-scroll-rail-bar" aria-hidden="true" />
          </button>
        </li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import type { SessionOutlineItem } from "../../utils/sessionOutline";
import {
  computeChatRailAnchors,
  computeRailThumb,
  pickActiveChatRailAnchor,
  railThumbTopToScrollTop,
  RAIL_BAND_END,
  RAIL_BAND_START,
  type ChatRailAnchorInput,
} from "../../utils/chatScrollRail";

const props = defineProps<{
  items: SessionOutlineItem[];
  anchors: ChatRailAnchorInput[];
  viewport: { scrollTop: number; clientHeight: number; scrollHeight: number };
}>();

const emit = defineEmits<{
  jump: [messageId: string];
  /** 拖动比例滑块：请求把聊天区滚到指定 scrollTop。 */
  scrub: [scrollTop: number];
}>();

const handleRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const engaged = ref(false);
const hoverId = ref<string | null>(null);
let disengageRaf = 0;

/** 刻度位置 + 是否在视口内，由纯函数计算。 */
const marks = computed(() => computeChatRailAnchors(props.anchors, props.viewport));

/** 当前视口中心那条（跟随滚动，不随鼠标悬停变）。 */
const viewActiveId = computed(() => pickActiveChatRailAnchor(props.anchors, props.viewport));

/** 比例滑块位置（真实滚动比例，替代原生滚动条）。 */
const thumb = computed(() => computeRailThumb(props.viewport));

/** 高亮优先级：悬停项 > 视口中心项。 */
const effectiveActiveId = computed(() => hoverId.value ?? viewActiveId.value);
const activeId = computed(() => effectiveActiveId.value);

function engage() {
  if (disengageRaf) cancelAnimationFrame(disengageRaf);
  engaged.value = true;
}

function keepEngaged() {
  engage();
}

/** 键盘进入：展开后把焦点交给当前项，↑↓ 才能走。 */
function engageFromKeyboard() {
  engage();
  if (hoverId.value == null && viewActiveId.value) hoverId.value = viewActiveId.value;
  void nextTick(() => {
    const id = effectiveActiveId.value;
    if (!id) return;
    const index = props.items.findIndex((item) => item.id === id);
    panelRef.value
      ?.querySelector<HTMLElement>(`[data-rail-index="${index}"]`)
      ?.focus();
  });
}

function disengage() {
  engaged.value = false;
  hoverId.value = null;
}

/**
 * 手柄与浮层之间有一条 10px 的缝，鼠标从手柄移向浮层时会先离开手柄。
 * 不能立刻收：留一帧看是否落进浮层，没落进才收（消除「移不过去」的闪现）。
 */
function scheduleDisengage() {
  if (disengageRaf) cancelAnimationFrame(disengageRaf);
  disengageRaf = requestAnimationFrame(() => {
    disengageRaf = 0;
    const overHandle = handleRef.value?.matches(":hover") ?? false;
    const overPanel = panelRef.value?.matches(":hover") ?? false;
    if (!overHandle && !overPanel) disengage();
  });
}

function jump(messageId: string) {
  hoverId.value = messageId;
  emit("jump", messageId);
}

/**
 * 收起态整列可点：把点击的纵向位置换算成序号，跳到对应那条。
 *
 * 刻度现在等距排列，所以「点击位置 → 0~1 → 序号」是线性映射，
 * 不用再去遍历比较距离；落在上下留白里会夹到首/末条。
 *
 * 点在比例滑块上时走拖拽逻辑（mousedown 已 startScrub），不跳提问。
 */
function onHandleClick(e: MouseEvent) {
  if (dragging || justScrubbed) return;
  if (e.target instanceof Element && e.target.closest(".chat-scroll-rail-thumb")) return;
  const list = props.items;
  if (!list.length) return;
  const rect = handleRef.value?.getBoundingClientRect();
  if (!rect || rect.height <= 0) {
    jump(list[0]?.id ?? "");
    return;
  }
  const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  const span = RAIL_BAND_END - RAIL_BAND_START;
  const fraction =
    span <= 0 ? 0.5 : Math.min(1, Math.max(0, (ratio - RAIL_BAND_START) / span));
  const index = list.length > 1 ? Math.round(fraction * (list.length - 1)) : 0;
  const target = list[Math.min(list.length - 1, Math.max(0, index))];
  if (target?.id) jump(target.id);
}

/** 比例滑块拖拽：把鼠标在轨道上的位置映射成 scrollTop。 */
let dragging = false;
/** 刚拖完滑块的那次 click 不该被当成「点刻度跳转」。 */
let justScrubbed = false;

function startScrub(e: MouseEvent) {
  if (!thumb.value) return;
  dragging = true;
  justScrubbed = true;
  e.preventDefault();
  e.stopPropagation();
  const railRect = handleRef.value?.getBoundingClientRect();
  const thumbRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  // 抓取点相对滑块顶部的偏移，保持拖动手感连续
  const grabOffset = e.clientY - thumbRect.top;
  const apply = (clientY: number) => {
    if (!railRect) return;
    const trackH = railRect.height;
    if (trackH <= 0) return;
    const thumbTopPx = clientY - grabOffset - railRect.top;
    const thumbTop = Math.min(1, Math.max(0, thumbTopPx / trackH));
    emit("scrub", railThumbTopToScrollTop(thumbTop, props.viewport));
  };
  const onMove = (ev: MouseEvent) => apply(ev.clientY);
  const onUp = () => {
    dragging = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    // click 在 mouseup 之后触发，隔一帧再放开抑制
    window.setTimeout(() => {
      justScrubbed = false;
    }, 0);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  apply(e.clientY);
}

/** 导轨把「点某条」当跳转；这里只做最小键盘支持（↑↓ / 回车 / Esc）。 */
function onHandleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
    e.preventDefault();
    engageFromKeyboard();
  }
}

/** 浮层里让当前项滚进可视区（列表长时高亮项可能在折叠外）。
 *  只动浮层自己的列表，绝不用 scrollIntoView —— 那会连带把外层聊天区一起滚走。 */
function scrollActiveRowIntoView() {
  const id = effectiveActiveId.value;
  if (!id) return;
  const list = panelRef.value?.querySelector<HTMLElement>(".chat-scroll-rail-list");
  const row = list?.querySelector<HTMLElement>(`[data-rail-id="${id}"]`);
  if (!list || !row) return;
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  if (rowRect.top < listRect.top) {
    list.scrollTop -= listRect.top - rowRect.top;
  } else if (rowRect.bottom > listRect.bottom) {
    list.scrollTop += rowRect.bottom - listRect.bottom;
  }
}

function onPanelKeydown(e: KeyboardEvent) {
  const list = props.items;
  if (!list.length) return;
  const current = list.findIndex((item) => item.id === effectiveActiveId.value);
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      hoverId.value = list[Math.min(list.length - 1, Math.max(0, current + 1))]?.id ?? null;
      void nextTick(scrollActiveRowIntoView);
      break;
    case "ArrowUp":
      e.preventDefault();
      hoverId.value = list[Math.max(0, (current < 0 ? list.length : current) - 1)]?.id ?? null;
      void nextTick(scrollActiveRowIntoView);
      break;
    case "Enter": {
      const item = current >= 0 ? list[current] : undefined;
      if (item) {
        e.preventDefault();
        jump(item.id);
      }
      break;
    }
    case "Escape":
      e.preventDefault();
      disengage();
      break;
    default:
      break;
  }
}

/** 切会话 / 数据源清空时收起浮层，避免残留一个指向旧会话的目录。 */
watch(
  () => props.items,
  (list) => {
    if (!list.length) disengage();
  },
);

onUnmounted(() => {
  if (disengageRaf) cancelAnimationFrame(disengageRaf);
  disengageRaf = 0;
});
</script>

<style scoped>
/*
 * 导轨本体铺满滚动区，真实刻度/浮层都靠右摆放：
 * 静止时是贴着原生滚动条的一列小横杠 + 一根淡轨道；悬浮 / 聚焦后向左弹出右对齐的消息目录。
 */
.chat-scroll-rail {
  position: absolute;
  inset: 0;
  z-index: 12;
  pointer-events: none;
}

.chat-scroll-rail-handle {
  position: absolute;
  right: 6px;
  top: 6px;
  bottom: 6px;
  width: 14px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}

/* 贴着原生滚动条的一根淡轨道：给刻度一个落点，避免「灰杠飘在正文上」 */
.chat-scroll-rail-track {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 2px;
  width: 1px;
  border-radius: 1px;
  background: rgba(148, 163, 184, 0.14);
  transition: background 0.12s ease;
}

.chat-scroll-rail-handle:hover .chat-scroll-rail-track {
  background: rgba(148, 163, 184, 0.26);
}

.chat-scroll-rail-tick {
  position: absolute;
  right: 2px;
  width: 7px;
  height: 2px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.5);
  transform: translateY(-50%);
  transition: background 0.12s ease, width 0.12s ease;
}

.chat-scroll-rail-handle:hover .chat-scroll-rail-tick {
  background: rgba(148, 163, 184, 0.68);
}

.chat-scroll-rail-tick.active {
  width: 10px;
  background: #3b82f6;
}

/* 比例滑块：替代原生滚动条。细、半透明，悬浮导轨时提亮；可拖。 */
.chat-scroll-rail-thumb {
  position: absolute;
  top: 0;
  right: 1px;
  width: 3px;
  min-height: 18px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.28);
  cursor: pointer;
  transition: background 0.12s ease;
}

.chat-scroll-rail-handle:hover .chat-scroll-rail-thumb {
  background: rgba(148, 163, 184, 0.44);
}

.chat-scroll-rail-thumb:hover {
  background: rgba(203, 213, 225, 0.6);
}

/* 展开时隐藏静止态那列刻度与淡轨道：改由浮层每行右侧的小杠承担，
   避免同一列出现两套刻度（重复）。 */
.chat-scroll-rail--engaged .chat-scroll-rail-tick,
.chat-scroll-rail--engaged .chat-scroll-rail-track {
  opacity: 0;
}

.chat-scroll-rail-panel {
  position: absolute;
  /* 紧贴导轨（right:6px，14px 宽），中间不留缝：鼠标从刻度横跨进浮层不会闪断。
     展开时右侧刻度列隐藏，改由每行小杠承担；右内边距让浮层里的小杠落在同一列。 */
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  width: min(260px, calc(100% - 46px));
  max-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px 7px 8px 0;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 12px;
  background: rgba(20, 21, 24, 0.97);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
  overflow: hidden;
}

.chat-scroll-rail-list {
  margin: 0;
  padding: 0 0 0 8px;
  list-style: none;
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-scroll-rail-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
  min-height: 30px;
  padding: 4px 0 4px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(203, 213, 225, 0.62);
  font-size: 13px;
  line-height: 1.35;
  text-align: right;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.chat-scroll-rail-row:hover,
.chat-scroll-rail-row.hovered {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(226, 232, 240, 0.92);
}

.chat-scroll-rail-row.active {
  color: #4c9aff;
}

.chat-scroll-rail-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 每行右侧的小横杠：落在静止态刻度同一列，当前项变蓝加长。
   行右对齐 + 面板右内边距 7px，小杠中心 ≈ 面板右边缘内 12px。 */
.chat-scroll-rail-bar {
  flex-shrink: 0;
  width: 10px;
  height: 2px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.42);
  transition: background 0.12s ease, width 0.12s ease;
}

.chat-scroll-rail-row.hovered .chat-scroll-rail-bar {
  background: rgba(148, 163, 184, 0.62);
}

.chat-scroll-rail-row.active .chat-scroll-rail-bar {
  width: 13px;
  background: #3b82f6;
}

.chat-scroll-rail-list::-webkit-scrollbar {
  width: 4px;
}

.chat-scroll-rail-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 2px;
}
</style>
