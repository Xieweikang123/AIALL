<template>
  <section v-show="!parentEditorCollapsed && openTabs.length > 0" class="editor-panel">
    <div class="editor-header">
      <div v-if="openTabs.length" class="editor-tabs-row">
        <div ref="tabsContainerRef" class="editor-tabs" @wheel.prevent="onTabsWheel">
          <button
            v-for="(tab, index) in openTabs"
            :key="tab.path"
            :ref="(el) => setTabRef(tab.path, el as HTMLElement | null)"
            type="button"
            draggable="true"
            class="editor-tab"
            :class="[
              {
                active: tab.path === activeFilePath,
                dirty: tab.dirty,
                'editor-tab--dragging': dragState.tabIndex === index,
                'editor-tab--drop-before': dragState.dropIndex === index && dragState.dropSide === 'before',
                'editor-tab--drop-after': dragState.dropIndex === index && dragState.dropSide === 'after',
              },
              tabKindClass(tab),
            ]"
            :title="tabTitle(tab)"
            @click="$emit('switch-tab', tab.path)"
            @mousedown.middle.prevent="$emit('close-tab', tab.path)"
            @contextmenu.prevent="onTabContextMenu($event, tab.path)"
            @dragstart="onTabDragStart($event, index)"
            @dragover="onTabDragOver($event, index)"
            @dragenter="onTabDragEnter($event, index)"
            @dragleave="onTabDragLeave($event, index)"
            @drop="onTabDrop($event, index)"
            @dragend="onTabDragEnd"
          >
            <span v-if="tabKindLabel(tab)" class="editor-tab-badge">{{ tabKindLabel(tab) }}</span>
            <span class="editor-tab-name">{{ tabDisplayName(tab.path) }}</span>
            <span v-if="tab.dirty" class="editor-tab-dot" aria-hidden="true">•</span>
            <span
              class="editor-tab-close"
              role="button"
              tabindex="0"
              title="关闭"
              @click.stop="$emit('close-tab', tab.path)"
              @keydown.enter.stop.prevent="$emit('close-tab', tab.path)"
            >
              ×
            </span>
          </button>
        </div>
        <button
          type="button"
          class="editor-tab-add"
          title="新建临时窗口"
          @click="$emit('new-scratch')"
        >+</button>
      </div>
      <div v-else class="editor-header-title">未打开文件</div>

      <!-- 右键菜单 -->
      <Teleport to="body">
        <div
          v-if="contextMenu.visible"
          class="editor-tab-context-menu"
          :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
          @click.stop
        >
          <button type="button" @click="ctxClose">关闭</button>
          <button type="button" :disabled="openTabs.length <= 1" @click="ctxCloseOthers">关闭其它</button>
          <button type="button" :disabled="!hasTabsToRight" @click="ctxCloseRight">关闭右侧</button>
          <div class="ctx-sep" />
          <button type="button" @click="ctxCopyPath">复制路径</button>
          <button type="button" @click="ctxRevealInFolder">在文件管理器中显示</button>
          <div class="ctx-sep" />
          <button type="button" :disabled="openTabs.length === 0" @click="ctxCloseAll">关闭全部</button>
        </div>
      </Teleport>
      <div class="editor-header-actions">
        <button
          type="button"
          class="icon tiny editor-action-btn nav-btn"
          :disabled="!canGoBack"
          title="后退 (导航历史)"
          @click="$emit('navigate-back')"
        >←</button>
        <button
          type="button"
          class="icon tiny editor-action-btn nav-btn"
          :disabled="!canGoForward"
          title="前进 (导航历史)"
          @click="$emit('navigate-forward')"
        >→</button>
        <button
          v-if="showDiffMode"
          type="button"
          class="ghost tiny editor-action-btn diff-toggle-btn"
          title="切换 Diff/编辑视图"
          @click="$emit('toggle-diff-mode')"
        >⇄ Diff</button>
        <button
          v-if="isMarkdownFile && !showDiffMode"
          type="button"
          class="ghost tiny editor-action-btn"
          :class="{ active: showPreview }"
          :title="showPreview ? '切换到编辑' : '预览 Markdown'"
          @click="showPreview = !showPreview"
        >{{ showPreview ? '编辑' : '预览' }}</button>
        <span v-if="fileDirty && !showDiffMode" class="dirty-badge" title="文件已修改">● 未保存</span>
        <span class="editor-action-divider" />
        <button
          v-if="chatCollapsed"
          type="button"
          class="ghost tiny editor-action-btn"
          title="展开 AI 助手"
          @click="$emit('expand-chat')"
        >
          AI 助手
        </button>
        <button
          type="button"
          class="ghost tiny editor-action-btn collapse-btn"
          title="收起编辑器"
          @click="$emit('collapse-editor')"
        >
          收起
        </button>
      </div>
    </div>

    <div v-if="!activeFilePath" class="editor-empty">
      <div class="editor-empty-visual" aria-hidden="true">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" stroke-width="1.2" />
          <path d="M14 2v6h6M10 13h4M10 17h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </div>
      <p class="editor-empty-title">从左侧选择文件开始编辑</p>
      <p class="editor-empty-hint">支持多标签 · Diff 对比 · Ctrl+S 保存</p>
      <button type="button" class="ghost tiny editor-action-btn collapse-btn" @click="$emit('collapse-editor')">收起编辑器</button>
    </div>

    <div v-else-if="fileLoadError" class="editor-empty error">{{ fileLoadError }}</div>

    <div
      v-else-if="showPreview && isMarkdownFile"
      class="code-editor markdown-preview"
      v-html="previewHtml"
    />

    <CodeMonacoDiffEditor
      ref="diffEditorRef"
      v-else-if="showDiffMode && activeFileDiff"
      class="code-editor"
      :original="activeFileDiff.before"
      :modified="activeFileDiff.after"
      :file-path="activeFilePath"
      :hunk-action-mode="hunkActionMode"
      :hunks="hunkActions"
      :hunk-busy-index="hunkBusyIndex"
      @select="(text, anchor) => $emit('editor-select', text, anchor)"
      @hunk-action="(index) => $emit('hunk-action', index)"
    />

    <CodeMonacoEditor
      ref="editorRef"
      v-else
      v-model="localContent"
      class="code-editor"
      :file-path="activeFilePath"
      :read-only="activeFileReadOnly"
      @change="$emit('editor-change', $event)"
      @save="$emit('save-file')"
      @select="(text, anchor) => $emit('editor-select', text, anchor)"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import CodeMonacoEditor, { type MonacoSelectionAnchor } from "../CodeMonacoEditor.vue";
