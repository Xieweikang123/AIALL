<template>
  <aside class="file-panel" :style="{ width: filePanelWidth + 'px' }">
    <div class="file-panel-head">
      <div class="file-panel-row file-panel-top-row">
        <div class="file-panel-tabs" role="tablist" aria-label="左侧面板">
          <button
            type="button"
            role="tab"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'files' }"
            :aria-selected="gitPanelMode === 'files'"
            @click="$emit('update:gitPanelMode', 'files')"
          >
            文件
          </button>
          <button
            type="button"
            role="tab"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'git' }"
            :aria-selected="gitPanelMode === 'git'"
            :disabled="!projectOpened"
            @click="$emit('update:gitPanelMode', 'git'); $emit('refresh-git-status')"
          >
            Git
            <span
              v-if="gitChangeCount"
              class="git-badge"
              :class="{ 'git-badge-staged': !gitUnstagedFiles.length }"
              :title="gitUnstagedFiles.length && gitStagedFiles.length
                ? `${gitStagedFiles.length} 已暂存 · ${gitUnstagedFiles.length} 未暂存`
                : gitStagedFiles.length
                  ? `${gitStagedFiles.length} 已暂存`
                  : `${gitUnstagedFiles.length} 未暂存`"
            >{{ gitChangeCount }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'sessions' }"
            :aria-selected="gitPanelMode === 'sessions'"
            @click="$emit('update:gitPanelMode', 'sessions')"
          >
            会话
          </button>
          <button
            type="button"
            role="tab"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'project' }"
            :aria-selected="gitPanelMode === 'project'"
            :disabled="!projectOpened"
            @click="$emit('update:gitPanelMode', 'project')"
          >
            项目
            <span
              v-if="reviewAttentionCount"
              class="git-badge health-badge health-badge--dot"
              :title="`${reviewAttentionCount} 个评审需关注项`"
            >{{ reviewAttentionCount }}</span>
          </button>
        </div>
        <button
          v-if="chatCollapsed && projectOpened"
          type="button"
          class="file-panel-expand-side"
          title="展开 AI 助手"
          aria-label="展开 AI 助手"
          @click="$emit('expand-chat')"
        >
          <svg class="file-panel-expand-side-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
            <path d="M12 12 4 7.5m8 4.5 8-4.5M12 12v9" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
      <div
        v-if="gitPanelMode === 'project' && projectOpened"
        class="file-panel-project-segment"
        role="group"
        aria-label="项目面板"
      >
        <button
          type="button"
          class="file-panel-segment-btn"
          :class="{ active: projectPanelView === 'knowledge' }"
          :aria-pressed="projectPanelView === 'knowledge'"
          @click="$emit('update:projectPanelView', 'knowledge')"
        >
          知识库
        </button>
        <button
          type="button"
          class="file-panel-segment-btn"
          :class="{ active: projectPanelView === 'health' }"
          :aria-pressed="projectPanelView === 'health'"
          @click="$emit('update:projectPanelView', 'health')"
        >
          评审
          <span
            v-if="reviewAttentionCount"
            class="git-badge health-badge"
            :title="`${reviewAttentionCount} 个需关注项`"
          >{{ reviewAttentionCount }}</span>
        </button>
      </div>
      <div v-if="gitPanelMode === 'files'" class="file-panel-row file-panel-search-row">
        <button
          type="button"
          class="quick-search-trigger"
          :disabled="!projectOpened"
          title="搜索文件、代码与会话 (Ctrl+P)"
          @click="$emit('open-quick-search')"
        >
          <span class="quick-search-trigger-label">
            <svg class="quick-search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.2" stroke="currentColor" stroke-width="1.3"/>
              <path d="M10.2 10.2 13.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            <span class="quick-search-text">搜索文件…</span>
          </span>
          <kbd class="quick-search-kbd">Ctrl+P</kbd>
        </button>
        <div v-if="projectOpened" class="file-toolbar">
          <button type="button" class="file-toolbar-btn" title="新建文件" @click="$emit('create-new-file')">
            <svg class="file-toolbar-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
          <button type="button" class="file-toolbar-btn" title="新建文件夹" @click="$emit('create-new-folder')">
            <svg class="file-toolbar-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2.5 4.8A1.3 1.3 0 0 1 3.8 3.5h3.2l1.2 1.3h4.5A1.3 1.3 0 0 1 14 6.1v6.4a1.3 1.3 0 0 1-1.3 1.3H3.8A1.3 1.3 0 0 1 2.5 12.5V4.8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            </svg>
          </button>
          <template v-if="editorCollapsed">
            <span class="toolbar-sep" />
            <button
              type="button"
              class="file-toolbar-btn"
              title="展开编辑器"
              @click="$emit('expand-editor')"
            >
              <svg class="file-toolbar-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" stroke="currentColor" stroke-width="1.2" />
                <path d="M6 3.5V12.5" stroke="currentColor" stroke-width="1.2" />
              </svg>
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="panel-body">
      <div v-if="loadingTree" class="panel-loading-overlay" aria-live="polite">
        <span class="panel-loading-spinner" aria-hidden="true" />
        <span>正在加载项目…</span>
      </div>
      <slot></slot>

      <!-- 会话管理面板 -->
      <div v-if="gitPanelMode === 'sessions'" class="sessions-panel">
        <div class="sessions-header">
          <button
            type="button"
            class="sessions-new-btn"
            title="新会话"
            @click="$emit('start-new-session')"
          >
            <span class="sessions-new-icon" aria-hidden="true">+</span>
            新建会话
          </button>
          <input
            v-if="sessionList.length > 6"
            v-model="sessionSearchQuery"
            class="sessions-search"
            type="search"
            placeholder="搜索会话…"
            aria-label="搜索会话"
          />
        </div>
        <p v-if="chatStoreSyncMessage" class="sessions-sync-hint" role="status" aria-live="polite">
          {{ chatStoreSyncMessage }}
        </p>
        <div v-if="!sessionList.length" class="panel-empty" style="padding: 24px 12px;">
          <span class="panel-empty-icon" aria-hidden="true">💬</span>
          <p class="panel-empty-title">当前项目还没有会话记录</p>
          <p class="panel-empty-hint">开始对话后，会话会显示在这里</p>
        </div>
        <div v-else-if="!filteredGroupedSessions.length" class="sessions-search-empty">
          没有匹配的会话
        </div>
        <ul v-else class="sessions-list">
          <template v-for="group in filteredGroupedSessions" :key="group.label">
            <li class="session-group-header">
              <span class="session-group-label">{{ group.label }}</span>
              <span class="session-group-count">{{ group.items.length }}</span>
            </li>
            <li
              v-for="s in group.items"
              :key="s.id"
              class="session-item"
              :class="{ active: s.id === activeSessionId, 'session-item--syncing': sessionSendingIds.includes(s.id) || s.status === 'active' }"
            >
              <button type="button" class="session-item-main" :title="s.title" @click="$emit('switch-session', s.id)">
                <span class="session-item-title-row">
                  <span class="session-item-status" aria-hidden="true">
                    <span v-if="s.status === 'completed' && !sessionSendingIds.includes(s.id)" class="session-item-completed" title="已完成">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8.5l3.5 3.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </span>
                    <span v-else-if="s.status === 'failed' && !sessionSendingIds.includes(s.id)" class="session-item-failed" title="失败">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                      </svg>
                    </span>
                    <span v-else-if="s.status === 'interrupted' && !sessionSendingIds.includes(s.id)" class="session-item-interrupted" title="已中断">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                        <path d="M7 2v7l4 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/>
                      </svg>
                    </span>
                    <span v-else-if="sessionSendingIds.includes(s.id)" class="session-item-sending" title="运行中"><span class="session-spinner" /></span>
                  </span>
                  <span
                    class="session-item-text"
                    :class="{ 'shimmer-text--fast': sessionSendingIds.includes(s.id) || s.status === 'active' }"
                  >{{ s.title }}</span>
                </span>
                <span class="session-item-meta" :class="{ 'shimmer-text--fast': sessionSendingIds.includes(s.id) || s.status === 'active' }">
                  {{ formatSessionTime(s.updatedAt) }}<template v-if="s.messageCount"> · {{ formatCount(s.messageCount) }} 条</template>
                </span>
              </button>
              <div class="session-item-actions">
                <button
                  type="button"
                  class="session-icon-btn"
                  title="复制会话信息"
                  @click.stop="$emit('copy-session-info', s)"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="5" y="5" width="8" height="9" rx="1.2" stroke="currentColor" stroke-width="1.2"/>
                    <path d="M4 11V3.8A1.8 1.8 0 0 1 5.8 2H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                  </svg>
                </button>
                <button
                  type="button"
                  class="session-icon-btn"
                  title="复制会话名和路径"
                  @click.stop="$emit('copy-session-name-path', s)"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M8.5 1.5h6v6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M14.5 1.5L8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                  </svg>
                </button>
                <button
                  type="button"
                  class="session-icon-btn session-icon-btn--danger"
                  title="删除此会话"
                  @click.stop="$emit('remove-session', s.id)"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.5 4.5h9M6 4.5V3.2a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8V4.5M6.2 7v4.2M9.8 7v4.2M5 4.5l.4 8.2a.8.8 0 0 0 .8.8h3.6a.8.8 0 0 0 .8-.8l.4-8.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
            </li>
          </template>
        </ul>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, withDefaults } from "vue";
