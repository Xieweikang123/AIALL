<template>
  <aside
    class="file-panel"
    :class="{ 'file-panel--collapsed': filePanelCollapsed }"
    :style="{ width: (filePanelCollapsed ? 48 : filePanelWidth) + 'px' }"
  >
    <!-- Collapsed sidebar: vertical tab icons -->
    <div v-if="filePanelCollapsed" class="file-panel-collapsed">
      <button
        type="button"
        class="file-panel-collapsed-tab"
        :class="{ active: gitPanelMode === 'files' }"
        title="文件"
        @click="$emit('update:gitPanelMode', 'files'); $emit('expand-file-panel')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 7V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        type="button"
        class="file-panel-collapsed-tab"
        :class="{ active: gitPanelMode === 'git' }"
        title="Git"
        :disabled="!projectOpened"
        @click="$emit('update:gitPanelMode', 'git'); $emit('expand-file-panel'); $emit('refresh-git-status')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="6" r="2.5" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="18" cy="18" r="2.5" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="6" cy="14" r="2.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M12 8.5v3.5M9.2 13.2 15.5 16.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span v-if="gitChangeCount" class="file-panel-collapsed-badge">{{ gitChangeCount }}</span>
      </button>
      <button
        type="button"
        class="file-panel-collapsed-tab"
        :class="{ active: gitPanelMode === 'sessions' }"
        title="会话"
        @click="$emit('update:gitPanelMode', 'sessions'); $emit('expand-file-panel')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        type="button"
        class="file-panel-collapsed-tab"
        :class="{ active: gitPanelMode === 'project' }"
        title="项目"
        :disabled="!projectOpened"
        @click="$emit('update:gitPanelMode', 'project'); $emit('expand-file-panel')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M12 12 4 7.5m8 4.5 8-4.5M12 12v9" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <span v-if="reviewAttentionCount" class="file-panel-collapsed-badge file-panel-collapsed-badge--warn">{{ reviewAttentionCount }}</span>
      </button>
      <div class="file-panel-collapsed-spacer" />
      <button
        type="button"
        class="file-panel-collapsed-tab file-panel-collapsed-expand"
        title="展开面板"
        @click="$emit('expand-file-panel')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <!-- Expanded panel -->
    <template v-else>
    <div class="file-panel-head">
      <div class="file-panel-row file-panel-top-row">
        <div
          class="file-panel-tabs"
          :class="{ 'file-panel-tabs--icons': narrowTabs }"
          role="tablist"
          aria-label="左侧面板"
        >
          <button
            type="button"
            role="tab"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'files' }"
            :aria-selected="gitPanelMode === 'files'"
            :title="narrowTabs ? '文件' : undefined"
            @click="$emit('update:gitPanelMode', 'files')"
          >
            <svg v-if="narrowTabs" class="file-panel-tab-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3 7V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
            <span v-else>文件</span>
          </button>
          <button
            type="button"
            role="tab"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'git' }"
            :aria-selected="gitPanelMode === 'git'"
            :disabled="!projectOpened"
            :title="narrowTabs ? gitTabTitle : undefined"
            @click="$emit('update:gitPanelMode', 'git'); $emit('refresh-git-status')"
          >
            <svg v-if="narrowTabs" class="file-panel-tab-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="6" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="18" cy="18" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="6" cy="14" r="2.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M12 8.5v3.5M9.2 13.2 15.5 16.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span v-else>Git</span>
            <span
              v-if="gitChangeCount"
              class="git-badge"
              :class="{ 'git-badge-staged': !gitUnstagedFiles.length }"
              :title="gitTabTitle"
            >{{ gitChangeCount }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'sessions' }"
            :aria-selected="gitPanelMode === 'sessions'"
            :title="narrowTabs ? '会话' : undefined"
            @click="$emit('update:gitPanelMode', 'sessions')"
          >
            <svg v-if="narrowTabs" class="file-panel-tab-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span v-else>会话</span>
          </button>
          <button
            type="button"
            role="tab"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'project' }"
            :aria-selected="gitPanelMode === 'project'"
            :disabled="!projectOpened"
            :title="narrowTabs ? '项目：知识库 / 架构评审 / 架构图 / 测试修复' : undefined"
            @click="$emit('update:gitPanelMode', 'project')"
          >
            <svg v-if="narrowTabs" class="file-panel-tab-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M12 12 4 7.5m8 4.5 8-4.5M12 12v9" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
            <span v-else>项目</span>
            <span
              v-if="reviewAttentionCount"
              class="git-badge health-badge health-badge--dot"
              :title="`${reviewAttentionCount} 个评审需关注项`"
            >{{ reviewAttentionCount }}</span>
          </button>
        </div>
        <button
          type="button"
          class="file-panel-collapse-btn"
          title="折叠面板 (Ctrl+\\)"
          aria-label="折叠面板"
          @click="$emit('collapse-file-panel')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
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
        class="file-panel-project-nav"
      >
        <label class="file-panel-project-select-wrap">
          <span class="sr-only">项目子视图</span>
          <select
            class="file-panel-project-select"
            :value="projectPanelView"
            aria-label="项目子视图"
            @change="onProjectViewChange"
          >
            <option value="knowledge">知识库</option>
            <option value="health">
              架构评审{{ reviewAttentionCount ? ` (${reviewAttentionCount})` : "" }}
            </option>
            <option value="map">架构图</option>
            <option value="fix">测试修复</option>
          </select>
          <svg class="file-panel-project-select-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </label>
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
          <button type="button" class="icon file-toolbar-btn" title="新建文件" @click="$emit('create-new-file')">
            <svg class="file-toolbar-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
          <button type="button" class="icon file-toolbar-btn" title="新建文件夹" @click="$emit('create-new-folder')">
            <svg class="file-toolbar-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2.5 4.8A1.3 1.3 0 0 1 3.8 3.5h3.2l1.2 1.3h4.5A1.3 1.3 0 0 1 14 6.1v6.4a1.3 1.3 0 0 1-1.3 1.3H3.8A1.3 1.3 0 0 1 2.5 12.5V4.8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            </svg>
          </button>
          <button type="button" class="icon file-toolbar-btn" title="全部折叠" aria-label="全部折叠" @click="$emit('collapse-all-dirs')">
            <svg class="file-toolbar-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 3.5h9M3.5 8h9M3.5 12.5h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M6 5.5 4 8l2 2.5M10 5.5 12 8l-2 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <template v-if="editorCollapsed">
            <span class="toolbar-sep" />
            <button
              type="button"
              class="icon file-toolbar-btn"
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
      <!-- 会话 Tab 独立渲染，避免文件树 loading 遮罩挡住点击 -->
      <div v-if="gitPanelMode === 'sessions'" class="sessions-panel">
        <div class="sessions-toolbar">
          <button
            type="button"
            class="sessions-new-btn"
            title="新建会话 (Ctrl+N)"
            @click="$emit('start-new-session')"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            新建会话
          </button>
        </div>
        <div class="sessions-search-box">
          <svg class="sessions-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.2" stroke="currentColor" stroke-width="1.3"/>
            <path d="M10.2 10.2 13.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          <input
            ref="sessionSearchInput"
            v-model="sessionSearchQuery"
            class="sessions-search-input"
            type="search"
            placeholder="搜索会话…"
            aria-label="搜索会话"
          />
          <kbd v-if="!sessionSearchQuery" class="sessions-search-kbd">Ctrl+K</kbd>
          <button
            v-else
            type="button"
            class="sessions-search-clear"
            title="清除搜索"
            @click="sessionSearchQuery = ''"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <p v-if="chatStoreSyncMessage" class="sessions-sync-hint" role="status" aria-live="polite">
          {{ chatStoreSyncMessage }}
        </p>
        <div class="sessions-scroll">
          <div v-if="!sessionList.length" class="sessions-empty">
            <div class="sessions-empty-icon" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <p class="sessions-empty-title">暂无会话</p>
            <p class="sessions-empty-hint">开始对话后，会话会显示在这里</p>
          </div>
          <div v-else-if="!filteredGroupedSessions.length" class="sessions-empty">
            <p class="sessions-empty-hint">没有匹配的会话</p>
          </div>
          <template v-else>
            <div v-for="group in filteredGroupedSessions" :key="group.label" class="session-group">
              <button
                type="button"
                class="session-group-header"
                @click="toggleGroupCollapse(group.label)"
              >
                <svg
                  class="session-group-chevron"
                  :class="{ collapsed: collapsedGroups.has(group.label) }"
                  width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"
                >
                  <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="session-group-label">{{ group.label }}</span>
                <span class="session-group-count">{{ group.items.length }}</span>
              </button>
              <ul v-if="!collapsedGroups.has(group.label)" class="session-group-list">
                <li
                  v-for="s in group.items"
                  :key="s.id"
                  class="session-item"
                  :class="{ active: s.id === activeSessionId, 'session-item--syncing': sessionSendingIds.includes(s.id) }"
                >
                  <button
                    type="button"
                    class="session-item-main"
                    :title="sessionItemTitle(s)"
                    @click="$emit('switch-session', s.id)"
                  >
                    <span class="session-item-icon" aria-hidden="true">
                      <span v-if="s.status === 'completed' && !sessionSendingIds.includes(s.id)" class="status-dot status-dot--completed" title="已完成" />
                      <span v-else-if="s.status === 'failed' && !sessionSendingIds.includes(s.id)" class="status-dot status-dot--failed" title="失败" />
                      <span v-else-if="s.status === 'interrupted' && !sessionSendingIds.includes(s.id)" class="status-dot status-dot--interrupted" title="已中断" />
                      <span v-else-if="sessionSendingIds.includes(s.id)" class="status-dot status-dot--running" title="运行中"><span class="session-spinner" /></span>
                      <span v-else class="status-dot" />
                    </span>
                    <span
                      class="session-item-title"
                      :class="{ 'shimmer-text--fast': sessionSendingIds.includes(s.id) }"
                    >{{ s.title }}</span>
                  </button>
                  <div class="session-item-trailing">
                    <span
                      class="session-item-pill"
                      :title="s.messageCount ? `${formatCount(s.messageCount)} 条消息` : undefined"
                    >{{ formatSessionTime(s.updatedAt) }}</span>
                    <div class="session-item-actions">
                      <button
                        type="button"
                        class="session-action-icon-btn"
                        title="复制会话信息"
                        @click.stop="$emit('copy-session-info', s)"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <rect x="5" y="5" width="8" height="9" rx="1.2" stroke="currentColor" stroke-width="1.2"/>
                          <path d="M4 11V3.8A1.8 1.8 0 0 1 5.8 2H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="session-action-icon-btn"
                        title="复制会话名和路径"
                        @click.stop="$emit('copy-session-name-path', s)"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                          <path d="M8.5 1.5h6v6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                          <path d="M14.5 1.5L8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="session-action-icon-btn"
                        title="重命名"
                        @click.stop="startRename(s)"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="session-action-icon-btn session-action-icon-btn--danger"
                        title="删除"
                        @click.stop="$emit('remove-session', s.id)"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M3.5 4.5h9M6 4.5V3.2a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8V4.5M6.2 7v4.2M9.8 7v4.2M5 4.5l.4 8.2a.8.8 0 0 0 .8.8h3.6a.8.8 0 0 0 .8-.8l.4-8.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </template>
        </div>
      </div>

      <div v-else class="panel-body-main">
        <div v-if="loadingTree" class="panel-loading-overlay" aria-live="polite">
          <span class="panel-loading-spinner" aria-hidden="true" />
          <span>正在加载项目…</span>
        </div>
        <slot></slot>
      </div>
    </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, withDefaults } from "vue";
