<template>
  <div
    ref="editorRef"
    class="composer-editor"
    :class="{ empty: isEmpty, focused: focused, disabled }"
    :data-placeholder="placeholder"
    contenteditable="true"
    :aria-disabled="disabled"
    @input="onInput"
    @keydown="onKeydown"
    @paste="onPaste"
    @focus="onFocus"
    @blur="onBlur"
    @mousedown="onMouseDown"
  />
  
  <!-- 图片查看器模态框 -->
  <Teleport to="body">
    <Transition name="image-viewer-fade">
      <div
        v-if="imageViewerVisible"
        class="image-viewer-overlay"
        tabindex="-1"
        ref="imageViewerOverlay"
        @click="closeImageViewer"
        @keydown.escape="closeImageViewer"
      >
        <div class="image-viewer-container" @click.stop>
          <button class="image-viewer-close" @click="closeImageViewer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <img
            :src="imageViewerSrc"
            class="image-viewer-image"
            alt="查看图片"
            @click.stop
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

// 图片查看器状态
const imageViewerVisible = ref(false);
const imageViewerSrc = ref("");
const imageViewerOverlay = ref<HTMLDivElement>();

function openImageViewer(src: string) {
  imageViewerSrc.value = src;
  imageViewerVisible.value = true;
  // 阻止背景滚动
  document.body.style.overflow = "hidden";
  // 自动聚焦，使 ESC 按键可被捕获
  nextTick(() => imageViewerOverlay.value?.focus());
}

function closeImageViewer() {
  imageViewerVisible.value = false;
  imageViewerSrc.value = "";
  // 恢复背景滚动
  document.body.style.overflow = "";
}

export interface ComposerReferencedFile {
  name: string;
  path: string;
  relative: string;
}

export interface ComposerDroppedFile {
  name: string;
  path: string;
  content: string;
}

export interface ComposerPayload {
  text: string;
  refs: ComposerReferencedFile[];
  drops: ComposerDroppedFile[];
  imageDataUrls: string[];
}

const CHIP = "composer-chip";
const CHIP_REF = "composer-chip-ref";
const CHIP_DROP = "composer-chip-drop";
const CHIP_IMAGE = "composer-chip-image";

const props = defineProps<{
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "mention-change": [payload: { open: boolean; query: string }];
  "enter-send": [];
  "update:empty": [empty: boolean];
  "image-error": [message: string];
  focus: [];
  blur: [];
}>();

const editorRef = ref<HTMLDivElement | null>(null);
const focused = ref(false);
const isEmpty = ref(true);
const pendingImages = ref<string[]>([]);

watch(
  () => props.disabled,
  (disabled) => {
    if (editorRef.value) {
      editorRef.value.contentEditable = disabled ? "false" : "true";
    }
  },
  { immediate: true },
);

function focus() {
  editorRef.value?.focus();
}

function onFocus() {
  focused.value = true;
  emit("focus");
}

function onBlur() {
  focused.value = false;
  emit("blur");
}

function isChip(el: Element | null): el is HTMLElement {
  return Boolean(el?.classList?.contains(CHIP));
}

function insertNodesAtCursor(nodes: Node[], addTrailingSpace = true) {
  const root = editorRef.value;
  if (!root) return;
  root.focus();

  const sel = window.getSelection();
  let range: Range;

  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  } else {
    range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    } else {
      range = range.cloneRange();
      range.deleteContents();
    }
  }

  for (const node of nodes) {
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  }

  if (addTrailingSpace) {
    const space = document.createTextNode("\u00A0");
    range.insertNode(space);
    range.setStartAfter(space);
    range.collapse(true);
  }

  sel?.removeAllRanges();
  sel?.addRange(range);
}

function createRefChip(file: ComposerReferencedFile): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `${CHIP} ${CHIP_REF}`;
  chip.contentEditable = "false";
  chip.dataset.refPath = file.path;
  chip.dataset.refRelative = file.relative;
  chip.dataset.refName = file.name;
  chip.textContent = `@${file.relative}`;
  return chip;
}

function createDropChip(file: ComposerDroppedFile): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `${CHIP} ${CHIP_DROP}`;
  chip.contentEditable = "false";
  chip.dataset.dropPath = file.path;
  chip.dataset.dropName = file.name;
  chip.dataset.dropContent = file.content;
  chip.textContent = `📄${file.name}`;
  return chip;
}

function createImageChip(dataUrl: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `${CHIP} ${CHIP_IMAGE}`;
  chip.contentEditable = "false";
  chip.dataset.imageUrl = dataUrl;
  const img = document.createElement("img");
  img.src = dataUrl;
  img.className = "composer-image-preview";
  img.draggable = false;
  // 添加点击事件，打开图片查看器
  img.addEventListener("click", (e) => {
    e.stopPropagation(); // 阻止事件冒泡到编辑器
    openImageViewer(dataUrl);
  });
  chip.appendChild(img);
  return chip;
}

function insertFileRef(file: ComposerReferencedFile) {
  removeMentionQueryBeforeCursor();
  insertNodesAtCursor([createRefChip(file)]);
  syncEmpty();
  emitMentionChange();
}

