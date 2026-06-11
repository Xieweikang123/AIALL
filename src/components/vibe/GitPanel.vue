<template>
  <div class="git-panel">
    <div v-if="!projectOpened" class="panel-empty">请先打开项目文件夹</div>
    <div v-else-if="gitLoading" class="panel-empty">加载中…</div>
    <div v-else-if="gitIsRepo" class="git-panel-content">
      <div class="git-header">
        <div class="git-header-row git-branch-row">
          <div class="git-branch-info">
            <span class="git-branch-icon" aria-hidden="true">⎇</span>
            <span class="git-branch-name" :title="gitBranch">{{ gitBranch }}</span>
            <span v-if="gitTrackingBranch" class="git-tracking-badge" :title="'跟踪: ' + gitTrackingBranch">
              ⟶ {{ gitTrackingBranch.replace(/^[^/]+\//, '') }}
            </span>
          </div>
          <button type="button" class="ghost tiny" :disabled="gitLoading" @click="$emit('refresh')">刷新</button>
          <span
            v-if="fileWatcherActive"
            class="file-watcher-dot"
            :class="{ connected: fileWatcherConnected }"
            :title="fileWatcherConnected ? '文件监控已连接' : '文件监控重连中…'"
          />
        </div>
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

      <div class="git-stash-section">
        <div class="git-stash-header">
          <div class="git-stash-title-row">
            <span class="git-stash-icon">📦</span>
            <span class="git-stash-title">贮藏</span>
            <span v-if="gitStashes.length" class="git-stash-count">{{ gitStashes.length }}</span>
          </div>
          <div class="git-stash-save-row">
            <input
              :value="gitStashMessage"
              class="git-stash-msg-input"
              type="text"
              placeholder="贮藏信息（可选）"
              :disabled="!!gitStashAction"
              @input="$emit('update:gitStashMessage', ($event.target as HTMLInputElement).value)"
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
            <button type="button" class="git-section-toggle" @click="$emit('update:gitStashOpen', !gitStashOpen)">
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
          :value="gitCommitMessage"
          class="git-commit-input"
          rows="2"
          placeholder="提交信息…"
          :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep"
          @input="$emit('update:gitCommitMessage', ($event.target as HTMLTextAreaElement).value)"
          @keydown.ctrl.enter="$emit('commit-git')"
          @keydown.meta.enter="$emit('commit-git')"
        />
        <div class="git-commit-actions">
          <button
            type="button"
            class="secondary small git-commit-ai"
            :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep || !gitStagedFiles.length || !configReady"
            @click="$emit('generate-commit-message')"
          >
            {{ gitGenStep || "✦ AI 生成" }}
          </button>
          <button
            type="button"
            class="small"
            :class="canGitCommit ? 'primary' : 'secondary'"
            :disabled="!canGitCommit || !!gitAiPushStep"
            @click="$emit('commit-git')"
          >
            {{ gitCommitting ? "提交中…" : `提交 (${gitStagedFiles.length})` }}
          </button>
        </div>
        <div class="git-ai-push-sep"></div>
        <button
          type="button"
          class="primary small git-ai-push"
          :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep || !gitStagedFiles.length || !configReady"
          @click="$emit('ai-commit-and-push')"
        >
          {{ gitAiPushStep || "✦ AI 一键推送" }}
        </button>
      </div>
      <div class="git-scroll-area">
        <div v-if="!gitStatus.length" class="panel-empty">无本地改动</div>
        <template v-else>
          <div v-if="gitStagedFiles.length" class="git-section">
            <div class="git-section-head">
              <button type="button" class="git-section-toggle" @click="$emit('update:gitStagedOpen', !gitStagedOpen)">
                <span class="git-section-chevron">{{ gitStagedOpen ? "▾" : "▸" }}</span>
                <span class="git-section-title">已暂存 ({{ gitStagedFiles.length }})</span>
              </button>
              <button type="button" class="ghost tiny" @click="$emit('unstage-all')">取消全部</button>
            </div>
            <div v-if="gitStagedOpen" class="git-file-list">
              <div
                v-for="file in gitStagedFiles"
                :key="file.path"
                class="git-file-item"
                :class="{ active: selectedGitFiles.includes(file.path), loading: gitDiffLoadingKey === gitWorkingTreeDiffKey(file.path, file.staged), 'file-item-draggable': true }"
                @pointerdown="$emit('on-git-file-pointer-down', $event, file.path, file.staged)"
              >
                <span class="git-file-check" @pointerdown.stop @click.stop="$emit('unstage-file', file.path)">✓</span>
                <span
                  class="git-file-status"
                  :style="{ color: gitStatusColor(file.status) }"
                >
                  {{ gitStatusIcon(file.status) }}
                </span>
                <span class="git-file-path" :title="file.path">{{ file.path }}</span>
              </div>
            </div>
          </div>
          <div v-if="gitUnstagedFiles.length" class="git-section">
            <div class="git-section-head">
              <button type="button" class="git-section-toggle" @click="$emit('update:gitUnstagedOpen', !gitUnstagedOpen)">
                <span class="git-section-chevron">{{ gitUnstagedOpen ? "▾" : "▸" }}</span>
                <span class="git-section-title">未暂存 ({{ gitUnstagedFiles.length }})</span>
              </button>
              <div class="git-section-actions">
                <button type="button" class="ghost tiny" @click="$emit('stage-all')">全部暂存</button>
                <button type="button" class="ghost tiny danger" @click="$emit('discard-all', $event)">丢弃全部</button>
              </div>
            </div>
            <div v-if="gitUnstagedOpen" class="git-file-list">
              <div
                v-for="file in gitUnstagedFiles"
                :key="file.path"
                class="git-file-item"
                :class="{ active: selectedGitFiles.includes(file.path), loading: gitDiffLoadingKey === gitWorkingTreeDiffKey(file.path, file.staged), 'file-item-draggable': true }"
                @pointerdown="$emit('on-git-file-pointer-down', $event, file.path, file.staged)"
              >
                <span class="git-file-check" @pointerdown.stop @click.stop="$emit('stage-file', file.path)">+</span>
                <span
                  class="git-file-status"
                  :style="{ color: gitStatusColor(file.status) }"
                >
                  {{ gitStatusIcon(file.status) }}
                </span>
                <span class="git-file-path" :title="file.path">{{ file.path }}</span>
                <button type="button" class="ghost tiny danger git-file-btn" title="丢弃更改" @pointerdown.stop @click.stop="$emit('discard-file', file.path, $event)">✕</button>
              </div>
            </div>
          </div>
        </template>
        <div class="git-log-section">
          <button type="button" class="ghost tiny git-log-toggle" @click="$emit('update:gitLogOpen', !gitLogOpen)">
            {{ gitLogOpen ? "▾" : "▸" }} 提交历史
          </button>
          <div v-if="gitLogOpen" class="git-log-list">
            <div v-if="!gitLogEntries.length" class="panel-empty">无历史</div>
            <div v-for="entry in gitLogEntries" :key="entry.hash" class="git-log-item">
              <button type="button" class="git-log-entry-head" @click="$emit('toggle-git-log-entry', entry.hash)">
                <span class="git-log-chevron">{{ isGitLogEntryOpen(entry.hash) ? "▾" : "▸" }}</span>
                <span class="git-log-hash">{{ entry.shortHash }}</span>
                <span class="git-log-msg" :title="entry.message">{{ entry.message }}</span>
                <span class="git-log-count">{{ entry.files.length }}</span>
              </button>
              <div v-if="isGitLogEntryOpen(entry.hash)" class="git-log-detail">
                <div v-if="entry.message.includes('\n')" class="git-log-full-msg">{{ entry.message }}</div>
                <div class="git-log-files">
                  <button
                    v-for="file in entry.files"
                    :key="`${entry.hash}:${file.oldPath || ''}:${file.path}`"
                    type="button"
                    class="git-log-file"
                    :class="{ loading: gitDiffLoadingKey === gitHistoryDiffKey(entry.hash, file.path, file.oldPath) }"
                    :title="file.oldPath ? `${file.oldPath} → ${file.path}` : file.path"
                    @click="$emit('open-git-log-file', entry, file)"
                  >
                    <span class="git-file-status" :style="{ color: gitStatusColor(file.status) }">
                      {{ gitStatusIcon(file.status) }}
                    </span>
                    <span class="git-file-path">{{ file.oldPath ? `${file.oldPath} → ${file.path}` : file.path }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="gitError" class="panel-empty git-panel-fetch-error">
      <p>获取 Git 状态失败</p>
      <p class="git-fetch-error-detail">{{ gitError }}</p>
      <button type="button" class="secondary small" @click="$emit('refresh')">重试</button>
    </div>
    <div v-else-if="gitStatusKnown" class="panel-empty">当前目录不是 Git 仓库</div>
    <div v-else class="panel-empty">加载中…</div>
  </div>
</template>

<script setup lang="ts">
interface GitStash {
  index: number;
  message: string;
}

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  files: GitLogFile[];
}

interface GitLogFile {
  path: string;
  oldPath?: string;
  status: string;
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
  gitStatus: unknown[];
  gitStagedFiles: GitFile[];
  gitUnstagedFiles: GitFile[];
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
  selectedGitFiles: string[];
  gitDiffLoadingKey: string;
  gitRemoteAction: string;
  configReady: boolean;
  fileWatcherActive: boolean;
  fileWatcherConnected: boolean;
  expandedGitLogEntries: Set<string>;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: "refresh"): void;
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
  (e: "discard-file", path: string, event: MouseEvent): void;
  (e: "discard-all", event: MouseEvent): void;
  (e: "do-stash-save"): void;
  (e: "do-stash-apply", index: number): void;
  (e: "do-stash-drop", index: number): void;
  (e: "update:gitStashOpen", value: boolean): void;
  (e: "update:gitStagedOpen", value: boolean): void;
  (e: "update:gitUnstagedOpen", value: boolean): void;
  (e: "update:gitLogOpen", value: boolean): void;
  (e: "update:gitCommitMessage", value: string): void;
  (e: "update:gitStashMessage", value: string): void;
  (e: "toggle-git-log-entry", hash: string): void;
  (e: "open-git-log-file", entry: GitLogEntry, file: GitLogFile): void;
  (e: "on-git-file-pointer-down", event: PointerEvent, path: string, staged: boolean): void;
}>();

function isGitLogEntryOpen(hash: string): boolean {
  const props = defineProps<Props>();
  return props.expandedGitLogEntries.has(hash);
}

function gitWorkingTreeDiffKey(path: string, staged: boolean): string {
  return `${staged ? 'staged' : 'unstaged'}:${path}`;
}

function gitHistoryDiffKey(hash: string, path: string, oldPath?: string): string {
  return `history:${hash}:${oldPath || ''}:${path}`;
}

function gitStatusIcon(status: string): string {
  switch (status) {
    case "added": return "A";
    case "modified": return "M";
    case "deleted": return "D";
    case "renamed": return "R";
    case "copied": return "C";
    default: return "?";
  }
}

function gitStatusColor(status: string): string {
  switch (status) {
    case "added": return "#3fb950";
    case "modified": return "#d29922";
    case "deleted": return "#f85149";
    case "renamed":
    case "copied": return "#58a6ff";
    default: return "#8b949e";
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(139, 148, 158, 0.6);
  font-size: 12px;
  gap: 8px;
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
}

.git-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.git-branch-row {
  flex-wrap: wrap;
}

.git-branch-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.git-branch-icon {
  font-size: 12px;
  color: rgba(139, 148, 158, 0.6);
}

.git-branch-name {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-tracking-badge {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.6);
  padding: 1px 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}

.file-watcher-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(248, 81, 73, 0.8);
  margin-left: 4px;
}

.file-watcher-dot.connected {
  background: rgba(63, 185, 80, 0.8);
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
  color: rgba(139, 148, 158, 0.6);
}

.git-sync-stat.ahead {
  color: #3fb950;
}

.git-sync-stat.behind {
  color: #d29922;
}

.git-sync-arrow {
  font-size: 10px;
}

.git-remote-actions {
  display: flex;
  gap: 4px;
}

.git-stash-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
  color: rgba(255, 255, 255, 0.8);
}

.git-stash-count {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.6);
  padding: 1px 4px;
  background: rgba(255, 255, 255, 0.06);
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
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

.git-stash-msg-input:focus {
  outline: none;
  border-color: rgba(88, 166, 255, 0.5);
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
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  padding: 2px 0;
  font-size: 11px;
}

.git-section-toggle:hover {
  color: rgba(255, 255, 255, 0.9);
}

.git-section-chevron {
  font-size: 10px;
  width: 10px;
}

.git-stash-list-title,
.git-section-title {
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
  color: rgba(139, 148, 158, 0.6);
  font-family: monospace;
}

.git-stash-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.8);
}