import type { GitStatusFile } from "../../services/vibeGitClient";
import type { VibeChatSessionMeta } from "../../services/vibeChatStorage";

const sessionSearchInput = ref<HTMLInputElement | null>(null);

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

function sessionItemTitle(s: VibeChatSessionMeta): string {
  if (s.messageCount) return `${s.title} · ${formatCount(s.messageCount)} 条`;
  return s.title;
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
  projectPanelView: "knowledge" | "health" | "fix" | "map";
  projectOpened: boolean;
  loadingTree?: boolean;
  editorCollapsed: boolean;
  chatCollapsed: boolean;
  filePanelCollapsed: boolean;
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
  (e: "update:projectPanelView", view: "knowledge" | "health" | "fix" | "map"): void;
  (e: "open-quick-search"): void;
  (e: "create-new-file"): void;
  (e: "create-new-folder"): void;
  (e: "collapse-all-dirs"): void;
  (e: "expand-editor"): void;
  (e: "expand-chat"): void;
  (e: "collapse-file-panel"): void;
  (e: "expand-file-panel"): void;
  (e: "refresh-git-status"): void;
  (e: "switch-session", sessionId: string): void;
  (e: "remove-session", sessionId: string): void;
  (e: "start-new-session"): void;
  (e: "copy-session-info", session: VibeChatSessionMeta): void;
  (e: "copy-session-name-path", session: VibeChatSessionMeta): void;
  (e: "sync-chat-store-to-disk"): void;
  (e: "toggle-favorite", sessionId: string): void;
  (e: "rename-session", sessionId: string, newTitle: string): void;
}>();

