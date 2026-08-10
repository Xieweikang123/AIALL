<template>
  <div class="monaco-wrap">
    <div v-if="loading" class="monaco-loading"><span class="shimmer-text">加载对比视图…</span></div>
    <div ref="containerRef" class="monaco-editor-host" :class="{ hidden: loading }" />
  </div>
</template>

<script setup lang="ts">
import type * as Monaco from "monaco-editor";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { languageFromFilePath } from "../utils/monacoLanguage";
import { setupNpmScriptHover } from "../utils/monacoNpmScriptHover";
import { parseHunkNewRange } from "../utils/gitHelpers";

export type MonacoDiffSelectionAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type MonacoDiffHunkAction = {
  index: number;
  header: string;
};

type HunkOverlayEntry = {
  widget: Monaco.editor.IOverlayWidget;
  startLine: number;
  dom: HTMLElement;
};

const props = defineProps<{
  original: string;
  modified: string;
  filePath?: string;
  language?: string;
  /** Working-tree diff → stage; index diff → unstage. Null hides actions. */
  hunkActionMode?: "stage" | "unstage" | null;
  hunks?: MonacoDiffHunkAction[];
  hunkBusyIndex?: number | null;
}>();

const emit = defineEmits<{
  select: [text: string, anchor: MonacoDiffSelectionAnchor | null];
  "hunk-action": [index: number];
}>();

const containerRef = ref<HTMLElement | null>(null);
const loading = ref(true);

let monaco: typeof Monaco | null = null;
let diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null;
let originalModel: Monaco.editor.ITextModel | null = null;
let modifiedModel: Monaco.editor.ITextModel | null = null;
let resizeObserver: ResizeObserver | null = null;
let hunkDecorationIds: string[] = [];
let hunkOverlays: HunkOverlayEntry[] = [];
let hunkZoneTimer = 0;
let hoveredHunkIndex = -1;
let scrollDisposable: Monaco.IDisposable | null = null;
let layoutDisposable: Monaco.IDisposable | null = null;
let hoverMoveDisposable: Monaco.IDisposable | null = null;
let hoverLeaveDisposable: Monaco.IDisposable | null = null;

function resolveLanguage(): string {
  if (props.language) return props.language;
  if (props.filePath) return languageFromFilePath(props.filePath);
  return "plaintext";
}

function getSelectionAnchorRect(
  codeEditor: Monaco.editor.IStandaloneCodeEditor,
  monacoSelection: Monaco.IRange,
): MonacoDiffSelectionAnchor | null {
  const domNode = codeEditor.getDomNode();
  if (!domNode) return null;

  const startPos = codeEditor.getScrolledVisiblePosition({
    lineNumber: monacoSelection.startLineNumber,
    column: monacoSelection.startColumn,
  });
  if (!startPos) return null;

  const editorRect = domNode.getBoundingClientRect();
  let width = 80;
  if (monacoSelection.startLineNumber === monacoSelection.endLineNumber) {
    const endPos = codeEditor.getScrolledVisiblePosition({
      lineNumber: monacoSelection.endLineNumber,
      column: monacoSelection.endColumn,
    });
    if (endPos) width = Math.max(24, endPos.left - startPos.left);
  } else {
    width = Math.max(80, Math.min(editorRect.width * 0.35, 240));
  }

  return {
    left: editorRect.left + startPos.left,
    top: editorRect.top + startPos.top,
    width,
    height: startPos.height || 18,
  };
}

function emitActiveSelection() {
  if (!diffEditor) return;
  const editors = [diffEditor.getModifiedEditor(), diffEditor.getOriginalEditor()];
  for (const codeEditor of editors) {
    const model = codeEditor.getModel();
    const monacoSelection = codeEditor.getSelection();
    if (!model || !monacoSelection || monacoSelection.isEmpty()) continue;
    const text = model.getValueInRange(monacoSelection).trim();
    if (!text) continue;
    emit("select", text, getSelectionAnchorRect(codeEditor, monacoSelection));
    return;
  }
  emit("select", "", null);
}

