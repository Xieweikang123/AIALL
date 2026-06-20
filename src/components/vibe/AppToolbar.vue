<template>
  <header class="app-toolbar">
    <div class="toolbar-brand">
      <div class="toolbar-logo" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          <path d="M12 12 3 7m9-5 9 5M12 12v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        </svg>
      </div>
      <h1 class="title">Vibe Coding</h1>
    </div>
    <div class="toolbar-sep" />
    <div class="toolbar-project">
      <input
        :value="projectPath"
        class="path-input"
        type="text"
        placeholder="项目路径"
        @input="$emit('update:projectPath', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('open-project-by-input')"
      />
      <button type="button" class="primary compact" :disabled="pickingFolder || loadingTree" @click="$emit('handle-open-project')">
        {{ pickingFolder ? "选择…" : loadingTree ? "加载中" : "打开项目" }}
      </button>
      <button type="button" class="icon-btn" :disabled="!projectPath.trim()" @click="$emit('refresh-tree')" title="刷新文件树">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.65 2.35A7.96 7.96 0 0 0 8 0a8 8 0 1 0 8 8h-2A6 6 0 1 1 8 2c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35Z" fill="currentColor"/></svg>
      </button>
    </div>
    <div class="toolbar-actions">
      <div v-if="treeError || retryCountdown > 0" class="toolbar-error" role="alert">
        <span v-if="retryCountdown > 0" class="toolbar-error-countdown">⟳</span>
        <span class="toolbar-error-text">{{ retryCountdown > 0 ? (treeError ? treeError.replace(/。?$/, ' ') : '无法连接后端服务，') + `正在重试… ${retryCountdown}s` : treeError }}</span>
        <button type="button" class="toolbar-error-dismiss" aria-label="关闭提示" @click="$emit('clear-retry'); $emit('update:treeError', '')">
          ×
        </button>
      </div>
      <div ref="projectHistoryRef" class="project-history-wrap">
        <button
          type="button"
          class="ghost small"
          :disabled="loadingTree || pickingFolder"
          @click="toggleProjectHistory"
        >
          最近项目
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
      <div class="toolbar-sep" />
      <button type="button" class="ghost small link-btn" @click="router.push('/chat')">AI 对话</button>
      <button type="button" class="ghost small link-btn" @click="router.push('/ai-config')">配置</button>
      <button type="button" class="ghost small link-btn" @click="$emit('test-notification')" title="测试系统通知">🔔 通知测试</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
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

const router = useRouter();
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

/** 点击下拉面板外部时自动关闭 */
function handleOutsideClick(e: MouseEvent) {
  if (!projectHistoryOpen.value) return;
  const wrap = projectHistoryRef.value;
  if (wrap && !wrap.contains(e.target as Node)) {
    closeProjectHistory();
  }
}

onMounted(() => {
  document.addEventListener("mousedown", handleOutsideClick, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleOutsideClick, true);
});

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
  padding: 0 16px;
  background: rgba(11, 18, 32, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  height: 44px;
  flex-shrink: 0;
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.toolbar-logo {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(31, 111, 235, 0.3), rgba(130, 80, 223, 0.25));
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #91beff;
}

.title {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  white-space: nowrap;
  overflow: visible;
  letter-spacing: -0.3px;
  color: var(--text-primary);
}

.toolbar-sep {
  width: 1px;
  height: 18px;
  background: var(--border-color);
  flex-shrink: 0;
  opacity: 0.5;
}

.toolbar-project {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.path-input {
  flex: 1;
  max-width: 420px;
  min-width: 0;
  padding: 5px 10px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.path-input:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 2px rgba(var(--accent-color-rgb, 99, 102, 241), 0.15);
}

.path-input::placeholder {
  color: var(--text-tertiary);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--accent-color);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
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
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
}

.project-history-dropdown::-webkit-scrollbar {
  width: 6px;
}

.project-history-dropdown::-webkit-scrollbar-track {
  background: transparent;
}

.project-history-dropdown::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.3);
  border-radius: 3px;
  transition: background 0.2s ease;
}

.project-history-dropdown::-webkit-scrollbar-thumb:hover {
  background: rgba(128, 128, 128, 0.5);
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
  font-weight: 500;
  position: relative;
  z-index: 1;
  pointer-events: auto;
}

.link-btn:hover {
  text-decoration: none;
}

.ghost {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.ghost:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.ghost:active {
  transform: scale(0.97);
}

.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.ghost.small {
  padding: 5px 10px;
  font-size: 11.5px;
  letter-spacing: 0.2px;
}

.primary {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.primary:hover {
  background: var(--accent-hover);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
}

.primary:active {
  transform: scale(0.97);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.primary.compact {
  padding: 6px 14px;
}

.secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.secondary:hover {
  background: var(--bg-secondary);
}

.secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary.compact {
  padding: 5px 10px;
  font-size: 13px;
  line-height: 1;
}
</style>