import CodeMonacoDiffEditor, { type MonacoDiffHunkAction } from "../CodeMonacoDiffEditor.vue";
import { renderMarkdown } from "../../utils/renderMarkdown";
import DOMPurify from "dompurify";
import {
  type EditorTabKind,
  editorTabDisplayName,
  editorTabKindLabel,
  editorTabTitle,
  inferEditorTabKind,
} from "../../utils/vibeHelpers";

interface FileDiff {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
}

interface OpenTab {
  path: string;
  content: string;
  dirty: boolean;
  kind?: EditorTabKind;
}

interface Props {
  activeFilePath: string;
  fileContent: string;
  fileDirty: boolean;
  fileLoadError: string;
  activeFileDiff: FileDiff | null;
  activeFileReadOnly: boolean;
  showDiffMode: boolean;
  openTabs: OpenTab[];
  parentEditorCollapsed: boolean;
  chatCollapsed?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  hunkActionMode?: "stage" | "unstage" | null;
  hunkActions?: MonacoDiffHunkAction[];
  hunkBusyIndex?: number | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "switch-tab", path: string): void;
  (e: "close-tab", path: string): void;
  (e: "close-other-tabs", path: string): void;
  (e: "close-right-tabs", path: string): void;
  (e: "close-all-tabs"): void;
  (e: "toggle-diff-mode"): void;
  (e: "save-file"): void;
  (e: "reload-file"): void;
  (e: "collapse-editor"): void;
  (e: "expand-chat"): void;
  (e: "editor-change", value: string): void;
  (e: "editor-select", text: string, anchor: MonacoSelectionAnchor | null): void;
  (e: "update:fileContent", value: string): void;
  (e: "navigate-back"): void;
  (e: "navigate-forward"): void;
  (e: "reorder-tabs", payload: { fromIndex: number; toIndex: number }): void;
  (e: "hunk-action", index: number): void;
  (e: "new-scratch"): void;
}>();