function attachSelectionListeners(codeEditor: Monaco.editor.IStandaloneCodeEditor) {
  codeEditor.onDidChangeCursorSelection(() => {
    emitActiveSelection();
  });
  codeEditor.onDidScrollChange(() => {
    emit("select", "", null);
  });
}

function clearHunkOverlays() {
  const editor = diffEditor?.getModifiedEditor();
  if (!editor) {
    hunkOverlays = [];
    return;
  }
  for (const entry of hunkOverlays) {
    editor.removeOverlayWidget(entry.widget);
  }
  hunkOverlays = [];
}

function clearHunkDecorations() {
  const editor = diffEditor?.getModifiedEditor();
  if (!editor || !hunkDecorationIds.length) {
    hunkDecorationIds = [];
    return;
  }
  editor.deltaDecorations(hunkDecorationIds, []);
  hunkDecorationIds = [];
}

function clearHunkUi() {
  clearHunkOverlays();
  clearHunkDecorations();
  hoveredHunkIndex = -1;
}

function scheduleHunkZones(delayMs = 80) {
  if (hunkZoneTimer) window.clearTimeout(hunkZoneTimer);
  hunkZoneTimer = window.setTimeout(() => {
    hunkZoneTimer = 0;
    mountHunkUi();
  }, delayMs);
}

function createHunkActionDom(hunk: MonacoDiffHunkAction) {
  const dom = document.createElement("div");
  dom.className = "monaco-git-hunk-widget";
  dom.setAttribute("data-hunk-index", String(hunk.index));

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "monaco-git-hunk-btn";
  btn.title = hunk.header;
  syncBusyState(btn, hunk.index);
  btn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  btn.addEventListener("mouseenter", () => {
    hoveredHunkIndex = hunk.index;
    updateOverlayPositions();
  });
  btn.addEventListener("mouseleave", () => {
    if (hoveredHunkIndex === hunk.index) {
      hoveredHunkIndex = -1;
      updateOverlayPositions();
    }
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Read latest busy at click time (avoid stale closure from mount)
    if (props.hunkBusyIndex != null) return;
    emit("hunk-action", hunk.index);
  });
  dom.appendChild(btn);
  return dom;
}

function syncBusyState(btn: HTMLButtonElement, hunkIndex: number) {
  const busy = props.hunkBusyIndex;
  const label = props.hunkActionMode === "stage" ? "暂存此更改" : "取消暂存此更改";
  btn.textContent = busy === hunkIndex ? "处理中…" : label;
  btn.disabled = busy != null;
}

function hunkLineRange(hunk: MonacoDiffHunkAction): { start: number; count: number } {
  return parseHunkNewRange(hunk.header);
}

/** Should the button for `index` be visible? Hover over the hunk block OR busy state. */
function hunkActionVisible(index: number): boolean {
  if (props.hunkBusyIndex === index) return true;
  return hoveredHunkIndex === index;
}

function updateOverlayPositions() {
  const editor = diffEditor?.getModifiedEditor();
  if (!editor || !hunkOverlays.length) return;
  const layout = editor.getLayoutInfo();

  for (const entry of hunkOverlays) {
    const idx = Number(entry.dom.getAttribute("data-hunk-index"));
    const pos = editor.getScrolledVisiblePosition({
      lineNumber: entry.startLine,
      column: 1,
    });
    const visible = hunkActionVisible(idx);
    if (!pos || pos.top < -40 || pos.top > layout.height + 40 || !visible) {
      entry.dom.style.opacity = "0";
      entry.dom.style.visibility = "hidden";
      continue;
    }
    entry.dom.style.visibility = "visible";
    entry.dom.style.opacity = "1";
    entry.dom.style.top = `${Math.max(0, pos.top + 1)}px`;
    entry.dom.style.right = `${Math.max(8, layout.verticalScrollbarWidth + 10)}px`;
    entry.dom.style.left = "auto";
  }
}

/**
 * Hover-revealed hunk action buttons: no view-zone gaps (preserves line rhythm).
 * The button floats at the hunk's first line and fades in when the pointer is over the block.
 * Block grouping is drawn via whole-line decorations (background tint + left accent rail).
 */
