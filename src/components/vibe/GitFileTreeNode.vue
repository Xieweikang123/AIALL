<template>
  <div v-if="node.isDirectory && !flat" class="git-tree-dir">
    <div
      class="git-tree-row git-tree-row--dir"
      :style="{ paddingLeft }"
    >
      <span class="git-tree-guides" aria-hidden="true">
        <span v-for="x in guideXs" :key="x" class="git-tree-guide" :style="{ left: `${x}px` }" />
      </span>
      <button
        type="button"
        class="git-tree-dir-toggle"
        @click="onDirToggle"
      >
        <span class="git-tree-check-spacer" aria-hidden="true" />
        <span class="git-tree-chevron" aria-hidden="true">{{ chainExpanded ? "▾" : "▸" }}</span>
        <span class="git-tree-folder-icon" aria-hidden="true" />
        <span class="git-tree-name" :title="displayNode.name">{{ displayNode.name }}</span>
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
    <div
      v-if="chainExpanded && displayNode.tail.children?.length"
      class="git-tree-children"
    >
      <GitFileTreeNode
        v-for="child in displayNode.tail.children"
        :key="child.path"
        :node="child"
        :depth="childDepth"
        :guide-xs="[...guideXs, childGuideX]"
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
      'batch-active': hasSelection,
    }"
    :style="{ paddingLeft }"
    @pointerdown="$emit('pointer-down', $event, node.path, listScope)"
    @contextmenu.prevent="$emit('contextmenu', $event, node.path, listScope)"
    @dblclick="$emit('open-file', node.path)"
  >
    <span class="git-tree-guides" aria-hidden="true">
      <span v-for="x in guideXs" :key="x" class="git-tree-guide" :style="{ left: `${x}px` }" />
    </span>
    <span class="git-tree-check-spacer" aria-hidden="true" />
    <span v-if="!flat" class="git-tree-chevron git-tree-chevron--spacer" aria-hidden="true" />
    <span class="git-tree-file-icon" :class="fileTypeClass" aria-hidden="true">{{ fileTypeLabel }}</span>
    <span class="git-tree-name" :class="{ 'git-tree-name--flat': flat }" :title="node.path">
      <span v-if="flatDir" class="git-tree-dir-prefix">{{ flatDir }}/</span>
      <span class="git-tree-basename">{{ flatBase }}</span>
    </span>
    <span class="git-file-status" :class="gitStatusClass(node.file?.status ?? '')">
      {{ gitStatusIcon(node.file?.status ?? "") }}
    </span>
    <div class="git-file-actions">
      <button
        v-if="staged"
        type="button"
        class="git-file-btn"
        :class="{ 'git-file-btn--batch': hasSelection }"
        :title="hasSelection ? `批量取消暂存（已选 ${selectedGitFiles.length} 个）` : '取消暂存'"
        @pointerdown.stop
        @click.stop="$emit('unstage-file', node.path)"
      >✓</button>
      <template v-else-if="isIgnoredLocal">
        <button
          type="button"
          class="git-file-btn"
          title="恢复跟踪（重新显示在更改列表）"
          @pointerdown.stop
          @click.stop="$emit('unignore-file', node.path)"
        >↺</button>
      </template>
      <template v-else>
        <button
          type="button"
          class="git-file-btn"
          :class="{ 'git-file-btn--batch': hasSelection }"
          :title="hasSelection ? `批量暂存（已选 ${selectedGitFiles.length} 个）` : '暂存更改'"
          @pointerdown.stop
          @click.stop="$emit('stage-file', node.path)"
        >+</button>
        <button
          type="button"
          class="git-file-btn danger"
          :class="{ 'git-file-btn--batch': hasSelection }"
          :title="hasSelection
            ? `批量丢弃（已选 ${selectedGitFiles.length} 个）`
            : node.file?.status === 'untracked' ? '删除未跟踪文件' : '丢弃更改'"
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
  collapseTreeNode,
  isChainExpanded,
  treeIndentCss,
  treeIndentPx,
  type TreeDisplayNode,
} from "../../utils/treeDisplay";
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
  flat?: boolean;
  /**
   * 需要在本行绘制的导引线 x（相对行左缘），每层祖先一条。
   * 由父目录递归时追加「本行到子行的缩进 x」，本行原样绘制 → 竖线每行连满、多层自然续接。
   * 与 VS Code `.indent-guide`（每行为每个祖先画一条 1px 线）同一模型。
   */
  guideXs?: number[];
}>();

const emit = defineEmits<{
  "toggle-dir": [path: string];
  "stage-file": [path: string];
  "unstage-file": [path: string];
  "discard-file": [path: string, event: MouseEvent];
  "unignore-file": [path: string];
  "stage-dir": [path: string];
  "unstage-dir": [path: string];
  "discard-dir": [path: string, event: MouseEvent];
  "pointer-down": [event: PointerEvent, path: string, listScope: GitFileListScope];
  contextmenu: [event: MouseEvent, path: string, listScope: GitFileListScope];
  "open-file": [path: string];
}>();

const depth = computed(() => props.depth ?? 0);
const paddingLeft = computed(() => treeIndentCss(depth.value));

