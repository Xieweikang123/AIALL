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
        v-if="!projectOpened"
        :value="projectPath"
        class="path-input"
        type="text"
        placeholder="项目路径"
        @input="$emit('update:projectPath', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('open-project-by-input')"
      />
      <span v-else class="path-current" :title="projectPath">{{ currentFolderName }}</span>
      <button type="button" class="primary compact" :disabled="pickingFolder || loadingTree" @click="$emit('handle-open-project')">
        {{ pickingFolder ? "选择…" : loadingTree ? "" : projectOpened ? "切换" : "打开项目" }}<span v-if="loadingTree" class="shimmer-text--fast">加载中</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        :disabled="!projectOpened || !projectPath.trim()"
        title="在文件管理器中打开"
        @click="$emit('open-folder-in-explorer')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 4.8A1.3 1.3 0 0 1 3.8 3.5h3.2l1.2 1.3h4.5A1.3 1.3 0 0 1 14 6.1v6.4a1.3 1.3 0 0 1-1.3 1.3H3.8A1.3 1.3 0 0 1 2.5 12.5V4.8Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
          <path d="M10.5 8.5 12 10l-3.5 3.5L6 11" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button type="button" class="icon-btn" :disabled="!projectPath.trim()" @click="$emit('refresh-tree')" title="刷新文件树">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.65 2.35A7.96 7.96 0 0 0 8 0a8 8 0 1 0 8 8h-2A6 6 0 1 1 8 2c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35Z" fill="currentColor"/></svg>
      </button>
    </div>
    <div class="toolbar-actions">
      <div v-if="treeError || retryCountdown > 0" class="toolbar-error" role="alert">
        <span v-if="retryCountdown > 0" class="toolbar-error-countdown">⟳</span>
        <span class="toolbar-error-text" v-if="retryCountdown > 0">{{ treeError ? treeError.replace(/。?$/, ' ') : '无法连接后端服务，' }}<span class="shimmer-text--fast">正在重试… {{ retryCountdown }}s</span></span>
        <span class="toolbar-error-text" v-else>{{ treeError }}</span>
        <button type="button" class="toolbar-error-dismiss" aria-label="关闭提示" @click="$emit('clear-retry'); $emit('update:treeError', '')">
          ×
        </button>
      </div>
      <div ref="projectHistoryRef" class="project-history-wrap">
        <button
          type="button"
          class="project-history-trigger"
          :class="{ open: projectHistoryOpen, active: projectOpened }"
          :disabled="loadingTree || pickingFolder"
          :title="projectPath || '最近打开的项目'"
          @click="toggleProjectHistory"
        >
          <svg class="project-history-trigger-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.5 4.8A1.3 1.3 0 0 1 3.8 3.5h3.2l1.2 1.3h4.5A1.3 1.3 0 0 1 14 6.1v6.4a1.3 1.3 0 0 1-1.3 1.3H3.8A1.3 1.3 0 0 1 2.5 12.5V4.8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          <span class="project-history-trigger-label">{{ projectTriggerLabel }}</span>
          <span v-if="projectHistoryList.length > 1" class="project-history-badge">{{ projectHistoryList.length }}</span>
          <span class="project-history-chevron" aria-hidden="true">{{ projectHistoryOpen ? "▴" : "▾" }}</span>
        </button>
        <Teleport to="body">
        <div v-if="projectHistoryOpen" class="project-history-dropdown" :style="{ position: 'fixed', top: dropdownTop + 'px', right: dropdownRight + 'px' }">
          <div class="project-history-head">
            <div>
              <h3 class="project-history-title">{{ projectHistoryList.length > 1 ? "切换项目" : "最近打开的项目" }}</h3>
              <p class="project-history-desc">点击切换，或从历史中移除</p>
            </div>
            <button
              v-if="projectHistoryList.length"
              type="button"
              class="ghost small project-history-clear"
              @click="clearRecentProjects"
            >
              清空
            </button>
          </div>
          <div v-if="!projectHistoryList.length" class="project-history-empty">
            <svg class="project-history-empty-icon" width="32" height="32" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2.5 4.8A1.3 1.3 0 0 1 3.8 3.5h3.2l1.2 1.3h4.5A1.3 1.3 0 0 1 14 6.1v6.4a1.3 1.3 0 0 1-1.3 1.3H3.8A1.3 1.3 0 0 1 2.5 12.5V4.8Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
            </svg>
            <p>还没有打开过项目</p>
          </div>
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
                <span class="project-history-item-icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2.5 4.8A1.3 1.3 0 0 1 3.8 3.5h3.2l1.2 1.3h4.5A1.3 1.3 0 0 1 14 6.1v6.4a1.3 1.3 0 0 1-1.3 1.3H3.8A1.3 1.3 0 0 1 2.5 12.5V4.8Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
                  </svg>
                </span>
                <span class="project-history-item-body">
                  <span class="project-history-item-top">
                    <span class="project-history-item-title">{{ item.displayName }}</span>
                    <span v-if="isCurrentProject(item.path)" class="project-history-item-badge">当前</span>
                    <span class="project-history-item-meta">{{ formatSessionTime(item.lastOpenedAt) }}</span>
                  </span>
                  <span class="project-history-item-path" :title="item.path">{{ item.path }}</span>
                </span>
              </button>
              <button
                type="button"
                class="project-history-delete"
                title="从历史中移除"
                aria-label="从历史中移除"
                @click="removeRecentProject(item.path, $event)"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 4l8 8M12 4 4 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
              </button>
            </li>
          </ul>
          <div class="project-history-footer">
            <button
              type="button"
              class="project-history-open-new"
              :disabled="loadingTree || pickingFolder"
              @click="openNewProject"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
              打开新项目
            </button>
          </div>
        </div>
        </Teleport>
      </div>
      <div class="toolbar-sep" />
      <nav class="toolbar-nav" aria-label="快捷导航">
        <button type="button" class="toolbar-nav-btn" title="AI 对话" @click="router.push('/chat')">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v5A1.5 1.5 0 0 1 12.5 10H8l-3 2.5V10H3.5A1.5 1.5 0 0 1 2 8.5v-5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          <span class="toolbar-nav-label">对话</span>
        </button>
        <button type="button" class="toolbar-nav-btn" title="AI 配置" @click="router.push('/ai-config')">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/>
            <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          <span class="toolbar-nav-label">配置</span>
        </button>
        <button type="button" class="toolbar-nav-btn" title="通知测试" @click="$emit('test-notification')">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1.8c-2.2 0-3.5 1.8-3.5 4v2.2L3.2 10.5h9.6L11.5 8V5.8c0-2.2-1.3-4-3.5-4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </nav>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
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
  (e: "open-folder-in-explorer"): void;
  (e: "test-notification"): void;
}>();