/** 窄于约一屏四文字 Tab 时改图标，避免挤压 */
const NARROW_TAB_WIDTH = 240;
const narrowTabs = computed(() => props.filePanelWidth < NARROW_TAB_WIDTH);

const gitTabTitle = computed(() => {
  if (props.gitUnstagedFiles.length && props.gitStagedFiles.length) {
    return `${props.gitStagedFiles.length} 已暂存 · ${props.gitUnstagedFiles.length} 未暂存`;
  }
  if (props.gitStagedFiles.length) return `${props.gitStagedFiles.length} 已暂存`;
  if (props.gitUnstagedFiles.length) return `${props.gitUnstagedFiles.length} 未暂存`;
  return "Git";
});

function onProjectViewChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "knowledge" || value === "health" || value === "map" || value === "fix") {
    emit("update:projectPanelView", value);
  }
}

const sessionSearchQuery = ref("");
const collapsedGroups = ref(new Set<string>());
const favoriteIds = ref(new Set<string>());
const renamingSessionId = ref("");
const renameValue = ref("");

function toggleGroupCollapse(label: string) {
  if (collapsedGroups.value.has(label)) {
    collapsedGroups.value.delete(label);
  } else {
    collapsedGroups.value.add(label);
  }
}

function startRename(s: VibeChatSessionMeta) {
  renamingSessionId.value = s.id;
  renameValue.value = s.title;
}

