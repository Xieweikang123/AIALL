<template>
  <aside class="file-panel" :style="{ width: filePanelWidth + 'px' }">
    <div class="file-panel-head">
      <div class="file-panel-row file-panel-top-row">
        <div class="file-panel-tabs" role="group">
          <button
            type="button"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'files' }"
            @click="$emit('update:gitPanelMode', 'files')"
          >
            文件
          </button>
          <button
            type="button"
            class="file-panel-tab"
            :class="{ active: gitPanelMode === 'git' }"
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
        <div class="search-mode-switch" role="group" aria-label="搜索模式">
          <button
            type="button"
            class="search-mode-btn"
            :class="{ active: searchMode === 'file' }"
            :disabled="!projectOpened"
            @click="$emit('update:searchMode', 'file')"
          >
            文件
          </button>
          <button
            type="button"
            class="search-mode-btn"
            :class="{ active: searchMode === 'content' }"
            :disabled="!projectOpened"
            @click="$emit('update:searchMode', 'content')"
          >
            内容
          </button>
        </div>
        <input
          ref="searchInputRef"
          :value="searchQuery"
          class="search-input"
          type="text"
          :placeholder="searchMode === 'file' ? '搜索文件名…' : '搜索代码内容…'"
          :disabled="!projectOpened"
          @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          @keydown.enter="$emit('handle-search')"
        />
      </div>
    </div>

    <slot></slot>
  </aside>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { GitFileDiff } from "../../composables/useGitPanel";

interface Props {
  filePanelWidth: number;
  gitPanelMode: "files" | "git";
  projectOpened: boolean;
  searchMode: "file" | "content";
  searchQuery: string;
  editorCollapsed: boolean;
  gitChangeCount: number;
  gitUnstagedFiles: GitFileDiff[];
  gitStagedFiles: GitFileDiff[];
}

defineProps<Props>();

const emit = defineEmits<{
  (e: "update:gitPanelMode", mode: "files" | "git"): void;
  (e: "update:searchQuery", value: string): void;
  (e: "update:searchMode", mode: "file" | "content"): void;
  (e: "handle-search"): void;
  (e: "create-new-file"): void;
  (e: "create-new-folder"): void;
  (e: "expand-editor"): void;
  (e: "refresh-git-status"): void;
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);

defineExpose({ searchInputRef });
</script>

<style scoped>
.file-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #1e1e1e);
  border-right: 1px solid var(--border-color, #333);
  overflow: hidden;
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
  gap: 8px;
}

.file-panel-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  font-size: 13px;
  border: none;
  background: none;
  color: var(--text-secondary, #999);
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}

.file-panel-tab:hover {
  background: var(--bg-tertiary, #333);
  color: var(--text-primary, #fff);
}

.file-panel-tab.active {
  background: var(--bg-tertiary, #333);
  color: var(--text-primary, #fff);
  font-weight: 500;
}

.file-panel-tab:disabled {
  opacity: 0.5;
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
  font-weight: 500;
  background: var(--accent-color, #58a6ff);
  color: white;
  border-radius: 8px;
}

.git-badge-staged {
  background: var(--success-color, #3fb950);
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
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--text-secondary, #999);
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
}

.icon-btn:hover {
  background: var(--bg-tertiary, #333);
  color: var(--text-primary, #fff);
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

.search-mode-switch {
  display: flex;
  gap: 2px;
  margin-bottom: 6px;
}

.search-mode-btn {
  flex: 0 0 auto;
  padding: 4px 10px;
  font-size: 11px;
  white-space: nowrap;
  border: 1px solid var(--border-color, #333);
  background: var(--bg-secondary, #252525);
  color: var(--text-secondary, #999);
  cursor: pointer;
  border-radius: 4px;
}

.search-mode-btn:hover {
  background: var(--bg-tertiary, #333);
  color: var(--text-primary, #fff);
}

.search-mode-btn.active {
  background: var(--accent-color, #58a6ff);
  color: white;
  border-color: var(--accent-color, #58a6ff);
}

.search-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.search-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  background: var(--bg-secondary, #252525);
  color: var(--text-primary, #fff);
}

.search-input:focus {
  outline: none;
  border-color: var(--accent-color, #58a6ff);
}

.search-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