.git-stash-actions {
  display: flex;
  gap: 4px;
}

.git-stash-empty {
  color: rgba(139, 148, 158, 0.5);
  font-size: 11px;
  padding: 4px 0;
}

.git-error {
  padding: 6px 8px;
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.3);
  border-radius: 4px;
  color: #ff9a9a;
  font-size: 11px;
}

.git-commit-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.git-commit-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.9);
  resize: vertical;
  min-height: 40px;
  font-family: inherit;
}

.git-commit-input:focus {
  outline: none;
  border-color: rgba(88, 166, 255, 0.5);
}

.git-commit-input:disabled {
  opacity: 0.5;
}

.git-commit-actions {
  display: flex;
  gap: 6px;
}

.git-ai-push-sep {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 0;
}

.git-scroll-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.git-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.git-section-head {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
}

.git-section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  margin-left: auto;
}

.git-section-actions button.ghost.tiny {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 5px;
  white-space: nowrap;
  flex-shrink: 0;
}

.git-file-list {
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
  cursor: pointer;
}

.git-file-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.git-file-item.active {
  background: rgba(88, 166, 255, 0.15);
}

.git-file-item.loading {
  opacity: 0.6;
}

.git-file-check {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: rgba(139, 148, 158, 0.6);
  cursor: pointer;
}

