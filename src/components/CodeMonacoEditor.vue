<template>
  <div class="monaco-wrap">
    <div v-if="loading" class="monaco-loading"><span class="shimmer-text">加载编辑器…</span></div>
    <div ref="containerRef" class="monaco-editor-host" :class="{ hidden: loading }" />
    
    <!-- Minimap 右键设置菜单 -->
    <Teleport to="body">
      <div
        v-if="showMinimapSettings"
        class="minimap-context-menu"
        :style="{ left: minimapMenuPos.x + 'px', top: minimapMenuPos.y + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <div class="minimap-ctx-header">Minimap 设置</div>
        <div class="minimap-ctx-item">
          <label>Render Characters</label>
          <input type="checkbox" v-model="minimapSettings.renderCharacters" @change="applyMinimapSettings" />
        </div>
        <div class="minimap-ctx-item">
          <label>Vertical size</label>
          <select v-model="minimapSettings.size" @change="applyMinimapSettings">
            <option value="proportional">proportional</option>
            <option value="fill">fill</option>
            <option value="fit">fit</option>
          </select>
        </div>
        <div class="minimap-ctx-item">
          <label>Slider</label>
          <select v-model="minimapSettings.showSlider" @change="applyMinimapSettings">
            <option value="always">always</option>
            <option value="mouseover">mouseover</option>
          </select>
        </div>
        <div class="minimap-ctx-item">
          <label>Side</label>
          <select v-model="minimapSettings.side" @change="applyMinimapSettings">
            <option value="right">right</option>
            <option value="left">left</option>
          </select>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type * as Monaco from "monaco-editor";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { languageFromFilePath } from "../utils/monacoLanguage";
import { setupNpmScriptHover } from "../utils/monacoNpmScriptHover";
import { lsGet, lsSetJson } from "../utils/localStorageSafe";

const props = defineProps<{
  modelValue: string;
  filePath?: string;
  language?: string;
  readOnly?: boolean;
}>();

export type MonacoSelectionAnchor = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  save: [];
  select: [text: string, anchor: MonacoSelectionAnchor | null];
}>();

const containerRef = ref<HTMLElement | null>(null);
const loading = ref(true);

let monaco: typeof Monaco | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let model: Monaco.editor.ITextModel | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeLayoutRaf = 0;
let suppressEmit = false;
let minimapRightClickBound = false;

function resolveLanguage(): string {
  if (props.language) return props.language;
  if (props.filePath) return languageFromFilePath(props.filePath);
  return "plaintext";
}

