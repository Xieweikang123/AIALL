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
            class="editor-tab"
            :class="[
              {
                active: tab.path === activeFilePath,
                dirty: tab.dirty,
                'editor-tab--dragging': tabDragState.active && tabDragState.fromIndex === index,
                'editor-tab--drop-before': tabDragState.dropIndex === index && tabDragState.dropSide === 'before',
                'editor-tab--drop-after': tabDragState.dropIndex === index && tabDragState.dropSide === 'after',
              },
              tabKindClass(tab),
            ]"
            :title="tabTitle(tab)"
            @click="onTabClick(tab)"
            @mousedown.middle.prevent="$emit('close-tab', tab.path)"
            @contextmenu.prevent="onTabContextMenu($event, tab.path)"
            @pointerdown="onTabPointerDown($event, index)"
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

      <!-- Tab 拖拽幽灵 -->
      <Teleport to="body">
        <div v-if="tabDragGhost" class="editor-tab-drag-ghost" :style="{ left: tabDragGhost.x + 'px', top: tabDragGhost.y + 'px' }">
          <span class="editor-tab-drag-ghost-name">{{ tabDragGhost.name }}</span>
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
          v-if="isGitVirtualTab"
          type="button"
          class="ghost tiny editor-action-btn source-jump-btn"
          title="在编辑器中打开源文件"
          @click="$emit('open-source-file', activeFilePath)"
        >源文件</button>
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

    <div v-if="npmScriptRunState.visible" class="npm-run-panel" :class="{ running: npmScriptRunState.running }" :style="{ height: npmPanelHeight + 'px' }">
      <div class="npm-run-resize" @pointerdown="onNpmResizeStart" />
      <div class="npm-run-header">
        <div class="npm-run-title">
          <svg class="npm-run-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2.5" y="4.5" width="19" height="15" rx="2" stroke="currentColor" stroke-width="1.5" />
            <path d="m7 9 3 3-3 3M12.5 15H17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="npm-run-name">{{ npmScriptRunState.script ? `npm run ${npmScriptRunState.script}` : "npm script" }}</span>
          <span class="npm-run-status-chip" :class="runStatus.cls">
            <span class="npm-run-status-dot" />
            {{ runStatus.text }}
          </span>
          <span v-if="npmScriptRunState.pid" class="npm-run-pid">PID {{ npmScriptRunState.pid }}</span>
        </div>
        <div class="npm-run-actions">
          <span v-if="runElapsed > 0" class="npm-run-duration">{{ runElapsed }}s</span>
          <button type="button" class="ghost tiny npm-run-btn" :disabled="npmScriptRunState.running" @click="clearNpmScriptOutput()">清空</button>
          <button v-if="npmScriptRunState.running" type="button" class="ghost tiny npm-run-btn npm-run-btn--stop" @click="onStopScript">停止</button>
          <button type="button" class="ghost tiny npm-run-btn" @click="closeNpmScriptPanel()">关闭</button>
        </div>
      </div>
      <div ref="npmOutputRef" class="npm-run-output">
        <div
          v-for="(line, index) in npmScriptRunState.lines"
          :key="index"
          class="npm-run-line"
          :class="`npm-run-line--${line.kind}`"
        >
          <span class="npm-run-line-text">{{ line.text || " " }}</span>
        </div>
        <span v-if="npmScriptRunState.running" class="npm-run-cursor" aria-hidden="true">▍</span>
        <div v-if="!npmScriptRunState.lines.length && !npmScriptRunState.running" class="npm-run-empty">暂无输出</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import CodeMonacoEditor, { type MonacoSelectionAnchor } from "../CodeMonacoEditor.vue";
import CodeMonacoDiffEditor, { type MonacoDiffHunkAction } from "../CodeMonacoDiffEditor.vue";
import { clearNpmScriptOutput, closeNpmScriptPanel, npmScriptRunState, stopNpmScript } from "../../services/npmScriptClient";
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
  (e: "open-source-file", path: string): void;
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

/* ---- 标签拖拽排序（Pointer 实现，兼容 WebView2，替代原生 HTML5 DnD） ---- */
const DRAG_THRESHOLD_PX = 5;

const tabDragState = ref<{
  pointerId: number | null;
  fromIndex: number;
  startX: number;
  startY: number;
  active: boolean;
  dropIndex: number;
  dropSide: "before" | "after" | null;
}>({ pointerId: null, fromIndex: -1, startX: 0, startY: 0, active: false, dropIndex: -1, dropSide: null });

const tabDragGhost = ref<{ x: number; y: number; name: string } | null>(null);
let suppressTabClick = false;

function onTabPointerDown(e: PointerEvent, index: number) {
  if (e.button !== 0) return;
  if (index < 0 || index >= props.openTabs.length) return;
  if ((e.target as HTMLElement).closest(".editor-tab-close")) return;

  tabDragState.value = {
    pointerId: e.pointerId,
    fromIndex: index,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    dropIndex: -1,
    dropSide: null,
  };
  window.addEventListener("pointermove", onTabWindowPointerMove);
  window.addEventListener("pointerup", onTabWindowPointerUp);
  window.addEventListener("pointercancel", onTabWindowPointerCancel);
  window.addEventListener("blur", onTabWindowBlur);
}