import type { GitStatusFile } from "../../services/vibeGitClient";
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";

function formatSessionTime(timestamp: number | string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "刚刚";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}小时前`;
  const days = Math.floor(hour / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  return `${Math.floor(days / 30)}月前`;
}

function formatCount(n: number): string {
  if (n > 99) return "99+";
  return String(n);
}

function getDateGroup(timestamp: number | string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "更早";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  if (date >= startOfToday) return "今天";
  if (date >= startOfYesterday) return "昨天";
  const daysAgo = Math.floor((startOfToday.getTime() - date.getTime()) / 86400000);
  if (daysAgo < 7) return "本周";
  if (daysAgo < 30) return "本月";
  return "更早";
}

interface SessionGroup {
  label: string;
  items: typeof props.sessionList;
}

interface Props {
  filePanelWidth: number;
  gitPanelMode: "files" | "git" | "sessions" | "project";
  projectPanelView: "knowledge" | "health";
  projectOpened: boolean;
  loadingTree?: boolean;
  editorCollapsed: boolean;
  chatCollapsed: boolean;
  gitChangeCount: number;
  gitUnstagedFiles: GitStatusFile[];
  gitStagedFiles: GitStatusFile[];
  reviewAttentionCount?: number;
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  sessionSendingIds?: string[];
  syncingChatStore?: boolean;
  chatStoreSyncMessage?: string;
}

const props = withDefaults(defineProps<Props>(), {
  loadingTree: false,
  reviewAttentionCount: 0,
  sessionSendingIds: () => [],
  syncingChatStore: false,
  chatStoreSyncMessage: "",
});

const emit = defineEmits<{
  (e: "update:gitPanelMode", mode: "files" | "git" | "sessions" | "project"): void;
  (e: "update:projectPanelView", view: "knowledge" | "health"): void;
  (e: "open-quick-search"): void;
  (e: "create-new-file"): void;
  (e: "create-new-folder"): void;
  (e: "expand-editor"): void;
  (e: "expand-chat"): void;
  (e: "refresh-git-status"): void;
  (e: "switch-session", sessionId: string): void;
  (e: "remove-session", sessionId: string): void;
  (e: "start-new-session"): void;
  (e: "copy-session-info", session: VibeChatSessionMeta): void;
  (e: "copy-session-name-path", session: VibeChatSessionMeta): void;
  (e: "sync-chat-store-to-disk"): void;
}>();

const sessionSearchQuery = ref("");

const groupedSessions = computed<SessionGroup[]>(() => {
  const order = ["今天", "昨天", "本周", "本月", "更早"];
  const map = new Map<string, typeof props.sessionList>();
  for (const label of order) map.set(label, []);
  for (const s of props.sessionList) {
    const group = getDateGroup(s.updatedAt);
    map.get(group)?.push(s);
  }
  return order
    .filter((label) => map.get(label)!.length > 0)
    .map((label) => ({
      label,
      items: [...map.get(label)!].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }));
});

const filteredGroupedSessions = computed<SessionGroup[]>(() => {
  const query = sessionSearchQuery.value.trim().toLowerCase();
  if (!query) return groupedSessions.value;
  return groupedSessions.value
    .map((group) => ({
      label: group.label,
      items: group.items.filter((s) => s.title.toLowerCase().includes(query)),
    }))
    .filter((group) => group.items.length > 0);
});
</script>

<style scoped>
.file-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: transparent;
  overflow: hidden;
  container-type: inline-size;
}

.panel-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.file-panel-head {
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.12);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.file-panel-row {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  gap: 8px;
}

.file-panel-top-row {
  padding-bottom: 3px;
  gap: 6px;
}

.file-panel-expand-side {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.file-panel-expand-side:hover {
  background: rgba(31, 111, 235, 0.14);
  border-color: rgba(88, 166, 255, 0.45);
  color: rgba(220, 235, 255, 0.98);
}

.file-panel-expand-side-icon {
  display: block;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.file-panel-tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  flex: 1;
  min-width: 0;
}

.file-panel-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  white-space: nowrap;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}

.file-panel-tab:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.88);
  background: rgba(255, 255, 255, 0.05);
}

.file-panel-tab.active {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.file-panel-tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.git-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  margin-left: 2px;
  vertical-align: middle;
  line-height: 1;
}

.git-badge-staged {
  color: #7ee787;
  background: rgba(63, 185, 80, 0.18);
}

.health-badge {
  color: rgba(255, 200, 120, 0.98);
  background: rgba(210, 120, 40, 0.22);
}

.health-badge--dot {
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  font-size: 9px;
}

.file-panel-project-segment {
  display: flex;
  gap: 4px;
  padding: 0 8px 8px;
}

.file-panel-segment-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(160, 170, 180, 0.95);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.file-panel-segment-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(220, 228, 235, 0.98);
}

.file-panel-segment-btn.active {
  border-color: rgba(88, 166, 255, 0.4);
  background: rgba(88, 166, 255, 0.12);
  color: rgba(200, 225, 255, 0.98);
  font-weight: 600;
}

.file-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.file-toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  cursor: pointer;
  border-radius: 5px;
  flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.file-toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.95);
}

.file-toolbar-btn:active {
  background: rgba(255, 255, 255, 0.12);
}

.file-toolbar-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.file-toolbar-icon {
  display: block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  pointer-events: none;
}

.toolbar-sep {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 1px;
  flex-shrink: 0;
}

.file-panel-search-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 7px;
}

.quick-search-trigger {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 8px;
  min-height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.15);
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.quick-search-trigger:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.08);
  border-color: rgba(88, 166, 255, 0.28);
  color: rgba(255, 255, 255, 0.78);
}

.quick-search-trigger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.quick-search-trigger-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-weight: 500;
}

.quick-search-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-search-icon {
  opacity: 0.65;
  flex-shrink: 0;
}

.quick-search-kbd {
  font-size: 10px;
  font-family: ui-monospace, monospace;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}

@container (max-width: 210px) {
  .quick-search-text,
  .quick-search-kbd {
    display: none;
  }

  .quick-search-trigger {
    justify-content: center;
    padding-inline: 6px;
  }
}

.sessions-sync-hint {
  margin: 0;
  padding: 6px 12px 0;
  font-size: 11px;
  color: #d29922;
}

/* --- Sessions Panel --- */
.sessions-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.sessions-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.sessions-search {
  width: 100%;
  box-sizing: border-box;
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.15);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  outline: none;
}

.sessions-search::placeholder {
  color: rgba(139, 148, 158, 0.6);
}

.sessions-search:focus {
  border-color: rgba(88, 166, 255, 0.3);
}

.sessions-new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.sessions-new-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.96);
}

.sessions-new-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(88, 166, 255, 0.16);
  color: #79c0ff;
  font-size: 14px;
  line-height: 1;
  font-weight: 600;
}

.sessions-search-empty {
  padding: 20px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(139, 148, 158, 0.65);
}

.session-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: #6c8cff;
  background: linear-gradient(135deg, rgba(108, 140, 255, 0.06) 0%, rgba(108, 140, 255, 0.02) 100%);
  border: 1.5px dashed rgba(108, 140, 255, 0.35);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.session-action-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(108, 140, 255, 0.12) 0%, rgba(108, 140, 255, 0.04) 100%);
  opacity: 0;
  transition: opacity 0.25s ease;
  border-radius: 7px;
}

.session-action-btn:hover {
  color: #8ba8ff;
  border-color: rgba(108, 140, 255, 0.55);
  background: linear-gradient(135deg, rgba(108, 140, 255, 0.12) 0%, rgba(108, 140, 255, 0.04) 100%);
  transform: translateY(-1px);
  box-shadow: 0 3px 12px rgba(108, 140, 255, 0.15);
}

.session-action-btn:hover::before {
  opacity: 1;
}

.session-action-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(108, 140, 255, 0.1);
}

.session-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.session-action-btn-glass {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 100%;
  padding: 6px 12px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  border-top-color: rgba(255, 255, 255, 0.08);
  border-bottom-color: rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 1px 2px rgba(0, 0, 0, 0.1);
}

.session-action-btn-glass::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 60%);
  opacity: 1;
  border-radius: 5px;
  pointer-events: none;
}

.session-action-btn-glass:hover {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.08);
  border-top-color: rgba(255, 255, 255, 0.12);
  border-bottom-color: rgba(0, 0, 0, 0.2);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 2px 6px rgba(0, 0, 0, 0.15);
}

.session-action-btn-glass:active {
  background: rgba(255, 255, 255, 0.1);
  border-top-color: rgba(0, 0, 0, 0.1);
  border-bottom-color: rgba(255, 255, 255, 0.06);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.15),
    0 0 2px rgba(0, 0, 0, 0.1);
}

.session-action-btn-glass:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  box-shadow: none;
}

.session-action-icon {
  font-size: 15px;
  line-height: 1;
  font-weight: 600;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(108, 140, 255, 0.15);
  border-radius: 50%;
  color: #6c8cff;
  transition: background 0.2s ease;
}

.session-action-btn-glass:hover .session-action-icon {
  color: #6c8cff;
  background: rgba(108, 140, 255, 0.15);
}

.session-action-label {
  line-height: 1;
  letter-spacing: 0.3px;
}

.sessions-list {
  list-style: none;
  margin: 0;
  padding: 6px 8px 10px;
  overflow-y: auto;
  flex: 1;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
}

.sessions-list::-webkit-scrollbar {
  width: 5px;
}

.sessions-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

.session-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 6px 6px;
  list-style: none;
}

.session-group-header:first-child {
  padding-top: 2px;
}

.session-group-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(139, 148, 158, 0.55);
  letter-spacing: 0.02em;
}

.session-group-count {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.4);
}

.session-item {
  display: flex;
  align-items: stretch;
  gap: 2px;
  border-radius: 8px;
  position: relative;
  transition: background 0.15s ease;
}

.session-item + .session-item {
  margin-top: 2px;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.session-item.active {
  background: rgba(88, 166, 255, 0.1);
}

.session-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: #58a6ff;
}

.session-item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 8px 10px 8px 12px;
  border: none;
  background: none;
  color: var(--text-primary, #e6edf3);
  cursor: pointer;
  text-align: left;
  min-width: 0;
  border-radius: 8px;
  position: relative;
  z-index: 1;
}

.session-item-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.session-item-status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 18px;
  flex-shrink: 0;
}

.session-item-text {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.92);
}

.session-item-meta {
  padding-left: 24px;
  font-size: 11px;
  line-height: 1.3;
  color: rgba(139, 148, 158, 0.55);
}

.session-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.session-item-sending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.session-item--syncing .session-item-text {
  color: rgba(201, 224, 255, 0.95);
}

.session-item--syncing:not(.active) {
  background: rgba(88, 166, 255, 0.06);
}

.session-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(88, 166, 255, 0.2);
  border-top-color: #58a6ff;
  border-radius: 50%;
  animation: session-spin 0.75s linear infinite;
}

@keyframes session-spin {
  to { transform: rotate(360deg); }
}

.session-item-completed {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(63, 185, 80, 0.15);
  color: #3fb950;
  font-size: 8px;
  font-weight: 700;
  flex-shrink: 0;
}

.session-item-failed {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(248, 81, 73, 0.15);
  color: #f85149;
  font-size: 8px;
  font-weight: 700;
  flex-shrink: 0;
}

.session-item-interrupted {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(210, 153, 34, 0.15);
  color: #d29922;
  font-size: 8px;
  font-weight: 700;
  flex-shrink: 0;
}

.session-item:hover .session-item-actions {
  opacity: 1;
}

.session-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: rgba(139, 148, 158, 0.65);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.session-icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.92);
}

.session-icon-btn--danger:hover {
  background: rgba(248, 81, 73, 0.15);
  color: #ff9a9a;
}
</style>
