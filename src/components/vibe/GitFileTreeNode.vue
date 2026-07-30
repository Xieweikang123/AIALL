<template>
  <div v-if="node.isDirectory" class="git-tree-dir">
    <div
      class="git-tree-row git-tree-row--dir"
      :style="{ paddingLeft }"
    >
      <button
        type="button"
        class="git-tree-dir-toggle"
        @click="$emit('toggle-dir', node.path)"
      >
        <span class="git-tree-check-spacer" aria-hidden="true" />
        <span class="git-tree-chevron" aria-hidden="true">{{ expanded ? "▾" : "▸" }}</span>
        <span class="git-tree-folder-icon" aria-hidden="true" />
        <span class="git-tree-name">{{ node.name }}</span>
      </button>
      <div class="git-file-actions">
        <button
          v-if="staged"
          type="button"
          class="git-file-btn"
          title="取消暂存此文件夹"
          @pointerdown.stop
          @click.stop="$emit('unstage-dir', node.path)"
        >✓</button>
        <template v-else>
          <button
            type="button"
            class="git-file-btn"
            title="暂存此文件夹"
            @pointerdown.stop
            @click.stop="$emit('stage-dir', node.path)"
          >+</button>
          <button
            type="button"
            class="git-file-btn danger"
            title="丢弃此文件夹（未跟踪将删除）"
            @pointerdown.stop
            @click.stop="$emit('discard-dir', node.path, $event)"
          >✕</button>
        </template>
      </div>
    </div>
    <div v-if="expanded && node.children?.length" class="git-tree-children">
      <GitFileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :staged="staged"
        :list-scope="listScope"
        :expanded-dirs="expandedDirs"
        :selected-git-files="selectedGitFiles"
        :git-diff-loading-key="gitDiffLoadingKey"
        @toggle-dir="$emit('toggle-dir', $event)"
        @stage-file="$emit('stage-file', $event)"
        @unstage-file="$emit('unstage-file', $event)"
        @discard-file="(path, event) => $emit('discard-file', path, event)"
        @stage-dir="$emit('stage-dir', $event)"
        @unstage-dir="$emit('unstage-dir', $event)"
        @discard-dir="(path, event) => $emit('discard-dir', path, event)"
        @pointer-down="(event, path, scope) => $emit('pointer-down', event, path, scope)"
        @contextmenu="(event, path, scope) => $emit('contextmenu', event, path, scope)"
        @open-file="(path) => $emit('open-file', path)"
      />
    </div>
  </div>
  <div
    v-else
    class="git-tree-row git-tree-row--file file-item-draggable"
    :class="{
      active: selectedGitFiles.includes(gitFileSelectionKey(node.path, staged)),
      loading: gitDiffLoadingKey === gitWorkingTreeDiffKey(node.path, staged),
    }"
    :style="{ paddingLeft }"
    @pointerdown="$emit('pointer-down', $event, node.path, listScope)"
    @contextmenu.prevent="$emit('contextmenu', $event, node.path, listScope)"
    @dblclick="$emit('open-file', node.path)"
  >
    <span class="git-tree-check-spacer" aria-hidden="true" />
    <span class="git-tree-file-icon" :class="fileTypeClass" aria-hidden="true">{{ fileTypeLabel }}</span>
    <span class="git-tree-name" :title="node.path">{{ node.name }}</span>
    <span class="git-file-status" :class="gitStatusClass(node.file?.status ?? '')">
      {{ gitStatusIcon(node.file?.status ?? "") }}
    </span>
    <div class="git-file-actions">
      <button
        v-if="staged"
        type="button"
        class="git-file-btn"
        title="取消暂存"
        @pointerdown.stop
        @click.stop="$emit('unstage-file', node.path)"
      >✓</button>
      <template v-else>
        <button
          type="button"
          class="git-file-btn"
          title="暂存更改"
          @pointerdown.stop
          @click.stop="$emit('stage-file', node.path)"
        >+</button>
        <button
          type="button"
          class="git-file-btn danger"
          :title="node.file?.status === 'untracked' ? '删除未跟踪文件' : '丢弃更改'"
          @pointerdown.stop
          @click.stop="$emit('discard-file', node.path, $event)"
        >✕</button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { GitFileTreeNode } from "../../utils/gitFileTree";
import {
  gitStatusIcon,
  gitStatusClass,
  gitFileSelectionKey,
  type GitFileListScope,
} from "../../utils/gitHelpers";

const props = defineProps<{
  node: GitFileTreeNode;
  depth?: number;
  staged: boolean;
  listScope: GitFileListScope;
  expandedDirs: Set<string>;
  selectedGitFiles: string[];
  gitDiffLoadingKey: string;
}>();