function onTabWindowPointerMove(e: PointerEvent) {
  const s = tabDragState.value;
  if (s.pointerId !== e.pointerId) return;

  if (!s.active) {
    if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_THRESHOLD_PX) return;
    s.active = true;
    const tab = props.openTabs[s.fromIndex];
    if (tab) {
      tabDragGhost.value = { x: e.clientX + 12, y: e.clientY + 12, name: tabDisplayName(tab.path) };
    }
    document.body.classList.add("tab-dragging-active");
  }

  if (tabDragGhost.value) {
    tabDragGhost.value = { ...tabDragGhost.value, x: e.clientX + 12, y: e.clientY + 12 };
  }
  updateTabDropTarget(e.clientX);
  autoScrollTabs(e.clientX);
}

function onTabWindowPointerUp(e: PointerEvent) {
  const s = tabDragState.value;
  if (s.pointerId !== e.pointerId) return;
  if (s.active) {
    if (s.dropIndex >= 0 && s.dropSide) {
      const fromIndex = s.fromIndex;
      const toIndex = s.dropSide === "after" ? s.dropIndex + 1 : s.dropIndex;
      emit("reorder-tabs", { fromIndex, toIndex });
    }
    // 拖拽结束会触发 click，用一次性的标记吞掉它，避免误切换 tab
    suppressTabClick = true;
    setTimeout(() => {
      suppressTabClick = false;
    }, 0);
  }
  clearTabDrag();
}

function onTabWindowPointerCancel(e: PointerEvent) {
  if (tabDragState.value.pointerId !== e.pointerId) return;
  clearTabDrag();
}

function onTabWindowBlur() {
  if (tabDragState.value.pointerId === null) return;
  clearTabDrag();
}

function clearTabDrag() {
  window.removeEventListener("pointermove", onTabWindowPointerMove);
  window.removeEventListener("pointerup", onTabWindowPointerUp);
  window.removeEventListener("pointercancel", onTabWindowPointerCancel);
  window.removeEventListener("blur", onTabWindowBlur);
  tabDragState.value = {
    pointerId: null,
    fromIndex: -1,
    startX: 0,
    startY: 0,
    active: false,
    dropIndex: -1,
    dropSide: null,
  };
  tabDragGhost.value = null;
  document.body.classList.remove("tab-dragging-active");
}

function updateTabDropTarget(clientX: number) {
  const s = tabDragState.value;
  let target: { index: number; side: "before" | "after" } | null = null;

  for (let i = 0; i < props.openTabs.length; i++) {
    const el = tabElMap.get(props.openTabs[i].path);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right) {
      target = { index: i, side: clientX < rect.left + rect.width / 2 ? "before" : "after" };
      break;
    }
  }
  if (!target && props.openTabs.length) {
    const lastEl = tabElMap.get(props.openTabs[props.openTabs.length - 1].path);
    if (lastEl) {
      const rect = lastEl.getBoundingClientRect();
      if (clientX > rect.right) target = { index: props.openTabs.length - 1, side: "after" };
      else if (clientX < rect.left) target = { index: 0, side: "before" };
    }
  }

  s.dropIndex = target?.index ?? -1;
  s.dropSide = target?.side ?? null;
}

function autoScrollTabs(clientX: number) {
  const container = tabsContainerRef.value;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const EDGE = 40;
  if (clientX < rect.left + EDGE) container.scrollLeft -= 8;
  else if (clientX > rect.right - EDGE) container.scrollLeft += 8;
}