.git-file-check:hover {
  color: rgba(255, 255, 255, 0.9);
}

.git-file-status {
  font-size: 10px;
  font-weight: bold;
  width: 14px;
  text-align: center;
}

.git-file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.8);
}

.git-file-btn {
  opacity: 0;
  transition: opacity 0.15s;
}

.git-file-item:hover .git-file-btn {
  opacity: 1;
}

.git-log-section {
  margin-top: 8px;
}

.git-log-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
}

.git-log-list {
  margin-top: 6px;
}

.git-log-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.git-log-entry-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  font-size: 11px;
  text-align: left;
  width: 100%;
}

.git-log-entry-head:hover {
  color: rgba(255, 255, 255, 0.95);
}

.git-log-chevron {
  font-size: 10px;
  width: 10px;
  color: rgba(139, 148, 158, 0.6);
}

.git-log-hash {
  font-family: monospace;
  color: rgba(88, 166, 255, 0.8);
}

.git-log-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-log-count {
  font-size: 10px;
  color: rgba(139, 148, 158, 0.5);
  padding: 1px 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}

.git-log-detail {
  padding-left: 16px;
}

.git-log-full-msg {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.7);
  white-space: pre-wrap;
  margin-bottom: 4px;
}

.git-log-files {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.git-log-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 11px;
  text-align: left;
}

.git-log-file:hover {
  color: rgba(255, 255, 255, 0.9);
}

.git-log-file.loading {
  opacity: 0.6;
}

.git-panel-fetch-error {
  text-align: center;
}

.git-fetch-error-detail {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
  word-break: break-all;
}

.ghost {
  background: none;
  border: none;
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  transition: all 0.15s ease;
}

.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ghost.tiny {
  padding: 2px 6px;
  font-size: 11px;
}

.ghost.danger:hover:not(:disabled) {
  background: rgba(248, 81, 73, 0.15);
  color: #ff9a9a;
}

.secondary {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.primary {
  background: rgba(31, 111, 235, 0.8);
  color: white;
}

.primary:hover:not(:disabled) {
  background: rgba(31, 111, 235, 1);
}

.small {
  padding: 4px 10px;
  font-size: 11px;
}
</style>
