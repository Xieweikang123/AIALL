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
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

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
  const { text, refs, drops, imageDataUrls } = extractPayload();
  return Boolean(text.trim() || refs.length || drops.length || imageDataUrls.length);
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
  }
}

/** Read an image file into a data URL. */
function readImageAsDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** Extract image data URLs from ClipboardEvent (paste). */
async function extractImagesFromClipboard(e: ClipboardEvent): Promise<string[]> {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const urls: string[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        const url = await readImageAsDataUrl(file);
        if (url) urls.push(url);
      }
    }
  }
  return urls;
}

async function onPaste(e: ClipboardEvent) {
  e.preventDefault();

  // Try images first
  const imageUrls = await extractImagesFromClipboard(e);
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
  min-width: 120px;
  min-height: 24px;
  max-height: 160px;
  overflow-y: auto;
  outline: none;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text, rgba(255, 255, 255, 0.92));
  word-break: break-word;
  white-space: pre-wrap;
}

.composer-editor.empty::before {
  content: attr(data-placeholder);
  position: absolute;
  inset: 0 auto auto 0;
  color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
  user-select: none;
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
  pointer-events: none;
}
</style>
