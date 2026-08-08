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
import { parseHunkNewStartLine } from "../utils/gitHelpers";

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
let hunkZoneIds: string[] = [];
let hunkOverlays: HunkOverlayEntry[] = [];
let hunkZoneTimer = 0;
let scrollDisposable: Monaco.IDisposable | null = null;
let layoutDisposable: Monaco.IDisposable | null = null;

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

function clearHunkZones() {
  const editor = diffEditor?.getModifiedEditor();
  if (!editor || !hunkZoneIds.length) {
    hunkZoneIds = [];
    return;
  }
  editor.changeViewZones((accessor) => {
    for (const id of hunkZoneIds) accessor.removeZone(id);
  });
  hunkZoneIds = [];
}

function clearHunkUi() {
  clearHunkOverlays();
  clearHunkZones();
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

function updateOverlayPositions() {
  const editor = diffEditor?.getModifiedEditor();
  if (!editor || !hunkOverlays.length) return;
  const layout = editor.getLayoutInfo();
  const zoneHeight = 28;

  for (const entry of hunkOverlays) {
    const pos = editor.getScrolledVisiblePosition({
      lineNumber: entry.startLine,
      column: 1,
    });
    if (!pos || pos.top < -40 || pos.top > layout.height + 40) {
      entry.dom.style.visibility = "hidden";
      continue;
    }
    entry.dom.style.visibility = "visible";
    entry.dom.style.top = `${Math.max(0, pos.top - zoneHeight + 2)}px`;
    entry.dom.style.right = `${Math.max(8, layout.verticalScrollbarWidth + 10)}px`;
    entry.dom.style.left = "auto";
  }
}

/**
 * View zones only reserve space (not clickable — Monaco paints them under text).
 * Overlay widgets sit on top and receive real mouse events (VS Code-like).
 */
function mountHunkUi() {
  clearHunkUi();
  const editor = diffEditor?.getModifiedEditor();
  if (!editor || !monaco || !props.hunkActionMode) return;
  const hunks = props.hunks || [];
  if (!hunks.length) return;

  const mode = props.hunkActionMode;

  editor.changeViewZones((accessor) => {
    for (const hunk of hunks) {
      const startLine = parseHunkNewStartLine(hunk.header);
      if (startLine < 1) continue;
      const spacer = document.createElement("div");
      spacer.className = "monaco-git-hunk-zone";
      const id = accessor.addZone({
        afterLineNumber: Math.max(0, startLine - 1),
        heightInPx: 28,
        domNode: spacer,
      });
      hunkZoneIds.push(id);
    }
  });

  for (const hunk of hunks) {
    const startLine = parseHunkNewStartLine(hunk.header);
    if (startLine < 1) continue;
    const dom = createHunkActionDom(hunk);
    const widget: Monaco.editor.IOverlayWidget = {
      getId: () => `aiall-git-hunk-overlay-${mode}-${hunk.index}`,
      getDomNode: () => dom,
      // null → we position manually (top/right) so clicks always hit the button
      getPosition: () => null,
    };
    editor.addOverlayWidget(widget);
    hunkOverlays.push({ widget, startLine, dom });
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
  },
);

onMounted(() => {
  void initMonaco();
});

onBeforeUnmount(() => {
  if (hunkZoneTimer) window.clearTimeout(hunkZoneTimer);
  scrollDisposable?.dispose();
  layoutDisposable?.dispose();
  scrollDisposable = null;
  layoutDisposable = null;
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
.monaco-git-hunk-zone {
  box-sizing: border-box;
  width: 100%;
  background: linear-gradient(
    90deg,
    rgba(88, 166, 255, 0.02),
    rgba(88, 166, 255, 0.1) 45%,
    rgba(88, 166, 255, 0.14)
  );
  border-bottom: 1px solid rgba(88, 166, 255, 0.2);
}

.monaco-git-hunk-widget {
  position: absolute;
  z-index: 50;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
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
