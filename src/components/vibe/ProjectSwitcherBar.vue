<template>
  <div v-if="projectList.length > 0" class="project-switcher-bar">
    <div class="project-tabs">
      <button
        v-for="item in projectList"
        :key="item.path"
        type="button"
        class="project-tab"
        :class="{ active: isActive(item.path), loading: loadingTree && isActive(item.path) }"
        :disabled="loadingTree && !isActive(item.path)"
        :title="item.path"
        @click="$emit('switch-project', item.path)"
      >
        <span class="project-tab-icon" aria-hidden="true">{{ isActive(item.path) ? '⚡' : '📁' }}</span>
        <span class="project-tab-name">{{ item.displayName }}</span>
        <span
          v-if="isActive(item.path) && loadingTree"
          class="project-tab-spinner"
        >⟳</span>
        <button
          type="button"
          class="project-tab-close"
          title="从列表移除"
          @click.stop="$emit('remove-project', item.path)"
        >×</button>
      </button>
    </div>
    <button
      type="button"
      class="project-tab-add"
      :disabled="pickingFolder || loadingTree"
      title="打开新项目"
      @click="$emit('open-new-project')"
    >
      +
    </button>
  </div>
</template>

<script setup lang="ts">
import { watch } from "vue";
import type { ProjectHistoryEntry } from "../../services/vibeProjectHistory";

interface Props {
  projectList: ProjectHistoryEntry[];
  currentPath: string;
  loadingTree: boolean;
  pickingFolder: boolean;
}

const props = defineProps<Props>();

// #region agent log
watch(() => props.projectList, (list) => {
  console.log('[DBG][TAB][ProjectSwitcherBar] props.projectList changed', { count: list.length, items: list.map(p => p.displayName) });
}, { immediate: true });
// #endregion

defineEmits<{
  (e: "switch-project", path: string): void;
  (e: "remove-project", path: string): void;
  (e: "open-new-project"): void;
}>();

function normalize(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

function isActive(path: string): boolean {
  const current = props.currentPath.trim();
  if (!current || !path.trim()) return false;
  return normalize(current) === normalize(path);
}
</script>

<style scoped>
.project-switcher-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 16px;
  background: rgba(11, 18, 32, 0.92);
  border-bottom: 1px solid var(--border);
  min-height: 24px;
  flex-shrink: 0;
  overflow: hidden;
}

.project-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.project-tabs::-webkit-scrollbar {
  display: none;
}

.project-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 200px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.project-tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.project-tab.active {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--primary);
  color: var(--text);
  font-weight: 500;
  box-shadow: 0 0 0 1px rgba(31, 111, 235, 0.5);
}

.project-tab.loading {
  opacity: 0.7;
}

.project-tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.project-tab-icon {
  font-size: 10px;
  flex-shrink: 0;
}

.project-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-tab-spinner {
  font-size: 10px;
  animation: spin 1s linear infinite;
}

.project-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  flex-shrink: 0;
}

.project-tab:hover .project-tab-close {
  opacity: 1;
}

.project-tab-close:hover {
  background: rgba(255, 77, 94, 0.15);
  color: var(--danger);
}

.project-tab-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px dashed var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.project-tab-add:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  border-color: var(--primary);
}

.project-tab-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
