<template>
  <div class="monaco-wrap">
    <div v-if="loading" class="monaco-loading">加载对比视图…</div>
    <div ref="containerRef" class="monaco-editor-host" :class="{ hidden: loading }" />
  </div>
</template>

<script setup lang="ts">
import type * as Monaco from "monaco-editor";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { languageFromFilePath } from "../utils/monacoLanguage";

const props = defineProps<{
  original: string;
  modified: string;
  filePath?: string;
  language?: string;
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

  setTimeout(() => {
    if (!diffEditor) return;
    diffEditor.revealFirstDiff();
  }, 200);
}

function createDiffEditor() {
  const container = containerRef.value;
  if (!container || !monaco) return;

  diffEditor = monaco.editor.createDiffEditor(container, {
    theme: "vs-dark",
    automaticLayout: false,
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
    readOnly: true,
    renderSideBySide: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    renderOverviewRuler: true,
  });

  bindModels();

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
  await Promise.resolve();
  createDiffEditor();
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
