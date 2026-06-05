<template>
  <div v-if="node.isDirectory" class="tree-dir">
    <button
      type="button"
      class="file-item dir"
      :class="{ selected: node.path === selectedPath }"
      :style="{ paddingLeft }"
      @click="onDirClick"
      @contextmenu.prevent="onContextMenu"
    >
      <span class="file-icon">{{ expanded ? "📂" : "📁" }}</span>
      <input
        v-if="node.path === renamingPath"
        ref="renameInputRef"
        class="rename-input"
        :value="node.name"
        @keydown.enter="commitRename($event)"
        @keydown.escape="$emit('rename-cancel')"
        @blur="commitRename($event)"
        @click.stop
      />
      <span v-else class="file-name">{{ node.name }}</span>
    </button>
    <div v-if="expanded && node.children?.length" class="tree-children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :active-path="activePath"
        :selected-path="selectedPath"
        :renaming-path="renamingPath"
        :expanded-dirs="expandedDirs"
        :depth="depth + 1"
        @toggle="$emit('toggle', $event)"
        @open="$emit('open', $event)"
        @select="$emit('select', $event)"
        @contextmenu="(p: string, x: number, y: number) => $emit('contextmenu', p, x, y)"
        @rename="(p: string, n: string) => $emit('rename', p, n)"
        @rename-cancel="$emit('rename-cancel')"
      />
    </div>
  </div>
  <button
    v-else
    type="button"
    class="file-item"
    :class="{ active: node.path === activePath, selected: node.path === selectedPath }"
    :style="{ paddingLeft }"
    @click="onFileClick"
    @contextmenu.prevent="onContextMenu"
  >
    <span class="file-icon">📄</span>
    <input
      v-if="node.path === renamingPath"
      ref="renameInputRef"
      class="rename-input"
      :value="node.name"
      @keydown.enter="commitRename($event)"
      @keydown.escape="$emit('rename-cancel')"
      @blur="commitRename($event)"
      @click.stop
    />
    <span v-else class="file-name">{{ node.name }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FileEntry } from "../services/vibeCodingClient";

export interface TreeNode extends FileEntry {
  children?: TreeNode[];
  loaded?: boolean;
}

const props = defineProps<{
  node: TreeNode;
  activePath: string;
  selectedPath: string;
  renamingPath: string;
  expandedDirs: Set<string>;
  depth?: number;
}>();

const emit = defineEmits<{
  toggle: [path: string];
  open: [path: string];
  select: [path: string];
  contextmenu: [path: string, x: number, y: number];
  rename: [path: string, newName: string];
  "rename-cancel": [];
}>();

const renameInputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.renamingPath === props.node.path,
  (active) => {
    if (active) {
      nextTick(() => {
        const el = renameInputRef.value;
        if (el) {
          el.focus();
          const dot = el.value.lastIndexOf(".");
          el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
        }
      });
    }
  },
);

function commitRename(e: Event) {
  const input = e.target as HTMLInputElement;
  const newName = input.value.trim();
  if (newName && newName !== props.node.name) {
    emit("rename", props.node.path, newName);
  } else {
    emit("rename-cancel");
  }
}

function onDirClick() {
  emit("select", props.node.path);
  emit("toggle", props.node.path);
}

function onFileClick() {
  emit("select", props.node.path);
  emit("open", props.node.path);
}

function onContextMenu(e: MouseEvent) {
  emit("contextmenu", props.node.path, e.clientX, e.clientY);
}

const depth = computed(() => props.depth ?? 0);
const paddingLeft = computed(() => `${8 + depth.value * 14}px`);
const expanded = computed(() => props.expandedDirs.has(props.node.path));
</script>

<style scoped>
.file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  text-align: left;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}

.file-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.file-item.active {
  background: rgba(31, 111, 235, 0.2);
  color: #aad0ff;
}

.file-item.selected:not(.active) {
  background: rgba(255, 255, 255, 0.04);
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename-input {
  flex: 1;
  min-width: 0;
  padding: 1px 4px;
  font-size: 12px;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(31, 111, 235, 0.6);
  border-radius: 3px;
  outline: none;
}
</style>
