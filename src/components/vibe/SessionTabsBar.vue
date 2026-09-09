<template>
  <div class="session-tabs-bar">
    <div class="session-tabs-scroll">
      <button
        v-for="(s, index) in sessionList"
        :key="s.id"
        :ref="(el) => setTabRef(s.id, el as HTMLElement | null)"
        type="button"
        class="session-tab"
        :class="{
          active: s.id === activeSessionId,
          'session-tab--syncing': sessionSendingIds.includes(s.id),
          'session-tab--dragging': tabDragState.active && tabDragState.fromIndex === index,
          'session-tab--drop-before': tabDragState.dropIndex === index && tabDragState.dropSide === 'before',
          'session-tab--drop-after': tabDragState.dropIndex === index && tabDragState.dropSide === 'after',
        }"
        :title="sessionTabTitle(s)"
        @click="$emit('switch-session', s.id)"
        @pointerdown="onTabPointerDown($event, index)"
      >
        <span v-if="tabStatus(s)" class="session-tab-status" aria-hidden="true">
          <span
            v-if="tabStatus(s) === 'running'"
            class="status-dot status-dot--running"
            :title="STATUS_TITLES.running"
          ><span class="session-spinner" /></span>
          <span
            v-else
            class="status-dot"
            :class="`status-dot--${tabStatus(s)}`"
            :title="STATUS_TITLES[tabStatus(s)!]"
          />
        </span>
        <span
          class="session-tab-title"
          :class="{ 'shimmer-text--fast': sessionSendingIds.includes(s.id) }"
        >{{ s.title || "新会话" }}</span>
        <span
          v-if="s.id === activeSessionId"
          class="session-tab-close"
          role="button"
          tabindex="0"
          title="关闭会话"
          aria-label="关闭会话"
          @click.stop="$emit('remove-session', s.id)"
          @keydown.enter.stop.prevent="$emit('remove-session', s.id)"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </span>
      </button>
      <button
        type="button"
        class="session-tabs-new"
        title="新建会话 (Ctrl+Shift+N)"
        aria-label="新建会话"
        @click="$emit('start-new-session')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <Teleport to="body">
      <div v-if="tabDragGhost" class="session-tab-drag-ghost" :style="{ left: tabDragGhost.x + 'px', top: tabDragGhost.y + 'px' }">
        <span class="session-tab-drag-ghost-name">{{ tabDragGhost.name }}</span>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";

const props = withDefaults(defineProps<{
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  sessionSendingIds?: string[];
}>(), {
  sessionSendingIds: () => [],
});

const emit = defineEmits<{
  (e: "switch-session", sessionId: string): void;
  (e: "start-new-session"): void;
  (e: "remove-session", sessionId: string): void;
  (e: "reorder-sessions", fromIndex: number, toIndex: number): void;
}>();

type TabStatus = "running" | "completed" | "failed" | "interrupted";

const STATUS_TITLES: Record<TabStatus, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
};

function tabStatus(s: VibeChatSessionMeta): TabStatus | null {
  if (props.sessionSendingIds.includes(s.id)) return "running";
  if (s.status === "completed" || s.status === "failed" || s.status === "interrupted") {
    return s.status;
  }
  return null;
}

function sessionTabTitle(s: VibeChatSessionMeta): string {
  const base = s.title || "新会话";
  return s.messageCount ? `${base} · ${s.messageCount} 条消息` : base;
}

/* ---- 会话标签拖拽排序（Pointer 实现，兼容 WebView2） ---- */
const DRAG_THRESHOLD_PX = 5;

const tabElMap = new Map<string, HTMLElement>();
function setTabRef(id: string, el: HTMLElement | null) {
  if (el) tabElMap.set(id, el);
  else tabElMap.delete(id);
}

const tabDragState = ref<{
  pointerId: number | null;
  fromIndex: number;
  startX: number;
  startY: number;
  active: boolean;
  dropIndex: number;
  dropSide: "before" | "after" | null;
}>({ pointerId: null, fromIndex: -1, startX: 0, startY: 0, active: false, dropIndex: -1, dropSide: null });

const tabDragGhost = ref<{ x: number; y: number; name: string } | null>(null);
let suppressTabClick = false;

function onTabPointerDown(e: PointerEvent, index: number) {
  if (e.button !== 0) return;
  if (index < 0 || index >= props.sessionList.length) return;
  if ((e.target as HTMLElement).closest(".session-tab-close")) return;

  tabDragState.value = {
    pointerId: e.pointerId,
    fromIndex: index,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    dropIndex: -1,
    dropSide: null,
  };
  window.addEventListener("pointermove", onTabWindowPointerMove);
  window.addEventListener("pointerup", onTabWindowPointerUp);
  window.addEventListener("pointercancel", onTabWindowPointerCancel);
  window.addEventListener("blur", onTabWindowBlur);
}