function mountHunkUi() {
  clearHunkUi();
  const editor = diffEditor?.getModifiedEditor();
  if (!editor || !monaco || !props.hunkActionMode) return;
  const hunks = props.hunks || [];
  if (!hunks.length) return;

  const mode = props.hunkActionMode;

  // 1) Decorations: tint + left rail over the hunk's new-side lines.
  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
  for (const hunk of hunks) {
    const { start, count } = hunkLineRange(hunk);
    if (count <= 0 || start < 1) continue;
    const end = Math.max(start, start + count - 1);
    decorations.push({
      range: new monaco.Range(start, 1, end, 1),
      options: {
        isWholeLine: true,
        className: "monaco-hunk-block-bg",
        linesDecorationsClassName: "monaco-hunk-block-accent",
      },
    });
  }
  if (decorations.length) {
    hunkDecorationIds = editor.deltaDecorations([], decorations);
  }

  // 2) Overlay widgets: hover-revealed buttons anchored at each hunk's first line.
  for (const hunk of hunks) {
    const { start } = hunkLineRange(hunk);
    if (start < 1) continue;
    const dom = createHunkActionDom(hunk);
    dom.style.visibility = "hidden";
    const widget: Monaco.editor.IOverlayWidget = {
      getId: () => `aiall-git-hunk-overlay-${mode}-${hunk.index}`,
      getDomNode: () => dom,
      // null → we position manually (top/right) so clicks always hit the button
      getPosition: () => null,
    };
    editor.addOverlayWidget(widget);
    hunkOverlays.push({ widget, startLine: start, dom });
  }

  updateOverlayPositions();
}

function bindModels() {
  if (!diffEditor || !monaco) return;

  const language = resolveLanguage();
  const uriBase = props.filePath?.replace(/\\/g, "/") || "untitled";

  clearHunkUi();
  originalModel?.dispose();
  modifiedModel?.dispose();

  originalModel = monaco.editor.createModel(
    props.original,
    language,
    monaco.Uri.parse(`file:///${uriBase}.original`),
  );
  modifiedModel = monaco.editor.createModel(
    props.modified,
    language,
    monaco.Uri.parse(`file:///${uriBase}.modified`),
  );

  diffEditor.setModel({ original: originalModel, modified: modifiedModel });

  setTimeout(() => {
    if (!diffEditor) return;
    diffEditor.layout();
    diffEditor.revealFirstDiff();
    scheduleHunkZones(120);
  }, 200);
}

function createDiffEditor() {
  const container = containerRef.value;
  if (!container || !monaco) return;

  diffEditor = monaco.editor.createDiffEditor(container, {
    theme: "vs-dark",
    automaticLayout: true,
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
    readOnly: true,
    renderSideBySide: true,
    scrollBeyondLastLine: false,
    mouseWheelScrollSensitivity: 3,
    fastScrollSensitivity: 8,
    minimap: { enabled: false },
    renderOverviewRuler: true,
    ignoreTrimWhitespace: false,
  });

  bindModels();
  const modified = diffEditor.getModifiedEditor();
  attachSelectionListeners(diffEditor.getOriginalEditor());
  attachSelectionListeners(modified);

  scrollDisposable = modified.onDidScrollChange(() => updateOverlayPositions());
  layoutDisposable = modified.onDidLayoutChange(() => updateOverlayPositions());

  hoverMoveDisposable = modified.onMouseMove((e) => {
    if (!props.hunks?.length || props.hunkBusyIndex != null) return;
    const line = e.target?.position?.lineNumber;
    if (!line || line < 1) return;
    let hovered = -1;
    for (const h of props.hunks) {
      const { start, count } = hunkLineRange(h);
      if (count <= 0) continue;
      if (line >= start && line <= start + count - 1) {
        hovered = h.index;
        break;
      }
    }
    if (hovered !== hoveredHunkIndex) {
      hoveredHunkIndex = hovered;
      updateOverlayPositions();
    }
  });
  hoverLeaveDisposable = modified.onMouseLeave(() => {
    if (hoveredHunkIndex !== -1) {
      hoveredHunkIndex = -1;
      updateOverlayPositions();
    }
  });

  resizeObserver = new ResizeObserver(() => {
    diffEditor?.layout();
    updateOverlayPositions();
  });
  resizeObserver.observe(container);
}