function onTabClick(tab: OpenTab) {
  if (suppressTabClick) {
    suppressTabClick = false;
    return;
  }
  emit("switch-tab", tab.path);
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

/* ---- npm script 运行面板（hover Run 触发） ---- */
const npmOutputRef = ref<HTMLElement | null>(null);
const npmPanelHeight = ref(220);
const npmResizePointerId = ref<number | null>(null);

const runStatus = computed(() => {
  const s = npmScriptRunState;
  if (s.error) return { text: "错误", cls: "fail" };
  if (s.running) return { text: "运行中", cls: "running" };
  if (s.exitCode === null) return { text: "待运行", cls: "idle" };
  return s.exitCode === 0
    ? { text: "成功", cls: "ok" }
    : { text: `失败 · 退出码 ${s.exitCode}`, cls: "fail" };
});

watch(
  () => npmScriptRunState.lines.length,
  async () => {
    await nextTick();
    const el = npmOutputRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

function onStopScript() {
  void stopNpmScript();
}

const runNow = ref(Date.now());
let runTimer: ReturnType<typeof setInterval> | null = null;

watch(
  () => npmScriptRunState.running,
  (running) => {
    if (running) {
      if (!runTimer) {
        runTimer = setInterval(() => {
          runNow.value = Date.now();
        }, 1000);
      }
    } else if (runTimer) {
      clearInterval(runTimer);
      runTimer = null;
      runNow.value = Date.now();
    }
  },
  { immediate: true },
);

const runElapsed = computed(() => {
  const s = npmScriptRunState;
  if (!s.startedAt) return 0;
  const end = s.running ? runNow.value : s.finishedAt || runNow.value;
  return Math.max(0, Math.round((end - s.startedAt) / 1000));
});

onBeforeUnmount(() => {
  if (runTimer) {
    clearInterval(runTimer);
    runTimer = null;
  }
});

function onNpmResizeStart(e: PointerEvent) {
  if (npmResizePointerId.value !== null) return;
  npmResizePointerId.value = e.pointerId;
  const startY = e.clientY;
  const startH = npmPanelHeight.value;
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== npmResizePointerId.value) return;
    const delta = startY - ev.clientY;
    const max = Math.max(120, Math.round(window.innerHeight * 0.6));
    npmPanelHeight.value = Math.min(Math.max(startH + delta, 90), max);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== npmResizePointerId.value) return;
    npmResizePointerId.value = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

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

const isGitVirtualTab = computed(
  () =>
    props.activeFilePath.startsWith("git-index://") ||
    props.activeFilePath.startsWith("git-history://"),
);

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

.editor-tab {
  cursor: grab;
}

.editor-tab:active {
  cursor: grabbing;
}

/* 拖拽幽灵 */
.editor-tab-drag-ghost {
  position: fixed;
  z-index: 10000;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(22, 27, 38, 0.95);
  border: 1px solid rgba(88, 166, 255, 0.4);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.92);
  pointer-events: none;
  white-space: nowrap;
}

.editor-tab-drag-ghost-name {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

:global(.tab-dragging-active) {
  user-select: none;
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

.editor-action-btn.source-jump-btn {
  color: #3fb950;
  border-color: rgba(63, 185, 80, 0.3);
}

.editor-action-btn.source-jump-btn:hover {
  background: rgba(63, 185, 80, 0.1);
  border-color: #3fb950;
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

/* ---- npm script 运行面板 ---- */
.npm-run-panel {
  flex-shrink: 0;
  height: 220px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: #0b0f16;
  box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.35);
}

.npm-run-resize {
  height: 4px;
  flex-shrink: 0;
  cursor: ns-resize;
  position: relative;
  touch-action: none;
}

.npm-run-resize::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: transparent;
  transition: background 0.15s ease;
}

.npm-run-panel.running .npm-run-resize::after {
  background: linear-gradient(90deg, transparent, rgba(63, 185, 80, 0.6), transparent);
}

.npm-run-resize:hover::after {
  background: rgba(88, 166, 255, 0.55);
}

.npm-run-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 10px 5px 8px;
  flex-shrink: 0;
  background: #131922;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 12px;
}

.npm-run-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.npm-run-icon {
  color: #58a6ff;
  flex-shrink: 0;
}

.npm-run-name {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.npm-run-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.npm-run-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.npm-run-status-chip.running {
  color: #3fb950;
  background: rgba(63, 185, 80, 0.14);
}

.npm-run-status-chip.running .npm-run-status-dot {
  animation: npm-run-pulse 1.4s infinite;
}

.npm-run-status-chip.ok {
  color: #3fb950;
  background: rgba(63, 185, 80, 0.12);
}

.npm-run-status-chip.fail {
  color: #f85149;
  background: rgba(248, 81, 73, 0.12);
}

.npm-run-status-chip.idle {
  color: #8b949e;
  background: rgba(139, 148, 158, 0.12);
}

@keyframes npm-run-pulse {
  0% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5); }
  70% { box-shadow: 0 0 0 6px rgba(63, 185, 80, 0); }
  100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
}

.npm-run-pid {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.38);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.npm-run-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

.npm-run-duration {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-variant-numeric: tabular-nums;
  margin-right: 2px;
}

.npm-run-btn {
  font-size: 11px;
  padding: 2px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  transition: all 0.15s ease;
}

.npm-run-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.95);
}

.npm-run-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.npm-run-btn--stop {
  color: #f85149;
  border-color: rgba(248, 81, 73, 0.35);
  background: rgba(248, 81, 73, 0.1);
}

.npm-run-btn--stop:hover:not(:disabled) {
  background: rgba(248, 81, 73, 0.2);
  color: #ff7b72;
}

.npm-run-output {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 0;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.85);
}

.npm-run-line {
  display: flex;
  padding: 0 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.npm-run-line:hover {
  background: rgba(255, 255, 255, 0.03);
}

.npm-run-line--stdout .npm-run-line-text {
  color: rgba(230, 237, 243, 0.88);
}

.npm-run-line--stderr .npm-run-line-text {
  color: #ffa198;
}

.npm-run-line--system .npm-run-line-text {
  color: rgba(88, 166, 255, 0.75);
  font-style: italic;
}

.npm-run-cursor {
  display: inline-block;
  margin-left: 12px;
  color: #3fb950;
  animation: npm-run-blink 1s step-end infinite;
}

@keyframes npm-run-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.npm-run-empty {
  padding: 14px 12px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
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