const router = useRouter();
const projectHistoryOpen = ref(false);
const projectHistoryList = ref<ProjectHistoryEntry[]>([]);
const projectHistoryRef = ref<HTMLElement | null>(null);

const currentFolderName = computed(() => {
  const current = projectHistoryList.value.find((item) => isCurrentProject(item.path));
  if (current) return current.displayName;
  const trimmed = props.projectPath.trim();
  if (!trimmed) return "未选择项目";
  const parts = trimmed.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || trimmed;
});

const projectTriggerLabel = computed(() => {
  if (props.projectOpened && props.projectPath.trim()) return currentFolderName.value;
  return "最近项目";
});

function isCurrentProject(path: string): boolean {
  const current = props.projectPath.trim();
  if (!current || !path.trim()) return false;
  const norm = (p: string) => p.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  return norm(current) === norm(path);
}

const dropdownTop = ref(0);
const dropdownRight = ref(0);

function updateDropdownPosition() {
  if (projectHistoryRef.value) {
    const rect = projectHistoryRef.value.getBoundingClientRect();
    dropdownTop.value = rect.bottom + 4;
    dropdownRight.value = window.innerWidth - rect.right;
  }
}

function toggleProjectHistory() {
  projectHistoryOpen.value = !projectHistoryOpen.value;
  if (projectHistoryOpen.value) {
    nextTick(updateDropdownPosition);
  }
  if (projectHistoryOpen.value) refreshProjectHistoryList();
}

function closeProjectHistory() {
  projectHistoryOpen.value = false;
}

/** 点击下拉面板外部时自动关闭 */
function handleOutsideClick(e: MouseEvent) {
  if (!projectHistoryOpen.value) return;
  const wrap = projectHistoryRef.value;
  // Teleport 后下拉菜单在 body 上，需同时检查 dropdown 自身
  const dropdownEl = document.querySelector('.project-history-dropdown');
  const target = e.target as Node;
  const insideWrap = wrap && wrap.contains(target);
  const insideDropdown = dropdownEl && dropdownEl.contains(target);
  if (!insideWrap && !insideDropdown) {
    closeProjectHistory();
  }
}

onMounted(() => {
  refreshProjectHistoryList();
  document.addEventListener("mousedown", handleOutsideClick, true);
});

watch(
  () => props.projectPath,
  () => {
    refreshProjectHistoryList();
  },
);

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleOutsideClick, true);
});

