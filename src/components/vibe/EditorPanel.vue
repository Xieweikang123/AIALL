<template>
  <section v-show="!parentEditorCollapsed" class="editor-panel">
    <div class="editor-header">
      <div v-if="openTabs.length" ref="tabsContainerRef" class="editor-tabs" @wheel.prevent="onTabsWheel">
        <button
          v-for="tab in openTabs"
          :key="tab.path"
          :ref="(el) => setTabRef(tab.path, el as HTMLElement | null)"
          type="button"
          class="editor-tab"
          :class="{ active: tab.path === activeFilePath, dirty: tab.dirty }"
          :title="tab.path"
          @click="$emit('switch-tab', tab.path)"
          @contextmenu.prevent="onTabContextMenu($event, tab.path)"
        >
          <span class="editor-tab-name">{{ getFileName(tab.path) }}</span>
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
          <button type="button" :disabled="openTabs.length === 0" @click="ctxCloseAll">关闭全部</button>
        </div>
      </Teleport>
      <div class="editor-header-actions">
        <span v-if="fileDirty && !showDiffMode" class="dirty-badge" title="文件已修改">● 未保存</span>
        <span class="editor-action-divider" />
        <button
          type="button"
          class="editor-action-btn collapse-btn"
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
      <button type="button" class="editor-action-btn collapse-btn" @click="$emit('collapse-editor')">收起编辑器</button>
    </div>

    <div v-else-if="fileLoadError" class="editor-empty error">{{ fileLoadError }}</div>

    <CodeMonacoDiffEditor
      v-else-if="showDiffMode && activeFileDiff"
      class="code-editor"
      :original="activeFileDiff.before"
      :modified="activeFileDiff.after"
      :file-path="activeFilePath"
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
      @select="$emit('editor-select', $event)"
    />
    <button
      v-if="selectedCode"
      type="button"
      class="ask-ai-floating"
      title="将选中代码发送给 AI"
      @click="$emit('ask-ai-with-code')"
    >
      💬 问 AI
    </button>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import CodeMonacoEditor from "../CodeMonacoEditor.vue";
import CodeMonacoDiffEditor from "../CodeMonacoDiffEditor.vue";

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
  selectedCode?: string;
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
  (e: "editor-change", value: string): void;
  (e: "editor-select", text: string): void;
  (e: "ask-ai-with-code"): void;
  (e: "update:fileContent", value: string): void;
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

const localContent = computed({
  get: () => props.fileContent,
  set: (value) => emit("update:fileContent", value),
});

function getFileName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

async function revealLineInEditor(line: number, column = 1): Promise<boolean> {
  return editorRef.value?.revealLineWhenReady(line, column) ?? false;
}

defineExpose({ editorRef, revealLineInEditor });
</script>

<style scoped>
.editor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(2, 6, 23, 0.55);
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  height: 38px;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  background: rgba(11, 18, 32, 0.5);
  backdrop-filter: blur(8px);
  flex-shrink: 0;
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
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary, #999);
  background: transparent;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.editor-action-btn:hover:not(:disabled) {
  color: var(--text-primary, #e0e0e0);
  background: var(--bg-tertiary, #2a2a2a);
  border-color: var(--text-secondary, #666);
}

.editor-action-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.editor-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.editor-action-btn.save-btn {
  color: var(--accent-color, #58a6ff);
  border-color: rgba(88, 166, 255, 0.3);
}

.editor-action-btn.save-btn:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.1);
  border-color: var(--accent-color, #58a6ff);
}

.editor-action-btn.collapse-btn {
  color: var(--text-tertiary, #888);
  border-color: transparent;
  background: var(--bg-tertiary, #2a2a2a);
}

.editor-action-btn.collapse-btn:hover {
  color: var(--text-primary, #e0e0e0);
  background: rgba(255, 255, 255, 0.08);
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
  background: linear-gradient(135deg, rgba(31, 111, 235, 0.15), rgba(130, 80, 223, 0.12));
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(145, 190, 255, 0.8);
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

.ask-ai-floating {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 8px 16px;
  background: var(--accent-color, #58a6ff);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 100;
}

.ask-ai-floating:hover {
  background: var(--accent-hover, #79c0ff);
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
