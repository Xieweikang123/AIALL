<template>
  <div class="git-panel">
    <div v-if="!projectOpened" class="panel-empty">
      <span class="panel-empty-icon" aria-hidden="true">⎇</span>
      <p class="panel-empty-title">尚未打开项目</p>
      <p class="panel-empty-hint">打开项目后可查看 Git 状态与变更</p>
    </div>
    <div v-else-if="gitLoading" class="panel-empty">
      <span class="panel-loading-spinner panel-empty-spinner" aria-hidden="true" />
      <p class="panel-empty-title">正在加载 Git 状态…</p>
    </div>
    <div v-else-if="gitIsRepo" class="git-panel-content">
      <div class="git-header git-section-card">
        <div class="git-header-row git-branch-row">
          <div class="git-branch-info">
            <span class="git-branch-icon" aria-hidden="true">⎇</span>
            <span class="git-branch-name" :title="gitBranch">{{ gitBranch }}</span>
            <span
              v-if="gitTrackingBranch && gitTrackingShortName() !== gitBranch"
              class="git-tracking-badge"
              :title="'跟踪: ' + gitTrackingBranch"
            >
              ⟶ {{ gitTrackingShortName() }}
            </span>
          </div>
          <div class="git-header-actions">
            <button type="button" class="ghost tiny" :disabled="gitLoading" @click="$emit('refresh')">刷新</button>
            <span
              v-if="fileWatcherActive"
              class="file-watcher-dot"
              :class="{ connected: fileWatcherConnected }"
              :title="fileWatcherConnected ? '文件监控已连接' : '文件监控重连中…'"
            />
          </div>
        </div>
        <div v-if="gitRemotes.length" class="git-header-row git-sync-row">
          <div class="git-sync-info">
            <span class="git-sync-stat" :class="{ ahead: gitAhead > 0 }">
              <span class="git-sync-arrow">↑</span>{{ gitAhead }}
            </span>
            <span class="git-sync-stat" :class="{ behind: gitBehind > 0 }">
              <span class="git-sync-arrow">↓</span>{{ gitBehind }}
            </span>
          </div>
          <div class="git-remote-actions">
            <button type="button" class="git-remote-btn" :disabled="!!gitRemoteAction" @click="$emit('do-fetch')">
              {{ gitRemoteAction === 'fetch' ? '…' : 'Fetch' }}
            </button>
            <button type="button" class="git-remote-btn" :disabled="!!gitRemoteAction" @click="$emit('do-pull')">
              {{ gitRemoteAction === 'pull' ? '…' : 'Pull' }}
            </button>
            <button type="button" class="git-remote-btn" :disabled="!!gitRemoteAction" @click="$emit('do-push')">
              {{ gitRemoteAction === 'push' ? '…' : 'Push' }}
            </button>
          </div>
        </div>
      </div>

      <div class="git-stash-section git-section-card">
        <button type="button" class="git-stash-collapse-toggle" @click="stashSectionOpen = !stashSectionOpen">
          <span class="git-section-chevron">{{ stashSectionOpen ? "▾" : "▸" }}</span>
          <span class="git-stash-icon">📦</span>
          <span class="git-stash-title">贮藏</span>
          <span v-if="gitStashes.length" class="git-stash-count">{{ gitStashes.length }}</span>
        </button>
        <div v-if="stashSectionOpen" class="git-stash-header">
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
        <div v-if="stashSectionOpen && gitStashes.length" class="git-stash-list">
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
        <div v-else-if="stashSectionOpen && gitStashAction === 'list'" class="git-stash-empty shimmer-text--fast">加载中…</div>
        <div v-else-if="stashSectionOpen" class="git-stash-empty">暂无贮藏</div>
      </div>

      <div v-if="gitError" class="git-error">{{ gitError }}</div>
      <div class="git-scroll-area">
        <div v-if="!gitStatus.length" class="git-changes-empty">
          <span class="git-changes-empty-icon" aria-hidden="true">✓</span>
          <span>工作区干净，无本地改动</span>
        </div>
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
                @contextmenu.prevent="$emit('on-git-file-contextmenu', $event, file.path)"
              >
                <span class="git-file-check" @pointerdown.stop @click.stop="$emit('unstage-file', file.path)">✓</span>
                <span class="git-file-status" :class="gitStatusClass(file.status)">
                  {{ gitStatusIcon(file.status) }}
                </span>
                <span class="git-file-path" :title="file.path">
                  <span v-if="filePathParts(file.path).dir" class="git-file-dir">{{ filePathParts(file.path).dir }}</span>
                  <span class="git-file-name">{{ filePathParts(file.path).name }}</span>
                </span>
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
                @contextmenu.prevent="$emit('on-git-file-contextmenu', $event, file.path)"
              >
                <span class="git-file-check" @pointerdown.stop @click.stop="$emit('stage-file', file.path)">+</span>
                <span class="git-file-status" :class="gitStatusClass(file.status)">
                  {{ gitStatusIcon(file.status) }}
                </span>
                <span class="git-file-path" :title="file.path">
                  <span v-if="filePathParts(file.path).dir" class="git-file-dir">{{ filePathParts(file.path).dir }}</span>
                  <span class="git-file-name">{{ filePathParts(file.path).name }}</span>
                </span>
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
                    <span class="git-file-status" :class="gitStatusClass(file.status)">
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
      <div class="git-commit-box git-section-card">
        <div class="git-commit-title-row">
          <span class="git-commit-title">提交</span>
          <span v-if="gitStagedFiles.length" class="git-commit-staged-badge">{{ gitStagedFiles.length }} 已暂存</span>
        </div>
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
          <div class="git-commit-primary-row">
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
              class="small git-commit-btn"
              :class="canGitCommit ? 'primary' : 'secondary'"
              :disabled="!canGitCommit || !!gitAiPushStep"
              :title="canGitCommit ? 'Ctrl+Enter 提交' : '请先填写提交信息'"
              @click="$emit('commit-git')"
            >
              {{ gitCommitting ? "提交中…" : `提交 (${gitStagedFiles.length})` }}
            </button>
          </div>
          <button
            type="button"
            class="small git-ai-push"
            :disabled="gitCommitting || !!gitGenStep || !!gitAiPushStep || !gitStagedFiles.length || !configReady"
            @click="$emit('ai-commit-and-push')"
          >
            {{ gitAiPushStep || "✦ 一键推送" }}
          </button>
        </div>
      </div>
    </div>
    <div v-else-if="gitError" class="panel-empty git-panel-fetch-error">
      <p>获取 Git 状态失败</p>
      <p class="git-fetch-error-detail">{{ gitError }}</p>
      <button type="button" class="secondary small" @click="$emit('refresh')">重试</button>
    </div>
    <div v-else-if="gitStatusKnown" class="panel-empty">当前目录不是 Git 仓库</div>
    <div v-else class="panel-empty shimmer-text--fast">加载中…</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { GitRemoteInfo } from "../../services/vibeGitClient";

