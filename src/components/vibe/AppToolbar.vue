<template>
  <header class="app-toolbar">
    <div class="toolbar-brand">
      <span class="brand-icon" aria-hidden="true">⚡</span>
      <h1 class="title">Vibe Coding✨</h1>
    </div>
    <div class="toolbar-project">
      <input
        :value="projectPath"
        class="path-input"
        type="text"
        placeholder="输入项目路径，或点击「打开项目」"
        @input="$emit('update:projectPath', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('open-project-by-input')"
      />
      <button type="button" class="primary compact" :disabled="pickingFolder || loadingTree" @click="$emit('handle-open-project')">
        {{ pickingFolder ? "选择…" : loadingTree ? "加载中" : "打开项目" }}
      </button>
      <button type="button" class="secondary compact" :disabled="!projectPath.trim()" @click="$emit('refresh-tree')" title="刷新文件树">↻</button>
    </div>
    <div class="toolbar-actions">
      <div ref="projectHistoryRef" class="project-history-wrap">
        <button
          type="button"
          class="ghost small"
          :disabled="loadingTree || pickingFolder"
          @click="toggleProjectHistory"
        >
          最近
        </button>
        <div v-if="projectHistoryOpen" class="project-history-dropdown">
          <div class="project-history-head">
            <div>
              <h3 class="project-history-title">最近打开的项目</h3>
              <p class="project-history-desc">点击可快速重新打开</p>
            </div>
            <button
              v-if="projectHistoryList.length"
              type="button"
              class="ghost small"
              @click="clearRecentProjects"
            >
              清空
            </button>
          </div>
          <div v-if="!projectHistoryList.length" class="project-history-empty">还没有打开过项目</div>
          <ul v-else class="project-history-list">
            <li
              v-for="item in projectHistoryList"
              :key="item.path"
              class="project-history-item"
              :class="{ active: isCurrentProject(item.path) }"
            >
              <button
                type="button"
                class="project-history-item-main"
                :disabled="loadingTree || pickingFolder"
                @click="openRecentProject(item.path)"
              >
                <span class="project-history-item-title">{{ item.displayName }}</span>
                <span class="project-history-item-path" :title="item.path">{{ item.path }}</span>
                <span class="project-history-item-meta">{{ formatSessionTime(item.lastOpenedAt) }}</span>
              </button>
              <button
                type="button"
                class="ghost small project-history-delete"
                title="从历史中移除"
                @click="removeRecentProject(item.path, $event)"
              >
                移除
              </button>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="treeError || retryCountdown > 0" class="toolbar-error" role="alert">
        <span v-if="retryCountdown > 0" class="toolbar-error-countdown">⟳</span>
        <span class="toolbar-error-text">{{ retryCountdown > 0 ? (treeError ? treeError.replace(/。?$/, ' ') : '无法连接后端服务，') + `正在重试… ${retryCountdown}s` : treeError }}</span>
        <button type="button" class="toolbar-error-dismiss" aria-label="关闭提示" @click="$emit('clear-retry'); $emit('update:treeError', '')">
          ×
        </button>
      </div>
      <router-link class="ghost small link-btn" to="/chat">AI 对话</router-link>
      <router-link class="ghost small link-btn" to="/ai-config">配置</router-link>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  listProjectHistory,
  removeProjectFromHistory,
  clearProjectHistory,
  type ProjectHistoryEntry,
} from "../../services/vibeProjectHistory";

interface Props {
  projectPath: string;
  loadingTree: boolean;
  pickingFolder: boolean;
  treeError: string;
  retryCountdown: number;
  projectOpened: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:projectPath", value: string): void;
  (e: "open-project-by-input"): void;
  (e: "handle-open-project"): void;
  (e: "refresh-tree"): void;
  (e: "clear-retry"): void;
  (e: "update:treeError", value: string): void;
  (e: "open-recent-project", path: string): void;
}>();

const projectHistoryOpen = ref(false);
const projectHistoryList = ref<ProjectHistoryEntry[]>([]);
const projectHistoryRef = ref<HTMLElement | null>(null);

function isCurrentProject(path: string): boolean {
  const current = props.projectPath.trim();
  if (!current || !path.trim()) return false;
  const norm = (p: string) => p.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  return norm(current) === norm(path);
}

function toggleProjectHistory() {
  projectHistoryOpen.value = !projectHistoryOpen.value;
  if (projectHistoryOpen.value) refreshProjectHistoryList();
}

function closeProjectHistory() {
  projectHistoryOpen.value = false;
}

function openRecentProject(path: string) {
  closeProjectHistory();
  emit("open-recent-project", path);
}

function removeRecentProject(path: string, event?: MouseEvent) {
  event?.stopPropagation();
  removeProjectFromHistory(path);
  refreshProjectHistoryList();
}

function clearRecentProjects() {
  clearProjectHistory();
  refreshProjectHistoryList();
}

function refreshProjectHistoryList() {
  projectHistoryList.value = listProjectHistory();
}

function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<style scoped>
.app-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  height: 48px;
  flex-shrink: 0;
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.brand-icon {
  font-size: 18px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
}

.toolbar-project {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  max-width: 500px;
}

.path-input {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.path-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.project-history-wrap {
  position: relative;
}

.project-history-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  width: 400px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  margin-top: 4px;
}

.project-history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
}

.project-history-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
}

.project-history-desc {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 2px 0 0;
}

.project-history-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
}

.project-history-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.project-history-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.project-history-item:last-child {
  border-bottom: none;
}

.project-history-item.active {
  background: var(--bg-tertiary);
}

.project-history-item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.project-history-item-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.project-history-item-path {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-history-item-meta {
  font-size: 10px;
  color: var(--text-tertiary);
}

.project-history-delete {
  margin-left: 8px;
}

.toolbar-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 4px;
  font-size: 12px;
  color: var(--error-text);
}

.toolbar-error-countdown {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.toolbar-error-dismiss {
  background: none;
  border: none;
  color: var(--error-text);
  cursor: pointer;
  padding: 0;
  font-size: 14px;
  line-height: 1;
}

.link-btn {
  text-decoration: none;
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

.ghost.small {
  padding: 2px 6px;
  font-size: 11px;
}

.primary {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.primary:hover {
  background: var(--accent-hover);
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary.compact {
  padding: 4px 8px;
}

.secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.secondary:hover {
  background: var(--bg-secondary);
}

.secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary.compact {
  padding: 4px 8px;
}
</style>