defineEmits<{
  "toggle-dir": [path: string];
  "stage-file": [path: string];
  "unstage-file": [path: string];
  "discard-file": [path: string, event: MouseEvent];
  "stage-dir": [path: string];
  "unstage-dir": [path: string];
  "discard-dir": [path: string, event: MouseEvent];
  "pointer-down": [event: PointerEvent, path: string, listScope: GitFileListScope];
  contextmenu: [event: MouseEvent, path: string, listScope: GitFileListScope];
  "open-file": [path: string];
}>();

const depth = computed(() => props.depth ?? 0);
const paddingLeft = computed(() => `${8 + depth.value * 24}px`);
const expanded = computed(() => props.expandedDirs.has(props.node.path));

const FILE_KIND_BY_EXT: Record<string, string> = {
  vue: "vue",
  ts: "ts",
  tsx: "ts",
  js: "js",
  jsx: "js",
  cs: "cs",
  json: "json",
  md: "md",
  css: "css",
  scss: "scss",
  html: "html",
};

function getFileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

const fileExt = computed(() => getFileExt(props.node.name));
const fileKind = computed(() => FILE_KIND_BY_EXT[fileExt.value] ?? "file");
const fileTypeClass = computed(() => `git-tree-file-icon--${fileKind.value}`);
const fileTypeLabel = computed(() => {
  if (fileExt.value) return fileExt.value.slice(0, 3).toUpperCase();
  return "···";
});

function gitWorkingTreeDiffKey(path: string, isStaged: boolean): string {
  return `${isStaged ? "staged" : "unstaged"}:${path}`;
}
</script>

<style scoped>
.git-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px 5px 4px;
  font-size: 12px;
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.88);
  transition: background 120ms ease;
}

.git-tree-row--dir {
  border: none;
  background: transparent;
  cursor: default;
  text-align: left;
  gap: 0;
}

.git-tree-dir-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
  font: inherit;
}

.git-tree-row--file {
  cursor: pointer;
}

.git-tree-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.git-tree-row--file.active {
  background: rgba(88, 166, 255, 0.15);
}

.git-tree-row--file.loading {
  opacity: 0.6;
}

.git-tree-check-spacer {
  width: 20px;
  flex-shrink: 0;
}

.git-tree-chevron {
  width: 12px;
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(139, 148, 158, 0.85);
  text-align: center;
}

.git-tree-folder-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 3px;
  background: rgba(210, 153, 34, 0.18);
  position: relative;
}

.git-tree-folder-icon::before {
  content: "";
  position: absolute;
  left: 2px;
  right: 2px;
  top: 4px;
  height: 6px;
  border-radius: 1px;
  background: rgba(227, 179, 65, 0.85);
}

.git-tree-file-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: rgba(139, 148, 158, 0.16);
  color: rgba(255, 255, 255, 0.55);
}

.git-tree-file-icon--vue { background: rgba(65, 184, 131, 0.22); color: #7ee787; }
.git-tree-file-icon--ts { background: rgba(49, 120, 198, 0.22); color: #79c0ff; }
.git-tree-file-icon--js { background: rgba(210, 153, 34, 0.22); color: #e3b341; }
.git-tree-file-icon--cs { background: rgba(63, 185, 80, 0.22); color: #7ee787; }
.git-tree-file-icon--json { background: rgba(210, 153, 34, 0.18); color: #d29922; }
.git-tree-file-icon--md { background: rgba(88, 166, 255, 0.18); color: #79c0ff; }

.git-tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-tree-row--dir .git-tree-name {
  color: rgba(255, 255, 255, 0.78);
  font-weight: 500;
}

:deep(.git-file-status) {
  font-size: 10px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
  margin-left: 4px;
}

:deep(.git-status-added) {
  color: #3fb950;
  background: rgba(63, 185, 80, 0.14);
}

:deep(.git-status-modified) {
  color: #d29922;
  background: rgba(210, 153, 34, 0.14);
}

:deep(.git-status-deleted) {
  color: #f85149;
  background: rgba(248, 81, 73, 0.14);
}

:deep(.git-status-renamed) {
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.14);
}

:deep(.git-status-untracked) {
  color: #79c0ff;
  background: rgba(88, 166, 255, 0.12);
}

:deep(.git-status-conflicted) {
  color: #f85149;
  background: rgba(248, 81, 73, 0.14);
}

:deep(.git-status-unknown) {
  color: #8b949e;
  background: rgba(139, 148, 158, 0.12);
}

.git-file-actions {
  opacity: 0;
  display: flex;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.git-tree-row--file:hover .git-file-actions,
.git-tree-row--dir:hover .git-file-actions {
  opacity: 1;
}

:deep(.git-file-btn) {
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.15s ease;
  cursor: pointer;
  line-height: 1;
}

:deep(.git-file-btn:hover) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.9);
}

:deep(.git-file-btn.danger:hover) {
  background: rgba(248, 81, 73, 0.15);
  border-color: rgba(248, 81, 73, 0.3);
  color: #f85149;
}
</style>