function commitRename(s: VibeChatSessionMeta) {
  const trimmed = renameValue.value.trim();
  if (trimmed && trimmed !== s.title) {
    emit("rename-session", s.id, trimmed);
  }
  renamingSessionId.value = "";
}

function cancelRename() {
  renamingSessionId.value = "";
}

const groupedSessions = computed<SessionGroup[]>(() => {
  const order = ["今天", "昨天", "本周", "本月", "更早"];
  const map = new Map<string, typeof props.sessionList>();
  for (const label of order) map.set(label, []);
  for (const s of props.sessionList) {
    const group = getDateGroup(s.updatedAt);
    map.get(group)?.push(s);
  }
  return order
    .filter((label) => (map.get(label)?.length ?? 0) > 0)
    .map((label) => ({
      label,
      items: [...(map.get(label) ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
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
  background: #161b22;
  overflow: hidden;
  container-type: inline-size;
}

.panel-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-body-main {
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

.file-panel-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.file-panel-collapse-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.88);
}

/* Collapsed sidebar */
.file-panel-collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  background: #161b22;
  border-right: 1px solid var(--border);
  height: 100%;
}

.file-panel-collapsed-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.file-panel-collapsed-tab:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.88);
}

.file-panel-collapsed-tab.active {
  background: rgba(88, 166, 255, 0.14);
  color: #58a6ff;
}

.file-panel-collapsed-tab:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.file-panel-collapsed-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(88, 166, 255, 0.55);
  border-radius: 999px;
}

.file-panel-collapsed-badge--warn {
  color: rgba(255, 255, 255, 0.9);
  background: rgba(210, 120, 40, 0.65);
}

.file-panel-collapsed-spacer {
  flex: 1;
}

.file-panel-collapsed-expand {
  color: rgba(255, 255, 255, 0.35);
}

.file-panel-collapsed-expand:hover {
  color: rgba(255, 255, 255, 0.88);
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
  min-width: 0;
}

.file-panel-tabs--icons .file-panel-tab {
  padding: 6px 4px;
  gap: 3px;
}

.file-panel-tab-icon {
  display: block;
  flex-shrink: 0;
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

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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

.file-panel-project-nav {
  padding: 0 8px 8px;
}

.file-panel-project-select-wrap {
  position: relative;
  display: block;
}

.file-panel-project-select {
  width: 100%;
  appearance: none;
  padding: 6px 28px 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(220, 228, 235, 0.98);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
}

.file-panel-project-select:hover {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
}

.file-panel-project-select:focus-visible {
  border-color: rgba(88, 166, 255, 0.5);
  box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
}

.file-panel-project-select option {
  background: #161b22;
  color: #e6edf3;
}

.file-panel-project-select-chevron {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(139, 148, 158, 0.85);
  pointer-events: none;
}

.file-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.file-toolbar-btn {
  /* 消费全局 button.icon token，仅覆盖工具栏尺寸 */
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
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

.sessions-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 6px;
  flex-shrink: 0;
}

.sessions-new-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 7px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(88, 166, 255, 0.1);
  color: #79c0ff;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sessions-new-btn:hover {
  background: rgba(88, 166, 255, 0.18);
  border-color: rgba(88, 166, 255, 0.3);
  color: #a5d6ff;
}

.sessions-new-btn:active {
  background: rgba(88, 166, 255, 0.22);
}

.sessions-search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 10px 6px;
  padding: 0 8px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  transition: border-color 0.2s ease, background 0.2s ease;
}

