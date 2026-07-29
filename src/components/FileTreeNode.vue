<template>
  <div v-if="node.isDirectory" class="tree-dir">
    <button
      type="button"
      class="file-item dir"
      :class="{ selected: node.path === selectedPath, expanded }"
      :style="{ paddingLeft }"
      @contextmenu.prevent="onContextMenu"
      @pointerdown="onDirPointerDown"
    >
      <span class="tree-chevron" aria-hidden="true">{{ expanded ? "▾" : "▸" }}</span>
      <span class="file-type-icon file-type-icon--dir" aria-hidden="true" />
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
      <span v-else class="file-name dir-name">{{ node.name }}</span>
    </button>
    <div v-if="expanded && node.children?.length" class="tree-children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        v-memo="[
          child.path === activePath,
          child.path === selectedPath,
          child.path === renamingPath,
          expandedDirs.has(child.path),
        ]"
        :node="child"
        :active-path="activePath"
        :selected-path="selectedPath"
        :renaming-path="renamingPath"
        :expanded-dirs="expandedDirs"
        :project-path="projectPath"
        :depth="depth + 1"
        @toggle="$emit('toggle', $event)"
        @open="$emit('open', $event)"
        @select="$emit('select', $event)"
        @contextmenu="(p: string, x: number, y: number) => $emit('contextmenu', p, x, y)"
        @rename="(p: string, n: string) => $emit('rename', p, n)"
        @rename-cancel="$emit('rename-cancel')"
        @file-drag-start="(node, x, y) => $emit('file-drag-start', node, x, y)"
        @file-drag-move="(x, y) => $emit('file-drag-move', x, y)"
        @file-drag-end="(node, x, y) => $emit('file-drag-end', node, x, y)"
      />
    </div>
  </div>
  <div
    v-else
    role="button"
    tabindex="0"
    class="file-item file-item-draggable"
    :class="{ active: node.path === activePath, selected: node.path === selectedPath }"
    :style="{ paddingLeft }"
    @keydown.enter="onFileTap"
    @keydown.space.prevent="onFileTap"
    @contextmenu.prevent="onContextMenu"
    @pointerdown="onFilePointerDown"
  >
    <span class="tree-chevron tree-chevron--spacer" aria-hidden="true" />
    <span class="file-type-icon" :class="fileTypeClass" aria-hidden="true">{{ fileTypeLabel }}</span>
    <input
      v-if="node.path === renamingPath"
      ref="renameInputRef"
      class="rename-input"
      :value="node.name"
      @keydown.enter="commitRename($event)"
      @keydown.escape="$emit('rename-cancel')"
      @blur="commitRename($event)"
      @click.stop
      @pointerdown.stop
    />
    <span v-else class="file-name">{{ node.name }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FileEntry } from "../services/vibeCodingClient";

export interface TreeNode extends FileEntry {
  children?: TreeNode[];
  loaded?: boolean;
}

const DRAG_THRESHOLD_PX = 5;

const props = defineProps<{
  node: TreeNode;
  activePath: string;
  selectedPath: string;
  renamingPath: string;
  expandedDirs: Set<string>;
  depth?: number;
  projectPath: string;
}>();

const emit = defineEmits<{
  toggle: [path: string];
  open: [path: string];
  select: [path: string];
  contextmenu: [path: string, x: number, y: number];
  rename: [path: string, newName: string];
  "rename-cancel": [];
  "file-drag-start": [node: TreeNode, x: number, y: number];
  "file-drag-move": [x: number, y: number];
  "file-drag-end": [node: TreeNode, x: number, y: number];
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

function onFileTap() {
  emit("select", props.node.path);
  emit("open", props.node.path);
}

function onContextMenu(e: MouseEvent) {
  emit("contextmenu", props.node.path, e.clientX, e.clientY);
}

function startDragFromPointer(e: PointerEvent, onTap: () => void) {
  if (e.button !== 0) return;
  e.preventDefault();

  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);

  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;

  const cleanup = (ev: PointerEvent) => {
    el.releasePointerCapture(ev.pointerId);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
    if (!dragging) {
      dragging = true;
      emit("file-drag-start", props.node, ev.clientX, ev.clientY);
    }
    emit("file-drag-move", ev.clientX, ev.clientY);
  };

  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    cleanup(ev);
    if (dragging) {
      emit("file-drag-end", props.node, ev.clientX, ev.clientY);
      return;
    }
    onTap();
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

function onDirPointerDown(e: PointerEvent) {
  startDragFromPointer(e, onDirClick);
}

function onFilePointerDown(e: PointerEvent) {
  if (props.node.isDirectory) return;
  startDragFromPointer(e, onFileTap);
}

const depth = computed(() => props.depth ?? 0);
const paddingLeft = computed(() => `${6 + depth.value * 14}px`);
const expanded = computed(() => props.expandedDirs.has(props.node.path));

const FILE_KIND_BY_EXT: Record<string, string> = {
  vue: "vue",
  ts: "ts",
  tsx: "ts",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  md: "md",
  mdc: "md",
  scss: "scss",
  css: "css",
  html: "html",
  htm: "html",
  rs: "rust",
  toml: "config",
  yaml: "config",
  yml: "config",
  lock: "lock",
  log: "log",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  test: "test",
};

function getFileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

const fileExt = computed(() => getFileExt(props.node.name));

const fileKind = computed(() => {
  if (props.node.name.endsWith(".test.ts") || props.node.name.endsWith(".test.js")) return "test";
  return FILE_KIND_BY_EXT[fileExt.value] ?? "file";
});

const fileTypeClass = computed(() => `file-type-icon--${fileKind.value}`);

const fileTypeLabel = computed(() => {
  if (fileKind.value === "test") return "TST";
  if (fileExt.value) return fileExt.value.slice(0, 3).toUpperCase();
  return "···";
});
</script>

<style scoped>
.file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.86);
  text-align: left;
  padding: 5px 8px 5px 2px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
  touch-action: none;
  border-radius: 5px;
  position: relative;
  transition: background 0.12s ease, color 0.12s ease;
}

