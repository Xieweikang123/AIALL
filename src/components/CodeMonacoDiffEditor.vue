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

export type MonacoDiffSelectionAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const props = defineProps<{
  original: string;
  modified: string;
  filePath?: string;
  language?: string;
}>();

const emit = defineEmits<{
  select: [text: string, anchor: MonacoDiffSelectionAnchor | null];
}>();

const containerRef = ref<HTMLElement | null>(null);
const loading = ref(true);

let monaco: typeof Monaco | null = null;
let diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null;
let originalModel: Monaco.editor.ITextModel | null = null;
let modifiedModel: Monaco.editor.ITextModel | null = null;
let resizeObserver: ResizeObserver | null = null;

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

function bindModels() {
  if (!diffEditor || !monaco) return;

  const language = resolveLanguage();
  const uriBase = props.filePath?.replace(/\\/g, "/") || "untitled";

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

  // 模型绑定后延迟触发 layout + 滚动到第一处差异
  setTimeout(() => {
    if (!diffEditor) return;
    diffEditor.layout();
    diffEditor.revealFirstDiff();
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
    minimap: { enabled: false },
    renderOverviewRuler: true,
    ignoreTrimWhitespace: false,
  });

  bindModels();
  attachSelectionListeners(diffEditor.getOriginalEditor());
  attachSelectionListeners(diffEditor.getModifiedEditor());

  resizeObserver = new ResizeObserver(() => {
    diffEditor?.layout();
  });
  resizeObserver.observe(container);
}

async function initMonaco() {
  await import("../utils/monacoSetup");
  await import("monaco-editor/min/vs/editor/editor.main.css");
  monaco = await import("monaco-editor");
  loading.value = false;
  // 双重 rAF 确保 Vue 完成 DOM 更新、容器已获得正确尺寸
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  createDiffEditor();
  // 兜底：再延迟一次 layout
  setTimeout(() => diffEditor?.layout(), 150);
}

watch(
  () => [props.original, props.modified, props.filePath, props.language] as const,
  () => {
    bindModels();
  },
);

onMounted(() => {
  void initMonaco();
});

onBeforeUnmount(() => {
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