.sessions-search-box:focus-within {
  border-color: rgba(88, 166, 255, 0.35);
  background: rgba(0, 0, 0, 0.3);
}

.sessions-search-icon {
  flex-shrink: 0;
  color: rgba(139, 148, 158, 0.5);
}

.sessions-search-box:focus-within .sessions-search-icon {
  color: rgba(88, 166, 255, 0.7);
}

.sessions-search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  outline: none;
}

.sessions-search-input::placeholder {
  color: rgba(139, 148, 158, 0.5);
}

.sessions-search-kbd {
  flex-shrink: 0;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(139, 148, 158, 0.45);
  line-height: 1;
}

.sessions-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(139, 148, 158, 0.6);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.sessions-search-clear:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
}

.sessions-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  padding: 2px 0;
}

.sessions-scroll:hover {
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

.sessions-scroll::-webkit-scrollbar {
  width: 5px;
}

.sessions-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: transparent;
  transition: background 0.2s;
}

.sessions-scroll:hover::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
}

.sessions-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;
}

.sessions-empty-icon {
  color: rgba(139, 148, 158, 0.25);
  margin-bottom: 4px;
}

.sessions-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
}

.sessions-empty-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(139, 148, 158, 0.5);
}

.sessions-search-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: rgba(139, 148, 158, 0.55);
}

.session-group {
  margin-bottom: 2px;
}

.session-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 10px 4px 10px;
  border: none;
  background: none;
  cursor: pointer;
  list-style: none;
}

.session-group-chevron {
  flex-shrink: 0;
  color: rgba(139, 148, 158, 0.4);
  transition: transform 0.15s ease;
}

.session-group-chevron.collapsed {
  transform: rotate(-90deg);
}

.session-group-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(139, 148, 158, 0.5);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.session-group-count {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.3);
  margin-left: 2px;
}

.session-group-list {
  list-style: none;
  margin: 0;
  padding: 0 6px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 8px;
  position: relative;
  transition: background 0.12s ease;
}

.session-item + .session-item {
  margin-top: 1px;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.session-item.active {
  background: rgba(255, 255, 255, 0.06);
}

.session-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #58a6ff;
}

.session-item-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 6px 7px 10px;
  border: none;
  background: none;
  color: var(--text-primary, #e6edf3);
  cursor: pointer;
  text-align: left;
  min-width: 0;
  border-radius: 6px;
  position: relative;
  z-index: 1;
}

.session-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 8px;
  height: 8px;
  flex-shrink: 0;
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

.session-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.88);
}

.session-item.active .session-item-title {
  color: rgba(200, 225, 255, 0.95);
}

.session-item-trailing {
  position: relative;
  display: grid;
  align-items: center;
  justify-items: end;
  flex-shrink: 0;
  min-width: 100px;
  height: 24px;
  padding-right: 4px;
  z-index: 2;
}

.session-item-pill,
.session-item-actions {
  grid-area: 1 / 1;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.session-item-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1;
  color: rgba(139, 148, 158, 0.72);
  background: rgba(139, 148, 158, 0.1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  opacity: 1;
  transform: scale(1);
}

.session-item-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transform: scale(0.96);
  pointer-events: none;
}

.session-item:hover .session-item-pill,
.session-item:focus-within .session-item-pill {
  opacity: 0;
  transform: scale(0.96);
}

.session-item:hover .session-item-actions,
.session-item:focus-within .session-item-actions {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}

.session-item--syncing .session-item-title {
  color: rgba(201, 224, 255, 0.95);
}

.session-item--syncing {
  background: rgba(88, 166, 255, 0.12);
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

.session-action-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(139, 148, 158, 0.55);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.session-action-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.88);
}

.session-action-icon-btn--danger:hover {
  background: rgba(248, 81, 73, 0.12);
  color: #f85149;
}
</style>