interface GitStash {
  index: number | string;
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
  gitRemotes: GitRemoteInfo[];
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

const props = defineProps<Props>();

const stashSectionOpen = ref(false);

watch(
  () => props.gitStashes.length,
  (count, prev) => {
    if (count > 0 && (prev ?? 0) === 0) stashSectionOpen.value = true;
  },
);

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
  (e: "on-git-file-contextmenu", event: MouseEvent, path: string): void;
}>();

function isGitLogEntryOpen(hash: string): boolean {
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

function gitTrackingShortName(): string {
  return props.gitTrackingBranch.replace(/^[^/]+\//, "");
}

function filePathParts(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return { dir: "", name: path };
  return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

function gitStatusClass(status: string): string {
  switch (status) {
    case "added": return "git-status-added";
    case "modified": return "git-status-modified";
    case "deleted": return "git-status-deleted";
    case "renamed":
    case "copied": return "git-status-renamed";
    default: return "git-status-unknown";
  }
}
</script>

<style scoped>
.git-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
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
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.git-section-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  padding: 10px 12px;
}

.git-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.git-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.git-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.git-branch-row {
  flex-wrap: nowrap;
}

.git-branch-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.git-branch-icon {
  font-size: 13px;
  color: rgba(139, 148, 158, 0.6);
}

.git-branch-name {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-tracking-badge {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
  padding: 2px 6px;
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
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.git-sync-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.git-sync-stat {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: rgba(139, 148, 158, 0.75);
  min-width: 28px;
}

.git-sync-stat.ahead {
  color: #3fb950;
}

.git-sync-stat.behind {
  color: #d29922;
}

.git-sync-arrow {
  font-size: 11px;
  opacity: 0.85;
}

.git-remote-actions {
  display: flex;
  gap: 4px;
}

.git-remote-btn {
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.git-remote-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.95);
}

.git-remote-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.git-stash-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.git-stash-collapse-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.82);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.git-stash-collapse-toggle:hover {
  color: rgba(255, 255, 255, 0.95);
}

.git-stash-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.git-stash-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.git-stash-icon {
  font-size: 12px;
  line-height: 1;
}

.git-stash-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.git-stash-count {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.6);
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
}

.git-stash-save-row {
  display: flex;
  gap: 6px;
}

.git-stash-msg-input {
  flex: 1;
  box-sizing: border-box;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

.git-stash-msg-input:focus {
  outline: none;
  border-color: rgba(88, 166, 255, 0.5);
}

.git-stash-msg-input:disabled {
  opacity: 0.4;
}

.stash-save-btn {
  flex-shrink: 0;
}

.git-stash-list {
  margin-top: 8px;
}

.git-stash-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.git-section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  padding: 3px 0;
  font-size: 12px;
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
  gap: 10px;
  padding: 6px 8px;
  font-size: 12px;
  border-radius: 4px;
  transition: background 120ms ease;
}

.git-stash-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.git-stash-label {
  color: #bb9af7;
  font-family: monospace;
  font-size: 11px;
  background: rgba(187, 154, 247, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
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
  gap: 6px;
}

.git-stash-empty {
  color: rgba(139, 148, 158, 0.55);
  font-size: 11px;
  padding: 0 0 2px 16px;
}

.git-error {
  padding: 8px 10px;
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.3);
  border-radius: 4px;
  color: #ff9a9a;
  font-size: 12px;
}

.git-commit-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.git-commit-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.git-commit-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.git-commit-staged-badge {
  font-size: 11px;
  color: #7ee787;
  background: rgba(63, 185, 80, 0.12);
  border: 1px solid rgba(63, 185, 80, 0.22);
  border-radius: 999px;
  padding: 1px 8px;
}

.git-commit-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.9);
  resize: vertical;
  min-height: 44px;
  font-family: inherit;

  /* 滚动条优化 —— 与全局一致的半透明滑块 + 圆角 */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.git-commit-input::-webkit-scrollbar {
  width: 5px;
}
.git-commit-input::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 999px;
}
.git-commit-input::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.git-commit-input:focus {
  outline: none;
  border-color: rgba(88, 166, 255, 0.5);
}

