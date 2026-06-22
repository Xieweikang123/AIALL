<template>
  <aside class="file-panel" :style="{ width: filePanelWidth + 'px' }">
    <div class="file-panel-head">
      <div class="file-panel-row file-panel-top-row">
        <div class="file-panel-tabs" role="group">
          <button
            type="button"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'files' }"
            @click="$emit('update:gitPanelMode', 'files')"
          >
            文件
          </button>
          <button
            type="button"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'git' }"
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
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'sessions' }"
            @click="$emit('update:gitPanelMode', 'sessions')"
          >
            会话
            <span v-if="sessionCount" class="git-badge shimmer-text--fast">{{ sessionCount }}</span>
          </button>
        </div>
        <div v-if="projectOpened && gitPanelMode === 'files'" class="file-toolbar">
          <button type="button" class="icon-btn" title="新建文件" @click="$emit('create-new-file')">+</button>
          <button type="button" class="icon-btn" title="新建文件夹" @click="$emit('create-new-folder')">📁</button>
          <span v-if="editorCollapsed" class="toolbar-sep" />
          <button
            v-if="editorCollapsed"
            type="button"
            class="icon-btn"
            title="展开编辑器"
            @click="$emit('expand-editor')"
          >
            ◧
          </button>
        </div>
      </div>
      <div v-if="gitPanelMode === 'files'" class="file-panel-row file-panel-search-row">
        <div class="search-mode-switch" role="group" aria-label="搜索模式">
          <button
            type="button"
            class="search-mode-btn"
            :class="{ active: searchMode === 'file' }"
            :disabled="!projectOpened"
            @click="$emit('update:searchMode', 'file')"
          >
            文件
          </button>
          <button
            type="button"
            class="search-mode-btn"
            :class="{ active: searchMode === 'content' }"
            :disabled="!projectOpened"
            @click="$emit('update:searchMode', 'content')"
          >
            内容
          </button>
        </div>
        <div class="search-input-wrap">
          <input
            ref="searchInputRef"
            :value="searchQuery"
            class="search-input"
            :class="{ searching: searchLoading }"
            type="text"
            :placeholder="searchMode === 'file' ? '搜索文件名…' : '搜索代码内容…'"
            :disabled="!projectOpened || searchLoading"
            @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
            @keydown.enter="$emit('handle-search')"
          />
          <span v-if="searchLoading" class="search-spinner" aria-hidden="true" />
          <button
            v-else-if="searchQuery"
            type="button"
            class="search-clear-btn"
            title="清除搜索"
            @click="$emit('update:searchQuery', '')"
          >×</button>
        </div>
        <p v-if="searchError" class="search-error" role="alert">{{ searchError }}</p>
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
        <div class="sessions-toolbar">
          <button
            type="button"
            class="session-action-btn"
            title="新会话"
            @click="$emit('start-new-session')"
          >
            <span class="session-action-icon">+</span>
            <span class="session-action-label">新建</span>
          </button>

        </div>
        <div v-if="!sessionList.length" class="panel-empty" style="padding: 24px 12px;">
          <span class="panel-empty-icon" aria-hidden="true">💬</span>
          <p class="panel-empty-title">当前项目还没有会话记录</p>
          <p class="panel-empty-hint">开始对话后，会话会显示在这里</p>
        </div>
        <ul v-else class="sessions-list">
          <template v-for="group in groupedSessions" :key="group.label">
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
                <span class="session-item-title">
                  <span v-if="s.status === 'completed' && !sessionSendingIds.includes(s.id)" class="session-item-completed" title="已完成">✓</span>
                  <span v-else-if="s.status === 'failed' && !sessionSendingIds.includes(s.id)" class="session-item-failed" title="失败">✗</span>
                  <span v-else-if="s.status === 'interrupted' && !sessionSendingIds.includes(s.id)" class="session-item-interrupted" title="已中断">⚠</span>
                  <span v-else-if="sessionSendingIds.includes(s.id)" class="session-item-sending" title="运行中"><span class="session-spinner" /></span>
                  <span :class="{ 'shimmer-text--fast': sessionSendingIds.includes(s.id) || s.status === 'active' }">{{ s.title }}</span>
                </span>
                <span class="session-item-meta" :class="{ 'shimmer-text--fast': sessionSendingIds.includes(s.id) || s.status === 'active' }">
                  {{ formatSessionTime(s.updatedAt) }}
                  <span class="session-item-count" v-if="s.messageCount">{{ formatCount(s.messageCount) }} 条</span>
                </span>
              </button>
              <div class="session-item-actions">
                <button
                  type="button"
                  class="icon-btn small"
                  title="复制会话信息"
                  @click.stop="$emit('copy-session-info', s)"
                >📋</button>
                <button
                  type="button"
                  class="icon-btn small"
                  title="删除此会话"
                  @click.stop="$emit('remove-session', s.id)"
                >🗑</button>
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
  gitPanelMode: "files" | "git" | "sessions";
  projectOpened: boolean;
  loadingTree?: boolean;
  searchMode: "file" | "content";
  searchQuery: string;
  searchLoading?: boolean;
  searchError?: string;
  editorCollapsed: boolean;
  gitChangeCount: number;
  gitUnstagedFiles: GitStatusFile[];
  gitStagedFiles: GitStatusFile[];
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  activeSessionTitle: string;
  sessionPickerOpen: boolean;
  sessionPickerTitle: string;
  chatSending: boolean;
  sessionSendingIds?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  loadingTree: false,
  searchLoading: false,
  searchError: "",
  sessionSendingIds: () => [],
});