function onTabWindowPointerMove(e: PointerEvent) {
  const s = tabDragState.value;
  if (s.pointerId !== e.pointerId) return;

  if (!s.active) {
    if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_THRESHOLD_PX) return;
    s.active = true;
    const tab = props.sessionList[s.fromIndex];
    if (tab) {
      tabDragGhost.value = { x: e.clientX + 12, y: e.clientY + 12, name: tab.title || "新会话" };
    }
    document.body.classList.add("tab-dragging-active");
  }

  if (tabDragGhost.value) {
    tabDragGhost.value = { ...tabDragGhost.value, x: e.clientX + 12, y: e.clientY + 12 };
  }
  updateTabDropTarget(e.clientX);
}

function onTabWindowPointerUp(e: PointerEvent) {
  const s = tabDragState.value;
  if (s.pointerId !== e.pointerId) return;
  if (s.active) {
    if (s.dropIndex >= 0 && s.dropSide) {
      const fromIndex = s.fromIndex;
      const toIndex = s.dropSide === "after" ? s.dropIndex + 1 : s.dropIndex;
      emit("reorder-sessions", fromIndex, toIndex);
    }
    suppressTabClick = true;
    setTimeout(() => {
      suppressTabClick = false;
    }, 0);
  }
  clearTabDrag();
}

function onTabWindowPointerCancel(e: PointerEvent) {
  if (tabDragState.value.pointerId !== e.pointerId) return;
  clearTabDrag();
}

function onTabWindowBlur() {
  if (tabDragState.value.pointerId === null) return;
  clearTabDrag();
}

function clearTabDrag() {
  window.removeEventListener("pointermove", onTabWindowPointerMove);
  window.removeEventListener("pointerup", onTabWindowPointerUp);
  window.removeEventListener("pointercancel", onTabWindowPointerCancel);
  window.removeEventListener("blur", onTabWindowBlur);
  tabDragState.value = {
    pointerId: null,
    fromIndex: -1,
    startX: 0,
    startY: 0,
    active: false,
    dropIndex: -1,
    dropSide: null,
  };
  tabDragGhost.value = null;
  document.body.classList.remove("tab-dragging-active");
}

function updateTabDropTarget(clientX: number) {
  const s = tabDragState.value;
  let target: { index: number; side: "before" | "after" } | null = null;

  for (let i = 0; i < props.sessionList.length; i++) {
    const el = tabElMap.get(props.sessionList[i].id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right) {
      target = { index: i, side: clientX < rect.left + rect.width / 2 ? "before" : "after" };
      break;
    }
  }
  if (!target && props.sessionList.length) {
    const lastEl = tabElMap.get(props.sessionList[props.sessionList.length - 1].id);
    if (lastEl) {
      const rect = lastEl.getBoundingClientRect();
      if (clientX > rect.right) target = { index: props.sessionList.length - 1, side: "after" };
      else if (clientX < rect.left) target = { index: 0, side: "before" };
    }
  }

  s.dropIndex = target?.index ?? -1;
  s.dropSide = target?.side ?? null;
}
</script>

<style scoped>
/* 内嵌在顶部工具栏行内（AppToolbar 的 session-tabs 插槽），不占独立高度 */
.session-tabs-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.session-tabs-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.session-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  max-width: 200px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(201, 209, 217, 0.72);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.session-tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
}

.session-tab.active {
  background: rgba(88, 166, 255, 0.16);
  border-color: rgba(88, 166, 255, 0.3);
  color: rgba(200, 225, 255, 0.98);
}

.session-tab--syncing {
  background: rgba(88, 166, 255, 0.1);
}

.session-tab--dragging {
  opacity: 0.4;
}

.session-tab--drop-before {
  box-shadow: -2px 0 0 0 #58a6ff;
}

.session-tab--drop-after {
  box-shadow: 2px 0 0 0 #58a6ff;
}

.session-tab-drag-ghost {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  padding: 4px 10px;
  border: 1px solid rgba(88, 166, 255, 0.4);
  border-radius: 8px;
  background: rgba(30, 30, 34, 0.95);
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.session-tab-drag-ghost-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-tab-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.session-tab-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
}

.session-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: rgba(139, 148, 158, 0.6);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}

.session-tab:hover .session-tab-close,
.session-tab.active .session-tab-close,
.session-tab-close:focus-visible {
  opacity: 1;
}

.session-tab-close:hover {
  background: rgba(248, 81, 73, 0.16);
  color: #f85149;
}

.session-tabs-new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* 全局 button 规则（vibe-coding.scss）带 padding: 8px 16px，会把 28px 定宽按钮的内容区挤成 0，图标消失 */
  padding: 0;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.session-tabs-new svg {
  display: block;
  color: inherit;
}

.session-tabs-new:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.9);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(139, 148, 158, 0.25);
  flex-shrink: 0;
}

.status-dot--completed {
  background: rgba(63, 185, 80, 0.7);
}

.status-dot--failed {
  background: rgba(248, 81, 73, 0.7);
}

.status-dot--interrupted {
  background: rgba(210, 153, 34, 0.7);
}

.status-dot--running {
  width: 14px;
  height: 14px;
  background: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.session-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(88, 166, 255, 0.2);
  border-top-color: #58a6ff;
  border-radius: 50%;
  animation: session-spin 0.75s linear infinite;
}

@keyframes session-spin {
  to { transform: rotate(360deg); }
}
</style>