.git-commit-input:disabled {
  opacity: 0.4;
}

.git-commit-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.git-commit-primary-row {
  display: flex;
  gap: 6px;
}

.git-commit-primary-row .git-commit-ai {
  flex: 1;
  min-width: 0;
}

.git-commit-primary-row .git-commit-btn {
  flex: 1.2;
  min-width: 0;
}

.git-ai-push {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
}

.git-ai-push:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.1);
  border-color: rgba(88, 166, 255, 0.28);
  color: rgba(147, 197, 253, 0.95);
}

.git-changes-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 12px;
  color: rgba(139, 148, 158, 0.65);
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.git-changes-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 10px;
  color: #3fb950;
  background: rgba(63, 185, 80, 0.12);
  flex-shrink: 0;
}

.git-scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.git-scroll-area::-webkit-scrollbar {
  width: 5px;
}

.git-scroll-area::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.git-scroll-area::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.git-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.git-section-head {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
}

.git-section-toggle {
  min-width: 0;
  flex: 1;
}

.git-section-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-section-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  justify-content: flex-end;
  margin-left: auto;
  flex-shrink: 0;
}

.git-section-actions button.ghost.tiny {
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.git-section-head > .ghost.tiny {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 11px;
  white-space: nowrap;
}

.git-file-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
}

.git-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 12px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 120ms ease;
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
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: rgba(139, 148, 158, 0.7);
  cursor: pointer;
  border-radius: 4px;
  border: 1px solid transparent;
  flex-shrink: 0;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}

.git-file-check:hover {
  color: rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
}

.git-file-status {
  font-size: 10px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
}

.git-status-added {
  color: #3fb950;
  background: rgba(63, 185, 80, 0.14);
}

.git-status-modified {
  color: #d29922;
  background: rgba(210, 153, 34, 0.14);
}

.git-status-deleted {
  color: #f85149;
  background: rgba(248, 81, 73, 0.14);
}

.git-status-renamed {
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.14);
}

.git-status-unknown {
  color: #8b949e;
  background: rgba(139, 148, 158, 0.12);
}

.git-file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: baseline;
}

.git-file-dir {
  color: rgba(139, 148, 158, 0.55);
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.git-file-name {
  color: rgba(255, 255, 255, 0.88);
  flex-shrink: 0;
  font-weight: 500;
}

.git-file-btn {
  opacity: 0;
  transition: opacity 0.15s;
}

.git-file-item:hover .git-file-btn {
  opacity: 1;
}

.git-log-section {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.git-log-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
}

.git-log-list {
  margin-top: 8px;
}

.git-log-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.git-log-entry-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 12px;
  color: rgba(139, 148, 158, 0.6);
  word-break: break-all;
}

.ghost {
  background: none;
  border: none;
  color: rgba(139, 148, 158, 0.8);
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 13px;
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
  padding: 3px 8px;
  font-size: 12px;
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
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 5px;
  border: none;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.small:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