function insertDroppedFile(file: ComposerDroppedFile) {
  insertNodesAtCursor([createDropChip(file)]);
  syncEmpty();
}

function insertImage(dataUrl: string) {
  insertNodesAtCursor([createImageChip(dataUrl)]);
  syncEmpty();
}

function getPlainTextBeforeCursor(): string {
  const root = editorRef.value;
  const sel = window.getSelection();
  if (!root || !sel || !sel.rangeCount) return "";
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString();
}
function removeMentionQueryBeforeCursor(): boolean {
  const before = getPlainTextBeforeCursor();
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return false;

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;

  const deleteCount = match[2].length + 1;
  for (let i = 0; i < deleteCount; i++) {
    sel.modify("extend", "backward", "character");
  }
  sel.deleteFromDocument();
  sel.collapseToEnd();
  return true;
}

function extractPayload(): ComposerPayload {
  const root = editorRef.value;
  const refs: ComposerReferencedFile[] = [];
  const drops: ComposerDroppedFile[] = [];
  const imageDataUrls: string[] = [];
  const textParts: string[] = [];

  if (!root) {
    return { text: "", refs, drops, imageDataUrls };
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      textParts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    if (el.classList.contains(CHIP_REF)) {
      refs.push({
        path: el.dataset.refPath ?? "",
        relative: el.dataset.refRelative ?? "",
        name: el.dataset.refName ?? "",
      });
      textParts.push(`@${el.dataset.refRelative ?? ""}`);
      return;
    }

    if (el.classList.contains(CHIP_DROP)) {
      drops.push({
        path: el.dataset.dropPath ?? "",
        name: el.dataset.dropName ?? "",
        content: el.dataset.dropContent ?? "",
      });
      textParts.push(el.textContent ?? "");
      return;
    }

    if (el.classList.contains(CHIP_IMAGE)) {
      const url = el.dataset.imageUrl ?? "";
      if (url) {
        imageDataUrls.push(url);
      }
      return;
    }

    if (el.tagName === "BR") {
      textParts.push("\n");
      return;
    }

    if (el.tagName === "DIV" && el !== root) {
      if (textParts.length && !textParts[textParts.length - 1]?.endsWith("\n")) {
        textParts.push("\n");
      }
    }

    el.childNodes.forEach(walk);
  }

  root.childNodes.forEach(walk);

  return {
    text: textParts.join("").replace(/\u00A0/g, " ").replace(/\n+$/, ""),
    refs,
    drops,
    imageDataUrls,
  };
}

function clear() {
  const root = editorRef.value;
  if (!root) return;
  root.innerHTML = "";
  syncEmpty();
  emitMentionChange();
}

function setPlainText(text: string) {
  const root = editorRef.value;
  if (!root) return;
  root.innerHTML = "";
  if (text) {
    root.appendChild(document.createTextNode(text));
  }
  syncEmpty();
  emitMentionChange();
}

function hasContent(): boolean {
  const root = editorRef.value;
  if (!root) return false;
  // 快速检查：如果有任何子元素（chip、图片等），或 textContent 非空，则有内容
  if (root.childElementCount > 0) return true;
  const text = root.textContent ?? "";
  if (text.trim()) return true;
  // 回退到完整的 payload 提取
  const { refs, drops, imageDataUrls } = extractPayload();
  return Boolean(refs.length || drops.length || imageDataUrls.length);
}

function syncEmpty() {
  const empty = !hasContent();
  if (isEmpty.value !== empty) {
    isEmpty.value = empty;
    emit("update:empty", empty);
  }
}

function emitMentionChange() {
  const before = getPlainTextBeforeCursor();
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (match) {
    emit("mention-change", { open: true, query: match[2] });
    return;
  }
  emit("mention-change", { open: false, query: "" });
}

function onInput() {
  syncEmpty();
  emitMentionChange();
}

function onMouseDown(e: MouseEvent) {
  if (props.disabled) {
    e.preventDefault();
    // 仍然允许聚焦以便查看内容
    editorRef.value?.focus();
  }
}