function openNewProject() {
  closeProjectHistory();
  emit("handle-open-project");
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
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.icon-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: none;
}

.icon-btn:disabled {
  opacity: 0.3;
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

.project-history-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.project-history-trigger:hover:not(:disabled),
.project-history-trigger.open {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.92);
}

.project-history-trigger.active {
  border-color: rgba(31, 111, 235, 0.28);
  background: rgba(31, 111, 235, 0.1);
}

.project-history-trigger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.project-history-trigger-icon {
  flex-shrink: 0;
  opacity: 0.75;
}

.project-history-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-weight: 500;
}

.project-history-badge {
  flex-shrink: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.65);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
}

.project-history-chevron {
  flex-shrink: 0;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.45);
}

.path-current {
  flex: 1;
  min-width: 0;
  max-width: 220px;
  padding: 0 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-history-footer {
  padding: 8px 10px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.project-history-open-new {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.project-history-open-new:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.1);
  border-color: rgba(88, 166, 255, 0.28);
  color: #c9e4ff;
}

.project-history-open-new:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.project-history-dropdown {
  width: min(420px, calc(100vw - 24px));
  max-height: min(420px, calc(100vh - 80px));
  overflow-y: auto;
  background: rgba(17, 24, 39, 0.96);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: var(--shadow-panel, 0 8px 32px rgba(0, 0, 0, 0.35));
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
  align-items: flex-start;
  gap: 12px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.project-history-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.project-history-desc {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.85);
  margin: 3px 0 0;
  line-height: 1.4;
}

.project-history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 20px;
  text-align: center;
  color: rgba(139, 148, 158, 0.8);
  font-size: 12px;
}

.project-history-empty p {
  margin: 0;
}

.project-history-empty-icon {
  color: rgba(139, 148, 158, 0.45);
}

.project-history-list {
  list-style: none;
  padding: 6px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.project-history-item {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  border-radius: 8px;
  position: relative;
  transition: background 0.12s ease;
}

.project-history-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.project-history-item.active {
  background: rgba(88, 166, 255, 0.12);
}

.project-history-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 56%;
  min-height: 18px;
  border-radius: 0 2px 2px 0;
  background: #58a6ff;
}

.project-history-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  background: none;
  border: none;
  padding: 8px 6px 8px 10px;
  cursor: pointer;
  color: inherit;
}

.project-history-item-main:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.project-history-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 7px;
  background: rgba(210, 153, 34, 0.14);
  color: #d29922;
}

.project-history-item.active .project-history-item-icon {
  background: rgba(88, 166, 255, 0.18);
  color: #79c0ff;
}

.project-history-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.project-history-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.project-history-item-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.project-history-item-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(88, 166, 255, 0.18);
  color: #79c0ff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
}

.project-history-item-path {
  font-size: 11px;
  color: rgba(139, 148, 158, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.35;
}

.project-history-item-meta {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 10px;
  color: rgba(139, 148, 158, 0.65);
  font-variant-numeric: tabular-nums;
}

.project-history-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  margin-right: 4px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(139, 148, 158, 0.55);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}

.project-history-item:hover .project-history-delete,
.project-history-item.active .project-history-delete,
.project-history-delete:focus-visible {
  opacity: 1;
}

.project-history-delete:hover {
  background: rgba(248, 81, 73, 0.14);
  color: #ff9a9a;
}

.project-history-clear {
  flex-shrink: 0;
  color: rgba(139, 148, 158, 0.85);
}

.project-history-clear:hover {
  background: rgba(248, 81, 73, 0.1);
  color: #ff9a9a;
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

.toolbar-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.toolbar-nav-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
}

.toolbar-nav-label {
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

@media (max-width: 960px) {
  .toolbar-nav-label {
    display: none;
  }

  .toolbar-nav-btn {
    padding: 5px 7px;
  }
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
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent-color) 70%, #000) 0%, color-mix(in srgb, #5b9cf6 60%, #000) 100%);
  color: rgba(255, 255, 255, 0.92);
  border: none;
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(31, 111, 235, 0.2);
  letter-spacing: 0.3px;
}

.primary:hover {
  background: linear-gradient(135deg, var(--accent-color) 0%, #5b9cf6 100%);
  color: white;
  box-shadow: 0 3px 10px rgba(31, 111, 235, 0.35);
  transform: translateY(-1px);
}

.primary:active {
  transform: translateY(0) scale(0.98);
  box-shadow: 0 1px 4px rgba(31, 111, 235, 0.3);
}

.primary:disabled {
  opacity: 0.45;
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