/* ---- 标签滚轮横向滚动 ---- */
function onTabsWheel(e: WheelEvent) {
  const el = (e.currentTarget as HTMLElement);
  if (e.deltaY !== 0) {
    el.scrollLeft += e.deltaY;
  }
}

/* ---- 标签 ref 管理 & 自动滚动 ---- */
const tabsContainerRef = ref<HTMLDivElement | null>(null);
const tabElMap = new Map<string, HTMLElement>();

function setTabRef(path: string, el: HTMLElement | null) {
  if (el) tabElMap.set(path, el);
  else tabElMap.delete(path);
}

function scrollTabIntoView(path: string) {
  const container = tabsContainerRef.value;
  const tabEl = tabElMap.get(path);
  if (!container || !tabEl) return;

  const tabLeft = tabEl.offsetLeft;
  const tabRight = tabLeft + tabEl.offsetWidth;
  const scrollLeft = container.scrollLeft;
  const viewWidth = container.clientWidth;

  if (tabRight > scrollLeft + viewWidth) {
    container.scrollLeft = tabRight - viewWidth + 8;
  } else if (tabLeft < scrollLeft) {
    container.scrollLeft = tabLeft - 8;
  }
}

watch(() => props.activeFilePath, async (newPath) => {
  if (!newPath) return;
  await nextTick();
  scrollTabIntoView(newPath);
});

/* ---- 标签拖拽排序 ---- */
const dragState = ref<{
  tabIndex: number;
  dropIndex: number;
  dropSide: "before" | "after" | null;
}>({ tabIndex: -1, dropIndex: -1, dropSide: null });

function onTabDragStart(e: DragEvent, index: number) {
  if (index < 0 || index >= props.openTabs.length) return;
  dragState.value = { tabIndex: index, dropIndex: -1, dropSide: null };
  e.dataTransfer?.setData("text/plain", String(index));
  e.dataTransfer!.effectAllowed = "move";
  // Small delay so the "dragging" class takes effect visually
  requestAnimationFrame(() => {
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });
}

function onTabDragOver(e: DragEvent, index: number) {
  e.preventDefault();
  if (dragState.value.tabIndex < 0) return;
  if (dragState.value.tabIndex === index) {
    dragState.value.dropIndex = -1;
    dragState.value.dropSide = null;
    return;
  }
  e.dataTransfer!.dropEffect = "move";
}

function onTabDragEnter(e: DragEvent, index: number) {
  e.preventDefault();
  if (dragState.value.tabIndex < 0) return;
  if (dragState.value.tabIndex === index) {
    dragState.value.dropIndex = -1;
    dragState.value.dropSide = null;
    return;
  }
  const tabEl = tabElMap.get(props.openTabs[index]?.path ?? "");
  if (!tabEl) return;
  const rect = tabEl.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  const side = e.clientX < midX ? "before" : "after";
  dragState.value = { ...dragState.value, dropIndex: index, dropSide: side };
}

function onTabDragLeave(e: DragEvent, index: number) {
  // Only clear when the leave event is for the current target element
  const target = e.currentTarget as HTMLElement;
  const related = e.relatedTarget as Node | null;
  if (related && target.contains(related)) return;
  if (dragState.value.dropIndex === index) {
    dragState.value.dropIndex = -1;
    dragState.value.dropSide = null;
  }
}

