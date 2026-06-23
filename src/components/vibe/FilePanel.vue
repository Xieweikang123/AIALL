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
        <button
          type="button"
          class="quick-search-trigger"
          :disabled="!projectOpened"
          title="搜索文件、代码与会话 (Ctrl+P)"
          @click="$emit('open-quick-search')"
        >
          <span class="quick-search-trigger-label">⌕ 快速搜索</span>
          <kbd class="quick-search-kbd">Ctrl+P</kbd>
        </button>
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
            class="session-action-btn-glass"
            title="新会话"
            @click="$emit('start-new-session')"
          >
            <span class="session-action-icon">+</span>
            <span class="session-action-label">新建</span>
          </button>

        </div>
        <p v-if="chatStoreSyncMessage" class="sessions-sync-hint" role="status" aria-live="polite">
          {{ chatStoreSyncMessage }}
        </p>
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
                  <span
                    class="session-item-text"
                    :class="{ 'shimmer-text--fast': sessionSendingIds.includes(s.id) || s.status === 'active' }"
                  >{{ s.title }}</span>
                </span>
                <span class="session-item-meta" :class="{ 'shimmer-text--fast': sessionSendingIds.includes(s.id) || s.status === 'active' }">
                  {{ formatSessionTime(s.updatedAt) }}
                  <span class="session-item-count" v-if="s.messageCount">{{ formatCount(s.messageCount) }} 条</span>
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
  gitPanelMode: "files" | "git" | "sessions";
  projectOpened: boolean;
  loadingTree?: boolean;
  editorCollapsed: boolean;
  gitChangeCount: number;
  gitUnstagedFiles: GitStatusFile[];
  gitStagedFiles: GitStatusFile[];
  sessionList: VibeChatSessionMeta[];
  activeSessionId: string;
  sessionSendingIds?: string[];
  syncingChatStore?: boolean;
  chatStoreSyncMessage?: string;
}

const props = withDefaults(defineProps<Props>(), {
  loadingTree: false,
  sessionSendingIds: () => [],
  syncingChatStore: false,
  chatStoreSyncMessage: "",
});

const emit = defineEmits<{
  (e: "update:gitPanelMode", mode: "files" | "git" | "sessions"): void;
  (e: "open-quick-search"): void;
  (e: "create-new-file"): void;
  (e: "create-new-folder"): void;
  (e: "expand-editor"): void;
  (e: "refresh-git-status"): void;
  (e: "switch-session", sessionId: string): void;
  (e: "remove-session", sessionId: string): void;
  (e: "start-new-session"): void;
  (e: "copy-session-info", session: VibeChatSessionMeta): void;
  (e: "sync-chat-store-to-disk"): void;
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
  gap: 2px;
  padding: 3px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 9px;
}

.file-panel-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  font-size: 12px;
  white-space: nowrap;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.52);
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
}

.quick-search-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.quick-search-trigger:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.1);
  border-color: rgba(88, 166, 255, 0.35);
}

.quick-search-trigger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.quick-search-trigger-label {
  font-weight: 500;
}

.quick-search-kbd {
  font-size: 10px;
  font-family: ui-monospace, monospace;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(139, 148, 158, 0.9);
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

.sessions-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color, #333);
  flex-shrink: 0;
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
  max-width: 100%;
  color: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
}

.session-item-text {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.session-item-sending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.session-item--syncing .session-item-title {
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

.session-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
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