/**
 * Git 行前导占位宽度：`.git-tree-check-spacer`（20px）+ 行 gap（4px）。
 * 所有行（目录/文件、含扁平模式）都以此为内容起点，导引线需加上它才对得齐子项 chevron。
 */
const GIT_ROW_LEADING = 24;

/** 单子目录链合并后的显示节点（与文件面板共用同一套规则）。 */
const displayNode = computed<TreeDisplayNode<GitFileTreeNode>>(() => collapseTreeNode(props.node));

/** 链上任意一段展开即视为展开（以链尾为准）。 */
const chainExpanded = computed(() => isChainExpanded(displayNode.value, props.expandedDirs));

/** 子节点缩进按链尾实际层级计。 */
const childDepth = computed(() => depth.value + displayNode.value.chainPaths.length);

/**
 * 本行要绘制的导引线 x（相对行左缘），每层祖先一条，由父目录递归传入。
 * 与 VS Code 的 `.indent-guide` 同模型：行自己画满整行高度，同一层 x 相同 → 竖线逐行续接。
 */
const guideXs = computed(() => props.guideXs ?? []);

/**
 * 本目录到其子行的缩进 x（子行内容左缘 = 行左缘 + 子级缩进），作为追加项传给子节点。
 * 子级缩进按链尾层级 `childDepth` 算，合并行（`java/com/vpp/auxiliary`）也一致。
 * Git 行开头有 20px 的 check-spacer + 4px gap，真正的 chevron/图标在其后，
 * 故对齐子项 chevron 需再补 `GIT_ROW_LEADING`（否则线会飘在图标左侧 24px 的空白里）。
 */
const childGuideX = computed(() => treeIndentPx(childDepth.value) + GIT_ROW_LEADING);

/**
 * 合并行只 toggle 链尾：展开态由链尾是否在 expandedDirs 决定，toggle 一次即可翻转。
 * 文件树 toggleDir 会在展开时顺着单子链把后续层加载并展开到底。
 */
function onDirToggle() {
  emit("toggle-dir", displayNode.value.tail.path);
}

const hasSelection = computed(() => props.selectedGitFiles.length > 1);
const isIgnoredLocal = computed(() => props.listScope === "ignored-local");

const flatDir = computed(() => {
  if (!props.flat) return "";
  const idx = props.node.path.lastIndexOf("/");
  return idx > 0 ? props.node.path.slice(0, idx) : "";
});

const flatBase = computed(() => {
  if (!props.flat) return props.node.name;
  const idx = props.node.path.lastIndexOf("/");
  return idx >= 0 ? props.node.path.slice(idx + 1) : props.node.path;
});

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
  position: relative;
}

.git-tree-row--dir {
  border: none;
  background: transparent;
  cursor: default;
  text-align: left;
  gap: 0;
}

/**
 * 行内导引线（VS Code `.indent-guide` 模型）：每行为每一层祖先各画一条 1px 竖线，
 * 逐行连满整行高度；同一层 x 相同，于是叠成连续的竖线。
 * 放在行内层、不占布局（absolute、z-index 0），避免撑宽行。
 */
.git-tree-guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.git-tree-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.14);
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

.git-tree-children {
  position: relative;
}

.git-tree-chevron {
  width: 12px;
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(139, 148, 158, 0.85);
  text-align: center;
}

/* 文件行补上与目录行 chevron 等宽的占位，使所有行内容左缘一致（对齐根因修复） */
.git-tree-chevron--spacer {
  visibility: hidden;
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

.git-tree-name--flat {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.git-tree-name--flat .git-tree-dir-prefix {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.38);
  font-size: 11px;
}

.git-tree-name--flat .git-tree-basename {
  flex: 0 1 auto;
  min-width: 2ch;
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

:deep(.git-status-ignored-local) {
  color: #8b949e;
  background: rgba(139, 148, 158, 0.12);
}

.git-file-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  max-width: 0;
  overflow: hidden;
  margin-left: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.git-tree-row--file:hover .git-file-actions,
.git-tree-row--dir:hover .git-file-actions,
.git-tree-row--file.batch-active .git-file-actions {
  opacity: 1;
  max-width: 72px;
  margin-left: 4px;
  pointer-events: auto;
}

/* 批量模式：按钮高亮，提示将作用于整个选中集合 */
:deep(.git-file-btn--batch) {
  background: rgba(88, 166, 255, 0.18);
  border-color: rgba(88, 166, 255, 0.5);
  color: #79c0ff;
}

:deep(.git-file-btn--batch:hover) {
  background: rgba(88, 166, 255, 0.3);
  border-color: rgba(88, 166, 255, 0.65);
  color: #a5d6ff;
}

:deep(.git-file-btn--batch.danger) {
  background: rgba(248, 81, 73, 0.16);
  border-color: rgba(248, 81, 73, 0.5);
  color: #ffa198;
}

:deep(.git-file-btn--batch.danger:hover) {
  background: rgba(248, 81, 73, 0.28);
  border-color: rgba(248, 81, 73, 0.7);
  color: #ffb3ad;
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
  opacity: 1;
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
