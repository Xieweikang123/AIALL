<template>
  <div class="session-tabs-bar" :class="{ 'session-tabs-bar--empty': !sessionList.length }">
    <div class="session-tabs-scroll">
      <button
        v-for="s in sessionList"
        :key="s.id"
        type="button"
        class="session-tab"
        :class="{
          active: s.id === activeSessionId,
          'session-tab--syncing': sessionSendingIds.includes(s.id),
        }"
        :title="sessionTabTitle(s)"
        @click="$emit('switch-session', s.id)"
      >
        <span class="session-tab-status" aria-hidden="true">
          <span
            v-if="s.status === 'completed' && !sessionSendingIds.includes(s.id)"
            class="status-dot status-dot--completed"
            title="已完成"
          />
          <span
            v-else-if="s.status === 'failed' && !sessionSendingIds.includes(s.id)"
            class="status-dot status-dot--failed"
            title="失败"
          />
          <span
            v-else-if="s.status === 'interrupted' && !sessionSendingIds.includes(s.id)"
            class="status-dot status-dot--interrupted"
            title="已中断"
          />
          <span
            v-else-if="sessionSendingIds.includes(s.id)"
            class="status-dot status-dot--running"
            title="运行中"
          ><span class="session-spinner" /></span>
          <span v-else class="status-dot" />
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
  </div>
</template>

<script setup lang="ts">
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";

const props = withDefaults(defineProps<{
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  sessionSendingIds?: string[];
}>(), {
  sessionSendingIds: () => [],
});

defineEmits<{
  (e: "switch-session", sessionId: string): void;
  (e: "start-new-session"): void;
  (e: "remove-session", sessionId: string): void;
}>();

function sessionTabTitle(s: VibeChatSessionMeta): string {
  const base = s.title || "新会话";
  return s.messageCount ? `${base} · ${s.messageCount} 条消息` : base;
}
</script>

<style scoped>
.session-tabs-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-height: 34px;
  padding: 4px 10px;
  background: rgba(13, 17, 23, 0.98);
  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
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
  max-width: 220px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(201, 209, 217, 0.8);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.session-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.92);
}

.session-tab.active {
  background: rgba(88, 166, 255, 0.12);
  border-color: rgba(88, 166, 255, 0.25);
  color: rgba(200, 225, 255, 0.98);
}

.session-tab--syncing {
  background: rgba(88, 166, 255, 0.1);
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
  font-size: 12.5px;
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
  /* 全局 button 规则（vibe-coding.scss）带 padding: 8px 16px，会把 26px 定宽按钮的内容区挤成 0，图标消失 */
  padding: 0;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  background: rgba(88, 166, 255, 0.1);
  color: #79c0ff;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.session-tabs-new svg {
  display: block;
  color: inherit;
}

.session-tabs-new:hover {
  background: rgba(88, 166, 255, 0.2);
  color: #a5d0ff;
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