function onTabDrop(e: DragEvent, index: number) {
  e.preventDefault();
  const fromIndex = dragState.value.tabIndex;
  const dropSide = dragState.value.dropSide;
  dragState.value = { tabIndex: -1, dropIndex: -1, dropSide: null };
  if (fromIndex < 0 || fromIndex === index) return;
  // toIndex is the position in the original array where the tab should be inserted.
  // "before" tab at i  → toIndex = i
  // "after"  tab at i  → toIndex = i + 1  (can be length for "after last")
  const toIndex = dropSide === "after" ? index + 1 : index;
  emit("reorder-tabs", { fromIndex, toIndex });
}

function onTabDragEnd() {
  dragState.value = { tabIndex: -1, dropIndex: -1, dropSide: null };
}

/* ---- 右键菜单 ---- */
const contextMenu = ref({ visible: false, x: 0, y: 0, path: "" });

function onTabContextMenu(e: MouseEvent, path: string) {
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, path };
}

const hasTabsToRight = computed(() => {
  const idx = props.openTabs.findIndex((t) => t.path === contextMenu.value.path);
  return idx >= 0 && idx < props.openTabs.length - 1;
});

function hideCtx() { contextMenu.value.visible = false; }

function ctxClose() {
  const p = contextMenu.value.path;
  hideCtx();
  emit("close-tab", p);
}
function ctxCloseOthers() {
  const p = contextMenu.value.path;
  hideCtx();
  emit("close-other-tabs", p);
}
function ctxCloseRight() {
  const p = contextMenu.value.path;
  hideCtx();
  emit("close-right-tabs", p);
}
function ctxCloseAll() {
  hideCtx();
  emit("close-all-tabs");
}

function ctxCopyPath() {
  const p = contextMenu.value.path;
  hideCtx();
  navigator.clipboard.writeText(p).catch(() => {});
}

function ctxRevealInFolder() {
  const p = contextMenu.value.path;
  hideCtx();
  if (p) {
    import("@tauri-apps/plugin-opener").then(({ revealItemInDir }) =>
      revealItemInDir(p).catch(() => {}),
    );
  }
}

/* 点击页面任意位置或按 Escape 关闭菜单 */
import { onMounted, onBeforeUnmount } from "vue";
function onGlobalClick() { hideCtx(); }
function onGlobalKeydown(e: KeyboardEvent) { if (e.key === "Escape") hideCtx(); }
onMounted(() => {
  document.addEventListener("click", onGlobalClick, true);
  document.addEventListener("keydown", onGlobalKeydown, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onGlobalClick, true);
  document.removeEventListener("keydown", onGlobalKeydown, true);
});

const editorRef = ref<InstanceType<typeof CodeMonacoEditor> | null>(null);
const diffEditorRef = ref<InstanceType<typeof CodeMonacoDiffEditor> | null>(null);

const localContent = computed({
  get: () => props.fileContent,
  set: (value) => emit("update:fileContent", value),
});

const STORAGE_KEY = "editor-md-preview";

function loadPreviewState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePreviewState(state: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const previewState = ref<Record<string, boolean>>(loadPreviewState());

const isMarkdownFile = computed(() => /\.md$/i.test(props.activeFilePath));

const showPreview = computed({
  get: () => previewState.value[props.activeFilePath] ?? false,
  set: (val) => {
    if (val) previewState.value[props.activeFilePath] = val;
    else delete previewState.value[props.activeFilePath];
    savePreviewState(previewState.value);
  },
});

const previewHtml = computed(() => {
  if (!isMarkdownFile.value) return "";
  return DOMPurify.sanitize(renderMarkdown(props.fileContent), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["data-mermaid-rendered", "data-collapsed"],
    FORBID_TAGS: ["input", "form", "select", "textarea", "iframe", "script", "style", "object", "embed"],
  });
});

watch(isMarkdownFile, (val) => {
  if (!val) showPreview.value = false;
});

function resolveTabKind(tab: OpenTab): EditorTabKind {
  return tab.kind ?? inferEditorTabKind(tab.path);
}

function tabKindLabel(tab: OpenTab): string | null {
  return editorTabKindLabel(resolveTabKind(tab));
}

function tabKindClass(tab: OpenTab): string {
  const kind = resolveTabKind(tab);
  return kind === "file" ? "" : `editor-tab--${kind}`;
}