const emit = defineEmits<{
  (e: "update:gitPanelMode", mode: "files" | "git" | "sessions"): void;
  (e: "update:searchQuery", value: string): void;
  (e: "update:searchMode", mode: "file" | "content"): void;
  (e: "handle-search"): void;
  (e: "create-new-file"): void;
  (e: "create-new-folder"): void;
  (e: "expand-editor"): void;
  (e: "refresh-git-status"): void;
  (e: "switch-session", sessionId: string): void;
  (e: "remove-session", sessionId: string): void;
  (e: "start-new-session"): void;
  (e: "copy-session-info", session: VibeChatSessionMeta): void;
}>();

const sessionCount = computed(() => props.sessionList.length);

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
    .map((label) => ({ label, items: map.get(label)! }));
});

const searchInputRef = ref<HTMLInputElement | null>(null);

defineExpose({ searchInputRef });
</script>

<style scoped>
.file-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: transparent;
  overflow: hidden;
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
  border-bottom: 1px solid var(--border-color, #333);
}

.file-panel-row {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  gap: 6px;
}

.file-panel-top-row {
  justify-content: space-between;
}

.file-panel-tabs {
  display: flex;
  gap: 8px;
}

.file-panel-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  font-size: 13px;
  white-space: nowrap;
  border: none;
  background: none;
  color: var(--text-secondary, #999);
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}

