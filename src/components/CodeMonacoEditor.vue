<template>
  <div class="monaco-wrap">
    <div v-if="loading" class="monaco-loading"><span class="shimmer-text">加载编辑器…</span></div>
    <div ref="containerRef" class="monaco-editor-host" :class="{ hidden: loading }" />
  </div>
</template>

<script setup lang="ts">
import type * as Monaco from "monaco-editor";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { languageFromFilePath } from "../utils/monacoLanguage";

const props = defineProps<{
  modelValue: string;
  filePath?: string;
  language?: string;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  save: [];
  select: [text: string];
}>();

const containerRef = ref<HTMLElement | null>(null);
const loading = ref(true);

let monaco: typeof Monaco | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let model: Monaco.editor.ITextModel | null = null;
let resizeObserver: ResizeObserver | null = null;
let suppressEmit = false;

function resolveLanguage(): string {
  if (props.language) return props.language;
  if (props.filePath) return languageFromFilePath(props.filePath);
  return "plaintext";
}

function resolveUri(): Monaco.Uri {
  if (!monaco) throw new Error("Monaco not loaded");
  const filePath = props.filePath?.trim();
  if (!filePath) return monaco.Uri.parse("inmemory://model/untitled");
  const normalized = filePath.replace(/\\/g, "/");
  return monaco.Uri.parse(`file:///${normalized.startsWith("/") ? normalized.slice(1) : normalized}`);
}

function bindModel(content: string) {
  if (!editor || !monaco) return;

  const uri = resolveUri();
  const language = resolveLanguage();
  const existing = monaco.editor.getModel(uri);

  if (model && model.uri.toString() !== uri.toString()) {
    model.dispose();
    model = null;
  }

  if (existing) {
    model = existing;
    monaco.editor.setModelLanguage(model, language);
    suppressEmit = true;
    model.setValue(content);
    suppressEmit = false;
  } else {
    model = monaco.editor.createModel(content, language, uri);
  }

  editor.setModel(model);
}

function createEditor() {
  const container = containerRef.value;
  if (!container || !monaco) return;

  editor = monaco.editor.create(container, {
    theme: "vs-dark",
    automaticLayout: false,
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
    fontLigatures: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    wordWrap: "off",
    lineNumbers: "on",
    renderWhitespace: "selection",
    bracketPairColorization: { enabled: true },
    smoothScrolling: true,
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    padding: { top: 8, bottom: 8 },
    tabSize: 2,
    insertSpaces: true,
    renderLineHighlight: "all",
    guides: { bracketPairs: true, indentation: true },
    readOnly: props.readOnly ?? false,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
    },
  });

  bindModel(props.modelValue);

  editor.onDidChangeModelContent(() => {
    if (suppressEmit || !editor) return;
    const value = editor.getValue();
    emit("update:modelValue", value);
    emit("change", value);
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    emit("save");
  });

  editor.onDidChangeCursorSelection(() => {
    if (!editor) return;
    const selection = editor.getModel()?.getValueInRange(editor.getSelection() || { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 });
    if (selection && selection.trim()) {
      emit("select", selection);
    }
  });

  resizeObserver = new ResizeObserver(() => {
    editor?.layout();
  });
  resizeObserver.observe(container);
}

async function initMonaco() {
  await import("../utils/monacoSetup");
  await import("monaco-editor/min/vs/editor/editor.main.css");
  monaco = await import("monaco-editor");
  loading.value = false;
  await Promise.resolve();
  createEditor();
}

watch(
  () => props.modelValue,
  (value) => {
    if (!editor) return;
    const current = editor.getValue();
    if (value === current) return;
    suppressEmit = true;
    if (model) {
      model.setValue(value);
    } else {
      editor.setValue(value);
    }
    suppressEmit = false;
  },
);

watch(
  () => [props.filePath, props.language] as const,
  () => {
    if (!editor) return;
    bindModel(props.modelValue ?? '');
  },
);

watch(
  () => props.readOnly,
  (readOnly) => {
    editor?.updateOptions({ readOnly: readOnly ?? false });
  },
);

onMounted(() => {
  void initMonaco();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  editor?.dispose();
  editor = null;
  model?.dispose();
  model = null;
});

function getSelectedText(): string {
  if (!editor) return "";
  const selection = editor.getSelection();
  if (!selection) return "";
  return editor.getModel()?.getValueInRange(selection) || "";
}

function revealLine(line: number, column = 1): boolean {
  if (!editor || line < 1) return false;
  const model = editor.getModel();
  if (!model) return false;
  const safeLine = Math.min(Math.max(1, Math.floor(line)), model.getLineCount());
  const safeColumn = Math.max(1, column);
  editor.setPosition({ lineNumber: safeLine, column: safeColumn });
  editor.revealLineInCenter(safeLine);
  editor.focus();
  return true;
}

async function revealLineWhenReady(line: number, column = 1, maxAttempts = 24): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (revealLine(line, column)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

defineExpose({ getSelectedText, revealLine, revealLineWhenReady });
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
