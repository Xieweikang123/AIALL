<template>
  <div v-if="projectList.length > 0" class="project-switcher-bar">
    <div class="project-tabs">
      <button
        v-for="item in projectList"
        :key="item.path"
        type="button"
        class="project-tab"
        :class="{ active: isActive(item.path), loading: loadingTree && isActive(item.path) }"
        :disabled="loadingTree && !isActive(item.path) || (chatSending && !isActive(item.path))"
        :title="item.path"
        @click="$emit('switch-project', item.path)"
      >
        <span v-if="isActive(item.path)" class="project-tab-dot" aria-hidden="true" />
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
      :disabled="pickingFolder || loadingTree || chatSending"
      title="打开新项目"
      @click="$emit('open-new-project')"
    >
      +
    </button>
  </div>
</template>

<script setup lang="ts">
import { watch, withDefaults } from "vue";
import type { ProjectHistoryEntry } from "../../services/vibeProjectHistory";

interface Props {
  projectList: ProjectHistoryEntry[];
  currentPath: string;
  loadingTree: boolean;
  pickingFolder: boolean;
  chatSending?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  chatSending: false,
});

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
  padding: 0 12px;
  background: rgba(11, 18, 32, 0.6);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  height: 34px;
  flex-shrink: 0;
  overflow: hidden;
}

.project-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
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
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 200px;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.project-tab:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.88);
}

.project-tab.active {
  background: rgba(31, 111, 235, 0.14);
  border-color: rgba(31, 111, 235, 0.28);
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
}

.project-tab.loading {
  opacity: 0.7;
}

.project-tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.project-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary, #1f6feb);
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
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.project-tab:hover .project-tab-close {
  opacity: 1;
}

.project-tab-close:hover {
  background: rgba(255, 77, 94, 0.15);
  color: var(--danger, #ff4d5e);
}

.project-tab-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px dashed var(--border, rgba(255,255,255,0.12));
  border-radius: 4px;
  background: transparent;
  color: var(--muted, rgba(255,255,255,0.55));
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.project-tab-add:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text, rgba(255,255,255,0.92));
  border-color: var(--primary, #1f6feb);
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
