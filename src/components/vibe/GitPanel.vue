<template>
  <div class="git-panel">
    <div v-if="!projectOpened" class="panel-empty">请先打开项目文件夹</div>
    <div v-else-if="gitLoading" class="panel-empty">加载中…</div>
    <div v-else-if="gitError" class="panel-empty git-panel-fetch-error">
      <p>获取 Git 状态失败</p>
      <p class="git-fetch-error-detail">{{ gitError }}</p>
      <button type="button" class="secondary small" @click="$emit('refresh-git-status')">重试</button>
    </div>
    <div v-else-if="gitIsRepo" class="git-panel-content">
      <div class="git-header">
        <!-- 第一行：分支名 + 操作按钮 -->
        <div class="git-header-row git-branch-row">
          <div class="git-branch-info">
            <span class="git-branch-icon" aria-hidden="true">⎇</span>
            <span class="git-branch-name" :title="gitBranch">{{ gitBranch }}</span>
            <span v-if="gitTrackingBranch" class="git-tracking-badge" :title="'跟踪: ' + gitTrackingBranch">
              ⟶ {{ gitTrackingBranch.replace(/^[^/]+\//, '') }}
            </span>
          </div>
          <button type="button" class="ghost tiny" :disabled="gitLoading" @click="$emit('refresh-git-status')">刷新</button>
        </div>
        <!-- 第二行：同步操作 -->
        <div v-if="gitRemotes.length" class="git-header-row git-sync-row">
          <div class="git-sync-info">
            <span class="git-sync-stat" :class="{ ahead: gitAhead > 0, behind: gitBehind > 0 }">
              <span class="git-sync-arrow">↑</span>{{ gitAhead }}
            </span>
            <span class="git-sync-stat" :class="{ ahead: gitAhead > 0, behind: gitBehind > 0 }">
              <span class="git-sync-arrow">↓</span>{{ gitBehind }}
            </span>
          </div>
          <div class="git-remote-actions">
            <button type="button" class="ghost tiny" :disabled="!!gitRemoteAction" @click="$emit('do-fetch')">
              {{ gitRemoteAction === 'fetch' ? '…' : 'Fetch' }}
            </button>
            <button type="button" class="ghost tiny" :disabled="!!gitRemoteAction" @click="$emit('do-pull')">
              {{ gitRemoteAction === 'pull' ? '…' : 'Pull' }}
            </button>
            <button type="button" class="ghost tiny" :disabled="!!gitRemoteAction" @click="$emit('do-push')">
              {{ gitRemoteAction === 'push' ? '…' : 'Push' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Stash 区域 -->
      <div class="git-stash-section">
        <div class="git-stash-header">
          <div class="git-stash-title-row">
            <span class="git-stash-icon">📦</span>
            <span class="git-stash-title">贮藏</span>
            <span v-if="gitStashes.length" class="git-stash-count">{{ gitStashes.length }}</span>
          </div>
          <div class="git-stash-save-row">
            <input
              v-model="gitStashMessage"
              class="git-stash-msg-input"
              type="text"
              placeholder="贮藏信息（可选）"
              :disabled="!!gitStashAction"
              @keydown.enter="$emit('do-stash-save')"
            />
            <button
              type="button"
              class="ghost tiny stash-save-btn"
              :disabled="!!gitStashAction"
              @click="$emit('do-stash-save')"
            >
              {{ gitStashAction === 'save' ? '…' : '贮藏' }}
            </button>
          </div>
        </div>
        <div v-if="gitStashes.length" class="git-stash-list">
          <div class="git-stash-list-header">
            <button type="button" class="git-section-toggle" @click="$emit('toggle-git-stash-open')">
              <span class="git-section-chevron">{{ gitStashOpen ? "▾" : "▸" }}</span>
              <span class="git-stash-list-title">贮藏列表</span>
            </button>
          </div>
          <div v-if="gitStashOpen" class="git-stash-list-content">
            <div v-for="stash in gitStashes" :key="stash.index" class="git-stash-item">
              <span class="git-stash-label">{{ 'stash@{' + stash.index + '}' }}</span>
              <span class="git-stash-msg">{{ stash.message }}</span>
              <div class="git-stash-actions">
                <button
                  type="button"
                  class="ghost tiny"
                  :disabled="!!gitStashAction"
                  @click="$emit('do-stash-apply', stash.index)"
                  title="应用贮藏（保留贮藏）"
                >
                  {{ gitStashAction === 'apply-' + stash.index ? '…' : 'Apply' }}
                </button>
                <button
                  type="button"
                  class="ghost tiny danger"
                  :disabled="!!gitStashAction"
                  @click="$emit('do-stash-drop', stash.index)"
                  title="移除此贮藏（不应用）"
                >
                  {{ gitStashAction === 'drop-' + stash.index ? '…' : 'Drop' }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="gitStashAction === 'list'" class="git-stash-empty">加载中…</div>
        <div v-else class="git-stash-empty">暂无贮藏</div>
      </div>

      <div v-if="gitError" class="git-error">{{ gitError }}</div>
      <div class="git-commit-box">
        <textarea
          v-model="gitCommitMessage"
          class="git-commit-input"
          rows="2"
          placeholder="提交信息…"
          :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep"
        />
        <div class="git-commit-actions">
          <button
            type="button"
            class="ghost tiny"
            :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep"
            @click="$emit('generate-commit-message')"
          >
            {{ gitGenStep ? '…' : 'AI 生成' }}
          </button>
          <button
            type="button"
            class="ghost tiny"
            :disabled="!canGitCommit || gitCommitting || !!gitGenStep || !!gitAiPushStep"
            @click="$emit('commit-git')"
          >
            {{ gitCommitting ? '提交中…' : '提交' }}
          </button>
          <button
            type="button"
            class="ghost tiny"
            :disabled="!canGitCommit || !!gitAiPushStep || !!gitGenStep"
            @click="$emit('ai-commit-and-push')"
          >
            {{ gitAiPushStep ? '…' : 'AI 提交并推送' }}
          </button>
        </div>
      </div>

      <!-- 文件列表 -->
      <div class="git-files-section">
        <div class="git-files-header">
          <button type="button" class="git-section-toggle" @click="$emit('toggle-git-staged-open')">
            <span class="git-section-chevron">{{ gitStagedOpen ? "▾" : "▸" }}</span>
            <span class="git-files-title">已暂存 ({{ gitStagedFiles.length }})</span>
          </button>
          <div v-if="gitStagedFiles.length" class="git-files-actions">
            <button type="button" class="ghost tiny" @click="$emit('unstage-all')">全部取消暂存</button>
          </div>
        </div>
        <div v-if="gitStagedOpen" class="git-files-list">
          <div v-for="file in gitStagedFiles" :key="file.path" class="git-file-item">
            <span class="git-file-icon" :class="file.status">{{ getFileIcon(file.status) }}</span>
            <span class="git-file-path" :title="file.path">{{ file.path }}</span>
            <div class="git-file-actions">
              <button type="button" class="ghost tiny" @click="$emit('unstage-file', file.path)" title="取消暂存">
                ×
              </button>
            </div>
          </div>
        </div>

        <div class="git-files-header">
          <button type="button" class="git-section-toggle" @click="$emit('toggle-git-unstaged-open')">
            <span class="git-section-chevron">{{ gitUnstagedOpen ? "▾" : "▸" }}</span>
            <span class="git-files-title">未暂存 ({{ gitUnstagedFiles.length }})</span>
          </button>
          <div v-if="gitUnstagedFiles.length" class="git-files-actions">
            <button type="button" class="ghost tiny" @click="$emit('stage-all')">全部暂存</button>
            <button type="button" class="ghost tiny danger" @click="$emit('discard-all')">全部丢弃</button>
          </div>
        </div>
        <div v-if="gitUnstagedOpen" class="git-files-list">
          <div v-for="file in gitUnstagedFiles" :key="file.path" class="git-file-item">
            <span class="git-file-icon" :class="file.status">{{ getFileIcon(file.status) }}</span>
            <span class="git-file-path" :title="file.path">{{ file.path }}</span>
            <div class="git-file-actions">
              <button type="button" class="ghost tiny" @click="$emit('stage-file', file.path)" title="暂存">
                +
              </button>
              <button type="button" class="ghost tiny danger" @click="$emit('discard-file', file.path)" title="丢弃">
                ×
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 提交历史 -->
      <div class="git-log-section">
        <div class="git-log-header">
          <button type="button" class="git-section-toggle" @click="$emit('toggle-git-log-open')">
            <span class="git-section-chevron">{{ gitLogOpen ? "▾" : "▸" }}</span>
            <span class="git-log-title">提交历史</span>
          </button>
        </div>
        <div v-if="gitLogOpen" class="git-log-list">
          <div v-for="entry in gitLogEntries" :key="entry.hash" class="git-log-item">
            <div class="git-log-hash" :title="entry.hash">{{ entry.hash.slice(0, 7) }}</div>
            <div class="git-log-message">{{ entry.message }}</div>
            <div class="git-log-meta">
              <span class="git-log-author">{{ entry.author }}</span>
              <span class="git-log-date">{{ entry.date }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="panel-empty">当前目录不是 Git 仓库</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { GitLogFile } from "../../services/vibeGitClient";

interface GitStash {
  index: number;
  message: string;
}

interface GitFile {
  path: string;
  status: string;
}

interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: GitLogFile[];
}

interface Props {
  projectOpened: boolean;
  gitLoading: boolean;
  gitIsRepo: boolean;
  gitStatusKnown: boolean;
  gitError: string;
  gitBranch: string;
  gitTrackingBranch: string;
  gitRemotes: string[];
  gitAhead: number;
  gitBehind: number;
  gitStashes: GitStash[];
  gitStagedFiles: GitFile[];
  gitUnstagedFiles: GitFile[];
  gitChangeCount: number;
  canGitCommit: boolean;
  gitCommitMessage: string;
  gitCommitting: boolean;
  gitGenStep: string;
  gitAiPushStep: string;
  gitStashAction: string;
  gitStashMessage: string;
  gitStashOpen: boolean;
  gitStagedOpen: boolean;
  gitUnstagedOpen: boolean;
  gitLogOpen: boolean;
  gitLogEntries: GitLogEntry[];
  selectedGitFile: string;
  gitDiffLoadingKey: string;
  gitRemoteAction: string;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: "refresh-git-status"): void;
  (e: "do-fetch"): void;
  (e: "do-pull"): void;
  (e: "do-push"): void;
  (e: "commit-git"): void;
  (e: "generate-commit-message"): void;
  (e: "ai-commit-and-push"): void;
  (e: "stage-file", path: string): void;
  (e: "unstage-file", path: string): void;
  (e: "stage-all"): void;
  (e: "unstage-all"): void;
  (e: "discard-file", path: string): void;
  (e: "discard-all"): void;
  (e: "do-stash-save"): void;
  (e: "do-stash-apply", index: number): void;
  (e: "do-stash-drop", index: number): void;
  (e: "toggle-git-stash-open"): void;
  (e: "toggle-git-staged-open"): void;
  (e: "toggle-git-unstaged-open"): void;
  (e: "toggle-git-log-open"): void;
  (e: "toggle-git-log-entry", hash: string): void;
  (e: "open-git-log-file", entry: GitLogEntry, file: GitLogFile): void;
  (e: "on-git-file-pointer-down", event: PointerEvent, path: string, staged: boolean): void;
}>();

function getFileIcon(status: string): string {
  switch (status) {
    case "added": return "A";
    case "modified": return "M";
    case "deleted": return "D";
    case "renamed": return "R";
    case "copied": return "C";
    default: return "?";
  }
}
</script>

<style scoped>
.git-panel {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 12px;
}

.git-panel-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.git-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.git-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.git-branch-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.git-branch-icon {
  font-size: 12px;
}

.git-branch-name {
  font-size: 12px;
  font-weight: 500;
}

.git-tracking-badge {
  font-size: 10px;
  color: var(--text-secondary);
  padding: 1px 4px;
  background: var(--bg-tertiary);
  border-radius: 3px;
}

.git-sync-row {
  justify-content: flex-end;
}

.git-sync-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.git-sync-stat {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--text-secondary);
}

.git-sync-stat.ahead {
  color: var(--success-color);
}

.git-sync-stat.behind {
  color: var(--warning-color);
}

.git-sync-arrow {
  font-size: 10px;
}

.git-remote-actions {
  display: flex;
  gap: 4px;
}

.git-stash-section {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
}

.git-stash-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.git-stash-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.git-stash-icon {
  font-size: 12px;
}

.git-stash-title {
  font-size: 12px;
  font-weight: 500;
}

.git-stash-count {
  font-size: 10px;
  color: var(--text-secondary);
  padding: 1px 4px;
  background: var(--bg-tertiary);
  border-radius: 3px;
}

.git-stash-save-row {
  display: flex;
  gap: 4px;
}

.git-stash-msg-input {
  flex: 1;
  padding: 4px 6px;
  font-size: 11px;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.git-stash-msg-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.git-stash-msg-input:disabled {
  opacity: 0.5;
}

.stash-save-btn {
  flex-shrink: 0;
}

.git-stash-list {
  margin-top: 6px;
}

.git-stash-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.git-section-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 0;
  font-size: 11px;
}

.git-section-toggle:hover {
  color: var(--text-primary);
}

.git-section-chevron {
  font-size: 10px;
  width: 10px;
}

.git-stash-list-title,
.git-files-title,
.git-log-title {
  font-weight: 500;
}

.git-stash-list-content {
  margin-top: 4px;
}

.git-stash-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 11px;
}

.git-stash-label {
  color: var(--text-secondary);
  font-family: monospace;
}

.git-stash-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-stash-actions {
  display: flex;
  gap: 4px;
}

.git-stash-empty {
  color: var(--text-secondary);
  font-size: 11px;
  padding: 4px 0;
}

.git-error {
  padding: 6px 8px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 4px;
  color: var(--error-text);
  font-size: 11px;
}

.git-commit-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.git-commit-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  resize: vertical;
  min-height: 40px;
}

.git-commit-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.git-commit-input:disabled {
  opacity: 0.5;
}

.git-commit-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.git-files-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.git-files-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.git-files-actions {
  display: flex;
  gap: 4px;
}

.git-files-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.git-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: 11px;
  border-radius: 3px;
}

.git-file-item:hover {
  background: var(--bg-tertiary);
}

.git-file-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: bold;
  border-radius: 3px;
}

.git-file-icon.added {
  background: rgba(63, 185, 80, 0.15);
  color: var(--success-color);
}

.git-file-icon.modified {
  background: rgba(210, 153, 34, 0.15);
  color: var(--warning-color);
}

.git-file-icon.deleted {
  background: rgba(248, 81, 73, 0.15);
  color: var(--error-color);
}

.git-file-icon.renamed,
.git-file-icon.copied {
  background: rgba(88, 166, 255, 0.15);
  color: var(--accent-color);
}

.git-file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-file-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.git-file-item:hover .git-file-actions {
  opacity: 1;
}

.git-log-section {
  margin-top: 8px;
}

.git-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.git-log-list {
  margin-top: 6px;
}

.git-log-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
}

.git-log-item:last-child {
  border-bottom: none;
}

.git-log-hash {
  font-family: monospace;
  font-size: 11px;
  color: var(--accent-color);
}

.git-log-message {
  font-size: 12px;
  line-height: 1.4;
}

.git-log-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--text-secondary);
}

.ghost {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.ghost:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ghost.tiny {
  padding: 2px 6px;
  font-size: 11px;
}

.ghost.danger:hover {
  background: rgba(248, 81, 73, 0.1);
  color: var(--error-color);
}
</style>