.file-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.file-item-draggable {
  cursor: grab;
}

.file-item-draggable:active {
  cursor: grabbing;
}

.file-item.active {
  background: rgba(88, 166, 255, 0.14);
  color: #c9e4ff;
}

.file-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 60%;
  min-height: 14px;
  border-radius: 0 2px 2px 0;
  background: #58a6ff;
}

.file-item.selected:not(.active) {
  background: rgba(255, 255, 255, 0.04);
}

.tree-chevron {
  width: 12px;
  flex-shrink: 0;
  text-align: center;
  font-size: 8px;
  color: rgba(139, 148, 158, 0.65);
  transition: transform 0.12s ease, color 0.12s ease;
}

.file-item.dir.expanded .tree-chevron {
  color: rgba(139, 148, 158, 0.95);
}

.tree-chevron--spacer {
  visibility: hidden;
}

.file-type-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 3px;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(139, 148, 158, 0.22);
}

.file-type-icon--dir {
  background: rgba(210, 153, 34, 0.18);
  position: relative;
}

.file-type-icon--dir::before {
  content: "";
  width: 9px;
  height: 7px;
  border-radius: 1px 1px 2px 2px;
  background: #d29922;
  box-shadow: 0 -2px 0 -1px rgba(210, 153, 34, 0.55);
}

.file-type-icon--vue { background: rgba(65, 184, 131, 0.22); color: #7ee787; }
.file-type-icon--ts { background: rgba(49, 120, 198, 0.22); color: #79c0ff; }
.file-type-icon--js { background: rgba(210, 153, 34, 0.22); color: #e3b341; }
.file-type-icon--json { background: rgba(210, 153, 34, 0.18); color: #d29922; }
.file-type-icon--md { background: rgba(88, 166, 255, 0.18); color: #79c0ff; }
.file-type-icon--scss { background: rgba(219, 97, 162, 0.2); color: #f778ba; }
.file-type-icon--css { background: rgba(88, 166, 255, 0.2); color: #79c0ff; }
.file-type-icon--html { background: rgba(248, 81, 73, 0.18); color: #ff9a9a; }
.file-type-icon--rust { background: rgba(248, 81, 73, 0.18); color: #ff9a9a; }
.file-type-icon--config { background: rgba(139, 148, 158, 0.2); color: rgba(255, 255, 255, 0.7); }
.file-type-icon--lock { background: rgba(139, 148, 158, 0.16); color: rgba(255, 255, 255, 0.55); font-size: 7px; }
.file-type-icon--log { background: rgba(139, 148, 158, 0.16); color: rgba(255, 255, 255, 0.6); font-size: 7px; }
.file-type-icon--image { background: rgba(163, 113, 247, 0.2); color: #d2a8ff; font-size: 7px; }
.file-type-icon--test { background: rgba(63, 185, 80, 0.18); color: #7ee787; font-size: 7px; }
.file-type-icon--file { background: rgba(139, 148, 158, 0.16); color: rgba(255, 255, 255, 0.55); }

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  color: rgba(255, 255, 255, 0.84);
}

.dir-name {
  font-weight: 500;
  color: rgba(255, 255, 255, 0.94);
}

.tree-children {
  position: relative;
  margin-left: 10px;
  padding-left: 6px;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}

.rename-input {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  font-size: 12.5px;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(88, 166, 255, 0.5);
  border-radius: 4px;
  outline: none;
}
</style>