function resolveUri(): Monaco.Uri {
  if (!monaco) throw new Error("Monaco not loaded");
  const filePath = props.filePath?.trim();
  if (!filePath) return monaco.Uri.parse("inmemory://model/untitled");
  if (
    filePath.startsWith("untitled://") ||
    filePath.startsWith("git-index://") ||
    filePath.startsWith("git-history://")
  ) {
    return monaco.Uri.parse(`inmemory://model/${encodeURIComponent(filePath)}`);
  }
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

// Minimap 设置（4 项，与 Monaco Editor 原生设置面板一致）
const showMinimapSettings = ref(false);
const minimapSettings = ref({
  renderCharacters: true,
  size: "proportional" as "proportional" | "fill" | "fit",
  showSlider: "always" as "always" | "mouseover",
  side: "right" as "left" | "right",
});

// Minimap 右键菜单位置
const minimapMenuPos = ref({ x: 0, y: 0 });

function showMinimapContextMenu(e: Event) {
  const me = e as MouseEvent;
  me.preventDefault();
  me.stopPropagation();
  const menuW = 280;
  const menuH = 200;
  let x = me.clientX - menuW;
  let y = me.clientY;
  if (x < 0) x = 8;
  if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 8;
  if (y < 0) y = 8;
  minimapMenuPos.value = { x, y };
  showMinimapSettings.value = true;
}

function applyMinimapSettings() {
  if (!editor) return;
  lsSetJson("monaco-minimap-settings", minimapSettings.value);
  editor.updateOptions({
    minimap: {
      enabled: true,
      renderCharacters: minimapSettings.value.renderCharacters,
      size: minimapSettings.value.size,
      showSlider: minimapSettings.value.showSlider,
      side: minimapSettings.value.side,
    },
  });
}

function loadMinimapSettings() {
  const saved = lsGet("monaco-minimap-settings");
  if (!saved) return;
  try {
    const p = JSON.parse(saved);
    minimapSettings.value = {
      renderCharacters: p.renderCharacters ?? true,
      size: p.size ?? "proportional",
      showSlider: p.showSlider ?? "always",
      side: p.side ?? "right",
    };
  } catch {}
}

function getSelectionAnchorRect(monacoSelection: Monaco.IRange): MonacoSelectionAnchor | null {
  if (!editor) return null;
  const domNode = editor.getDomNode();
  if (!domNode) return null;

  const startPos = editor.getScrolledVisiblePosition({
    lineNumber: monacoSelection.startLineNumber,
    column: monacoSelection.startColumn,
  });
  if (!startPos) return null;

  const editorRect = domNode.getBoundingClientRect();
  let width = 80;
  if (monacoSelection.startLineNumber === monacoSelection.endLineNumber) {
    const endPos = editor.getScrolledVisiblePosition({
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

function createEditor() {
  const container = containerRef.value;
  if (!container || !monaco) return;

  editor = monaco.editor.create(container, {
    theme: "vs-dark",
    automaticLayout: false,
    fontSize: 14,
    fontFamily: "Cascadia Code, Consolas, 'Courier New', monospace",
    fontLigatures: true,
    minimap: {
      enabled: true,
      renderCharacters: minimapSettings.value.renderCharacters,
      size: minimapSettings.value.size,
      showSlider: minimapSettings.value.showSlider,
      side: minimapSettings.value.side,
    },
    scrollBeyondLastLine: false,
    mouseWheelScrollSensitivity: 3,
    fastScrollSensitivity: 8,
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

  function emitSelectionChange() {
    if (!editor) return;
    const model = editor.getModel();
    const monacoSelection = editor.getSelection();
    if (!model || !monacoSelection || monacoSelection.isEmpty()) {
      emit("select", "", null);
      return;
    }
    const text = model.getValueInRange(monacoSelection).trim();
    if (!text) {
      emit("select", "", null);
      return;
    }
    emit("select", text, getSelectionAnchorRect(monacoSelection));
  }

  editor.onDidChangeCursorSelection(() => {
    emitSelectionChange();
  });

  editor.onDidScrollChange(() => {
    emit("select", "", null);
  });

  resizeObserver = new ResizeObserver(() => {
    if (resizeLayoutRaf) return;
    resizeLayoutRaf = requestAnimationFrame(() => {
      resizeLayoutRaf = 0;
      editor?.layout();
    });
  });
  resizeObserver.observe(container);

  // minimap DOM 在 editor 创建后才生成，延迟绑定右键（仅此处绑定一次）
  setTimeout(setupMinimapRightClick, 500);
}

async function initMonaco() {
  await import("../utils/monacoSetup");
  await import("monaco-editor/min/vs/editor/editor.main.css");
  monaco = await import("monaco-editor");
  setupNpmScriptHover(monaco);
  loadMinimapSettings();
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

// 点击外部关闭右键菜单
function handleContextMenuClose(e: MouseEvent) {
  const menu = document.querySelector('.minimap-context-menu');
  if (menu && !menu.contains(e.target as Node)) {
    showMinimapSettings.value = false;
  }
}

// 给 minimap 元素绑定右键菜单（幂等，避免重复注册）
function setupMinimapRightClick() {
  const minimapEl = containerRef.value?.querySelector('.minimap');
  if (!minimapEl || minimapRightClickBound) return;
  minimapEl.addEventListener('contextmenu', showMinimapContextMenu);
  minimapRightClickBound = true;
}

function cleanupMinimapRightClick() {
  const minimapEl = containerRef.value?.querySelector('.minimap');
  if (minimapEl) {
    minimapEl.removeEventListener('contextmenu', showMinimapContextMenu);
  }
  minimapRightClickBound = false;
}

onMounted(() => {
  void initMonaco();
  document.addEventListener('click', handleContextMenuClose);
});

onBeforeUnmount(() => {
  cleanupMinimapRightClick();
  document.removeEventListener('click', handleContextMenuClose);
  if (resizeLayoutRaf) {
    cancelAnimationFrame(resizeLayoutRaf);
    resizeLayoutRaf = 0;
  }
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
  display: none;
}

.shimmer-text {
  background: linear-gradient(90deg, rgba(255,255,255,0.4) 25%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.4) 75%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Minimap 右键上下文菜单 */
.minimap-context-menu {
  position: fixed;
  width: 280px;
  background: rgba(24, 28, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 12px;
  z-index: 9999;
}

.minimap-ctx-header {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.minimap-ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  gap: 8px;
}

.minimap-ctx-item label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  flex-shrink: 0;
}

.minimap-ctx-item input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #5b8def;
  cursor: pointer;
}

.minimap-ctx-item select {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  font-size: 12px;
  background: rgba(30, 35, 50, 0.9);
  color: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  cursor: pointer;
  outline: none;
}

.minimap-ctx-item select:focus {
  border-color: rgba(91, 141, 239, 0.5);
}
</style>