function tabDisplayName(path: string): string {
  return editorTabDisplayName(path);
}

function tabTitle(tab: OpenTab): string {
  return editorTabTitle(tab.path, resolveTabKind(tab));
}

async function revealLineInEditor(line: number, column = 1): Promise<boolean> {
  return editorRef.value?.revealLineWhenReady(line, column) ?? false;
}

async function revealLineInDiff(line: number, column = 1): Promise<boolean> {
  return diffEditorRef.value?.revealLineWhenReady(line, column) ?? false;
}

defineExpose({ editorRef, diffEditorRef, revealLineInEditor, revealLineInDiff });
</script>

<style scoped>
.editor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d1117;
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  height: 38px;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  background: #161b22;
  backdrop-filter: blur(8px);
  flex-shrink: 0;
}

.editor-tabs-row {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1 1 0%;
  min-width: 0;
}

.editor-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  flex: 1 1 0%;
  scrollbar-width: none;
  -ms-overflow-style: none;
  min-width: 0;
}

.editor-tabs::-webkit-scrollbar {
  display: none;
}

.editor-tab-add {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  margin: 0 2px 0 4px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease, background 0.15s ease;
}

.editor-tab-add:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
}

.editor-empty.error {
  color: #f85149;
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.editor-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 12px;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  border-radius: 6px 6px 0 0;
  white-space: nowrap;
  min-width: 0;
  max-width: 180px;
  flex: 0 0 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s ease, background 0.15s ease;
}

.editor-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
}

.editor-tab.active {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.95);
  box-shadow: inset 0 -2px 0 #58a6ff;
}

.editor-tab-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.02em;
}

.editor-tab--git-change .editor-tab-badge {
  color: #e3b341;
  background: rgba(227, 179, 65, 0.16);
}

.editor-tab--scratch .editor-tab-badge {
  color: #8b949e;
  background: rgba(139, 148, 158, 0.16);
}

.editor-tab--git-staged .editor-tab-badge {
  color: #3fb950;
  background: rgba(63, 185, 80, 0.16);
}

.editor-tab--git-history .editor-tab-badge {
  color: #a371f7;
  background: rgba(163, 113, 247, 0.16);
}

.editor-tab--git-change.active {
  box-shadow: inset 0 -2px 0 #e3b341;
}

.editor-tab--scratch.active {
  box-shadow: inset 0 -2px 0 #8b949e;
}

.editor-tab--git-staged.active {
  box-shadow: inset 0 -2px 0 #3fb950;
}

.editor-tab--git-history.active {
  box-shadow: inset 0 -2px 0 #a371f7;
}

.editor-tab.dirty .editor-tab-name {
  font-style: italic;
}

.editor-tab-dot {
  color: var(--accent-color, #58a6ff);
  font-size: 14px;
  line-height: 1;
}

.editor-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 12px;
  color: var(--text-secondary, #999);
  border-radius: 3px;
  cursor: pointer;
}

.editor-tab-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary, #fff);
}

/* ---- 标签拖拽反馈 ---- */
.editor-tab--dragging {
  opacity: 0.45;
  cursor: grabbing;
}