function revealLine(line: number, column = 1): boolean {
  if (!diffEditor || !Number.isFinite(line) || line < 1) return false;
  const modified = diffEditor.getModifiedEditor();
  const model = modified.getModel();
  if (!model) return false;
  const safeLine = Math.min(Math.max(1, Math.floor(line)), model.getLineCount());
  const maxCol = model.getLineMaxColumn(safeLine);
  const safeColumn = Math.min(Math.max(1, Math.floor(column)), maxCol);
  modified.setPosition({ lineNumber: safeLine, column: safeColumn });
  modified.revealLineInCenter(safeLine);
  modified.focus();
  updateOverlayPositions();
  return true;
}

async function revealLineWhenReady(line: number, column = 1, maxAttempts = 24): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (revealLine(line, column)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

defineExpose({ revealLine, revealLineWhenReady });

async function initMonaco() {
  await import("../utils/monacoSetup");
  await import("monaco-editor/min/vs/editor/editor.main.css");
  monaco = await import("monaco-editor");
  setupNpmScriptHover(monaco);
  loading.value = false;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  createDiffEditor();
  setTimeout(() => {
    diffEditor?.layout();
    updateOverlayPositions();
  }, 150);
}

watch(
  () => [props.original, props.modified, props.filePath, props.language] as const,
  () => {
    bindModels();
  },
);

watch(
  () =>
    [
      props.hunkActionMode ?? null,
      (props.hunks || []).map((h) => `${h.index}:${h.header}`).join("|"),
    ] as const,
  () => scheduleHunkZones(60),
);

// Busy state: update button labels without full remount (keeps click targets stable)
watch(
  () => props.hunkBusyIndex ?? null,
  () => {
    for (const entry of hunkOverlays) {
      const btn = entry.dom.querySelector("button.monaco-git-hunk-btn") as HTMLButtonElement | null;
      if (!btn) continue;
      const idx = Number(entry.dom.getAttribute("data-hunk-index"));
      if (!Number.isFinite(idx)) continue;
      syncBusyState(btn, idx);
    }
    updateOverlayPositions();
  },
);

onMounted(() => {
  void initMonaco();
});

onBeforeUnmount(() => {
  if (hunkZoneTimer) window.clearTimeout(hunkZoneTimer);
  scrollDisposable?.dispose();
  layoutDisposable?.dispose();
  hoverMoveDisposable?.dispose();
  hoverLeaveDisposable?.dispose();
  scrollDisposable = null;
  layoutDisposable = null;
  hoverMoveDisposable = null;
  hoverLeaveDisposable = null;
  clearHunkUi();
  resizeObserver?.disconnect();
  resizeObserver = null;
  diffEditor?.dispose();
  diffEditor = null;
  originalModel?.dispose();
  originalModel = null;
  modifiedModel?.dispose();
  modifiedModel = null;
});
</script>

<style scoped>
.monaco-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.monaco-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
}

.monaco-editor-host {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

.monaco-editor-host.hidden {
  visibility: hidden;
  position: absolute;
  inset: 0;
}
</style>

<style>
/* Hunk block grouping: faint tint over the changed lines + left accent rail. */
.monaco-hunk-block-bg {
  background: linear-gradient(
    90deg,
    rgba(88, 166, 255, 0.05),
    rgba(88, 166, 255, 0.1) 60%,
    rgba(88, 166, 255, 0.05)
  );
  box-shadow: inset 0 0 0 1px rgba(88, 166, 255, 0.08);
  border-radius: 2px;
}

.monaco-hunk-block-accent {
  background: rgba(88, 166, 255, 0.35);
}

.monaco-git-hunk-widget {
  position: absolute;
  z-index: 50;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.monaco-git-hunk-btn {
  appearance: none;
  pointer-events: auto;
  border: 1px solid rgba(88, 166, 255, 0.55);
  background: rgba(13, 17, 23, 0.96);
  color: #79c0ff;
  font-size: 11px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
}

.monaco-git-hunk-btn:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.3);
  border-color: rgba(121, 192, 255, 0.8);
  color: #fff;
}

.monaco-git-hunk-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