.file-panel-tab:hover {
  background: var(--bg-tertiary, #333);
  color: var(--text-primary, #fff);
}

.file-panel-tab.active {
  background: var(--bg-tertiary, #333);
  color: var(--text-primary, #fff);
  font-weight: 500;
}

.file-panel-tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.git-badge {
  display: inline;
  font-size: 10px;
  font-weight: 400;
  color: var(--text-tertiary, #555);
  background: none;
  border: none;
  padding: 0;
  margin-left: 2px;
  vertical-align: baseline;
  line-height: 1;
  letter-spacing: 0;
  opacity: 0.7;
}

.git-badge-staged {
  color: var(--success-color, #3fb950);
  opacity: 1;
}

.file-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1.5px solid rgba(255, 255, 255, 0.15);
  background: rgba(99, 102, 241, 0.15);
  color: var(--text-secondary, #999);
  cursor: pointer;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 600;
  transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.1s;
}

.icon-btn:hover {
  background: rgba(99, 102, 241, 0.35);
  color: #fff;
  border-color: rgba(99, 102, 241, 0.6);
  transform: scale(1.08);
}

.icon-btn:active {
  transform: scale(0.95);
}

.icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
}

.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--border-color, #333);
  margin: 0 4px;
}

.file-panel-search-row {
  padding: 6px 8px;
  border-top: 1px solid var(--border-color, #333);
  flex-direction: column;
  align-items: stretch;
}

.search-mode-switch {
  display: flex;
  gap: 2px;
  margin-bottom: 6px;
  padding: 2px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}

.search-mode-btn {
  flex: 0 0 auto;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s ease, color 0.15s ease;
}

.search-mode-btn:hover:not(:disabled) {
  color: rgba(255, 255, 255, 0.85);
}

.search-mode-btn.active {
  background: rgba(88, 166, 255, 0.2);
  color: #58a6ff;
}

.search-mode-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.search-input-wrap {
  position: relative;
  width: 100%;
}

.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  padding-right: 28px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--text-primary, #fff);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.search-input:focus {
  outline: none;
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(0, 0, 0, 0.28);
}

.search-input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.search-clear-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--text-secondary, #999);
  font-size: 14px;
  cursor: pointer;
  border-radius: 3px;
}

.search-clear-btn:hover {
  background: var(--bg-tertiary, #333);
  color: var(--text-primary, #fff);
}

.search-spinner {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: var(--accent-color, #58a6ff);
  border-radius: 50%;
  animation: file-search-spin 0.7s linear infinite;
}

@keyframes file-search-spin {
  to { transform: translateY(-50%) rotate(360deg); }
}

.search-error {
  margin: 4px 0 0;
  padding: 0 2px;
  font-size: 11px;
  color: #f85149;
  line-height: 1.4;
}

/* --- Sessions Panel --- */
.sessions-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.sessions-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color, #333);
  flex-shrink: 0;
}

.session-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.session-action-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
}

.session-action-btn:active {
  background: rgba(255, 255, 255, 0.18);
}



.session-action-icon {
  font-size: 13px;
  line-height: 1;
}

.session-action-label {
  line-height: 1;
}

.sessions-list {
  list-style: none;
  margin: 0;
  padding: 4px 4px;
  overflow-y: auto;
  flex: 1;
}

.session-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px 8px 6px;
  list-style: none;
}

.session-group-header:first-child {
  padding-top: 4px;
}

.session-group-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(139, 148, 158, 0.5);
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.session-group-count {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.35);
  background: none;
  padding: 0;
  border-radius: 0;
  line-height: 1;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 8px;
  position: relative;
  transition: background 0.15s ease;
}

.session-item + .session-item {
  margin-top: 1px;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.session-item.active {
  background: rgba(88, 166, 255, 0.12);
  box-shadow: inset 0 0 0 1px rgba(88, 166, 255, 0.12);
}

.session-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 55%;
  min-height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--accent-color, #58a6ff);
  box-shadow: 0 0 6px rgba(88, 166, 255, 0.4);
}



.session-item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 10px 12px;
  border: none;
  background: none;
  color: var(--text-primary, #e6edf3);
  cursor: pointer;
  text-align: left;
  min-width: 0;
  transition: background 0.15s;
  border-radius: 6px;
  position: relative;
  z-index: 1;
}

.session-item-main:hover {
  background: transparent;
}

.session-item-title {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  color: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-item-sending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
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
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(63, 185, 80, 0.15);
  color: #3fb950;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}

.session-item-failed {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(248, 81, 73, 0.15);
  color: #f85149;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}

.session-item-interrupted {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(210, 153, 34, 0.15);
  color: #d29922;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}

.session-item-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 1.3;
  color: rgba(139, 148, 158, 0.55);
}

.session-item-count {
  display: inline;
  padding: 0;
  border-radius: 0;
  background: none;
  color: rgba(139, 148, 158, 0.45);
  font-size: 11px;
  font-weight: 400;
  line-height: inherit;
}

.session-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 6px;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.session-item:hover .session-item-actions {
  opacity: 1;
}

.icon-btn.small {
  width: 24px;
  height: 24px;
  font-size: 12px;
  border-radius: 5px;
  transition: background 0.12s, color 0.12s;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(139, 148, 158, 0.6);
}

.icon-btn.small:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}
</style>