.editor-tab--drop-before {
  box-shadow: inset 2px 0 0 0 var(--accent-color, #58a6ff);
}

.editor-tab--drop-after {
  box-shadow: inset -2px 0 0 0 var(--accent-color, #58a6ff);
}

.editor-tab[draggable="true"] {
  cursor: grab;
}

.editor-tab[draggable="true"]:active {
  cursor: grabbing;
}

.editor-header-title {
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.editor-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.editor-action-btn {
  /* 消费全局 ghost / icon token */
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.editor-action-btn.save-btn {
  color: var(--accent-color, #58a6ff);
  border-color: rgba(88, 166, 255, 0.3);
}

.editor-action-btn.save-btn:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.1);
  border-color: var(--accent-color, #58a6ff);
}

.editor-action-btn.nav-btn {
  font-size: 14px;
  font-weight: 700;
}

.editor-action-btn.collapse-btn {
  border-color: transparent;
  background: rgba(255, 255, 255, 0.04);
}

.editor-action-divider {
  width: 1px;
  height: 14px;
  background: var(--border-color, #333);
  margin: 0 2px;
}

.dirty-badge {
  font-size: 10px;
  font-weight: 500;
  color: var(--warning-color, #d29922);
  padding: 2px 0;
  letter-spacing: 0.02em;
}

.editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 10px;
  padding: 24px;
  color: rgba(255, 255, 255, 0.55);
}

.editor-empty-visual {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: #21262d;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #8b949e;
  margin-bottom: 4px;
}

.editor-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
}

.editor-empty-hint {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}

.code-editor {
  flex: 1;
  min-height: 0;
}

/* Markdown 预览 */
.markdown-preview {
  padding: 24px 32px;
  overflow-y: auto;
  line-height: 1.7;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
}

.markdown-preview h1 { font-size: 1.7em; font-weight: 700; margin: 0.8em 0 0.4em; color: #e6edf3; }
.markdown-preview h2 { font-size: 1.4em; font-weight: 700; margin: 0.8em 0 0.4em; color: #e6edf3; }
.markdown-preview h3 { font-size: 1.2em; font-weight: 600; margin: 0.8em 0 0.4em; color: #e6edf3; }
.markdown-preview h4 { font-size: 1.05em; font-weight: 600; margin: 0.8em 0 0.4em; color: #e6edf3; }
.markdown-preview p { margin: 0.5em 0; }
.markdown-preview a { color: #58a6ff; text-decoration: none; }
.markdown-preview a:hover { text-decoration: underline; }
.markdown-preview code {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}
.markdown-preview pre {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 0.8em 0;
}

/* 无语言 / plaintext 代码块强化 */
.markdown-preview pre:not([class*="language-"]) code,
.markdown-preview code.language-text,
.markdown-preview code.language-plaintext {
  white-space: pre !important;
  word-break: normal !important;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.markdown-preview pre code {
  font-family:
    "Cascadia Code",
    "Fira Code",
    "JetBrains Mono",
    Consolas,
    "Courier New",
    "PingFang SC",
    "Microsoft YaHei",
    monospace !important;
  background: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.25;
  font-variant-ligatures: none !important;
  font-variant-numeric: tabular-nums;
  word-spacing: 0;
  letter-spacing: 0;
  font-feature-settings: "tnum" 1;
}
.markdown-preview blockquote {
  border-left: 3px solid #58a6ff;
  margin: 0.6em 0;
  padding: 4px 16px;
  color: rgba(255, 255, 255, 0.6);
}
.markdown-preview table {
  border-collapse: collapse;
  margin: 0.8em 0;
  width: 100%;
}
.markdown-preview th, .markdown-preview td {
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 8px 12px;
  text-align: left;
}
.markdown-preview th {
  background: rgba(255, 255, 255, 0.05);
  font-weight: 600;
}
.markdown-preview ul, .markdown-preview ol {
  padding-left: 24px;
  margin: 0.4em 0;
}
.markdown-preview li { margin: 0.2em 0; }
.markdown-preview hr {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 1.2em 0;
}
.markdown-preview img {
  max-width: 100%;
  border-radius: 6px;
}
/* highlight.js 主题由 github-dark.css 全局提供 */

.editor-action-btn.active {
  background: rgba(88, 166, 255, 0.15);
  color: #58a6ff;
  border-color: rgba(88, 166, 255, 0.4);
}

/* 右键菜单 */
.editor-tab-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 140px;
  background: rgba(22, 27, 38, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(12px);
}

.editor-tab-context-menu button {
  display: block;
  width: 100%;
  padding: 5px 14px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.editor-tab-context-menu button:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.18);
  color: #fff;
}

.editor-tab-context-menu button:disabled {
  color: rgba(255, 255, 255, 0.25);
  cursor: default;
}

.ctx-sep {
  height: 1px;
  margin: 3px 8px;
  background: rgba(255, 255, 255, 0.08);
}
</style>
