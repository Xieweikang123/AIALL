<template>
  <div v-if="node.isDirectory" class="tree-dir">
    <button
      type="button"
      class="file-item dir"
      :class="{ selected: node.path === selectedPath }"
      :style="{ paddingLeft }"
      @click="onDirClick"
    >
      <span class="file-icon">{{ expanded ? "📂" : "📁" }}</span>
      <span class="file-name">{{ node.name }}</span>
    </button>
    <div v-if="expanded && node.children?.length" class="tree-children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :active-path="activePath"
        :selected-path="selectedPath"
        :expanded-dirs="expandedDirs"
        :depth="depth + 1"
        @toggle="$emit('toggle', $event)"
        @open="$emit('open', $event)"
        @select="$emit('select', $event)"
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
  >
    <span class="file-icon">📄</span>
    <span class="file-name">{{ node.name }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { FileEntry } from "../services/vibeCodingClient";

export interface TreeNode extends FileEntry {
  children?: TreeNode[];
  loaded?: boolean;
}

const props = defineProps<{
  node: TreeNode;
  activePath: string;
  selectedPath: string;
  expandedDirs: Set<string>;
  depth?: number;
}>();

const emit = defineEmits<{
  toggle: [path: string];
  open: [path: string];
  select: [path: string];
}>();

function onDirClick() {
  emit("select", props.node.path);
  emit("toggle", props.node.path);
}

function onFileClick() {
  emit("select", props.node.path);
  emit("open", props.node.path);
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

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