/** Read an image file into a data URL. */
function readImageAsDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => reject(new Error(`Cannot read "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

/** Extract image data URLs from ClipboardEvent (paste). */
async function extractImagesFromClipboard(e: ClipboardEvent): Promise<{ urls: string[]; errors: string[] }> {
  const items = e.clipboardData?.items;
  if (!items) return { urls: [], errors: [] };
  const urls: string[] = [];
  const errors: string[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        try {
          const url = await readImageAsDataUrl(file);
          if (url) urls.push(url);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : `Cannot read "${file.name}"`);
        }
      }
    }
  }
  return { urls, errors };
}

async function onPaste(e: ClipboardEvent) {
  e.preventDefault();

  // Try images first
  const { urls: imageUrls, errors: imageErrors } = await extractImagesFromClipboard(e);
  if (imageErrors.length) {
    emit("image-error", imageErrors.join("\n"));
  }
  if (imageUrls.length) {
    for (const url of imageUrls) {
      insertImage(url);
    }
    syncEmpty();
    return;
  }

  // Fall back to text
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (!text) return;
  insertNodesAtCursor([document.createTextNode(text)], false);
  syncEmpty();
  emitMentionChange();
}

function removeChipBeforeCursor(): boolean {
  const sel = window.getSelection();
  const root = editorRef.value;
  if (!sel || !sel.rangeCount || !root) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;

  const { startContainer, startOffset } = range;
  let chip: HTMLElement | null = null;

  if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
    const prev = startContainer.previousSibling;
    if (isChip(prev as Element)) chip = prev as HTMLElement;
  } else if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 1 && startContainer.textContent === "\u00A0") {
    const prev = startContainer.previousSibling;
    if (isChip(prev as Element)) chip = prev as HTMLElement;
  } else if (startContainer === root) {
    const prev = startOffset > 0 ? root.childNodes[startOffset - 1] : null;
    if (isChip(prev as Element)) chip = prev as HTMLElement;
  } else if (startContainer.nodeType === Node.ELEMENT_NODE && startOffset > 0) {
    const prev = startContainer.childNodes[startOffset - 1];
    if (isChip(prev as Element)) chip = prev as HTMLElement;
  }

  if (!chip) return false;
  const next = chip.nextSibling;
  if (next?.nodeType === Node.TEXT_NODE && next.textContent === "\u00A0") {
    next.remove();
  }
  chip.remove();
  syncEmpty();
  emitMentionChange();
  return true;
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return;

  if (e.key === "Backspace") {
    if (removeChipBeforeCursor()) {
      e.preventDefault();
    }
    return;
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    emit("enter-send");
  }
}

defineExpose({
  focus,
  insertFileRef,
  insertDroppedFile,
  insertImage,
  extractPayload,
  clear,
  setPlainText,
  hasContent,
  removeMentionQueryBeforeCursor,
});

void nextTick(() => syncEmpty());
</script>

<style scoped>
.composer-editor {
  position: relative;
  flex: 1 1 120px;
  min-width: 0;
  width: 100%;
  min-height: 100%;
  max-height: 160px;
  overflow-x: hidden;
  overflow-y: auto;
  outline: none;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text, rgba(255, 255, 255, 0.92));
  word-break: break-word;
  white-space: pre-wrap;
  padding: 8px 12px;
  box-sizing: border-box;

  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.composer-editor::-webkit-scrollbar {
  width: 6px;
}

.composer-editor::-webkit-scrollbar-track {
  background: transparent;
}

.composer-editor::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.composer-editor::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

.composer-editor.empty {
  overflow-y: hidden;
}

.composer-editor.empty::before {
  content: attr(data-placeholder);
  position: absolute;
  inset: 0;
  padding: 8px 12px;
  color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
  user-select: none;
  line-height: inherit;
}

.composer-editor.focused {
  /* 聚焦指示由外层 .chat-input-box.focused border-color 统一展示，此处不再重复 */
}

.composer-editor.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.composer-editor :deep(.composer-chip) {
  display: inline;
  padding: 1px 6px;
  margin: 0 1px;
  border-radius: 5px;
  font-size: 12px;
  line-height: 1.45;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  vertical-align: baseline;
  user-select: none;
  white-space: nowrap;
}

.composer-editor :deep(.composer-chip-ref) {
  background: rgba(179, 146, 240, 0.22);
  border: 1px solid rgba(179, 146, 240, 0.38);
  color: #e8d9ff;
}

.composer-editor :deep(.composer-chip-drop) {
  background: rgba(31, 111, 235, 0.2);
  border: 1px solid rgba(31, 111, 235, 0.32);
  color: #d6e8ff;
}

.composer-editor :deep(.composer-chip-image) {
  display: inline-block;
  padding: 2px;
  margin: 2px 1px;
  border-radius: 6px;
  background: rgba(31, 111, 235, 0.15);
  border: 1px solid rgba(31, 111, 235, 0.3);
  vertical-align: bottom;
  line-height: 0;
}

.composer-editor :deep(.composer-image-preview) {
  display: block;
  max-width: 120px;
  max-height: 80px;
  border-radius: 4px;
  object-fit: contain;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.composer-editor :deep(.composer-image-preview:hover) {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* 图片查看器样式 - 全局样式 */
.image-viewer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(8px);
}

.image-viewer-container {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-viewer-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.image-viewer-close {
  position: absolute;
  top: -40px;
  right: 0;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  color: white;
  padding: 0;
}

.image-viewer-close:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

.image-viewer-close svg {
  width: 16px;
  height: 16px;
}

/* 动画过渡 */
.image-viewer-fade-enter-active,
.image-viewer-fade-leave-active {
  transition: opacity 0.3s ease;
}

.image-viewer-fade-enter-from,
.image-viewer-fade-leave-to {
  opacity: 0;
}

.image-viewer-fade-enter-active .image-viewer-image,
.image-viewer-fade-leave-active .image-viewer-image {
  transition: transform 0.3s ease;
}

.image-viewer-fade-enter-from .image-viewer-image {
  transform: scale(0.8);
}

.image-viewer-fade-leave-to .image-viewer-image {
  transform: scale(0.8);
}
</style>
