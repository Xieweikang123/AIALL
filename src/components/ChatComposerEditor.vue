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
}

const CHIP = "composer-chip";
const CHIP_REF = "composer-chip-ref";
const CHIP_DROP = "composer-chip-drop";

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
  const textParts: string[] = [];

  if (!root) {
    return { text: "", refs, drops };
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
  const { text, refs, drops } = extractPayload();
  return Boolean(text.trim() || refs.length || drops.length);
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

function onPaste(e: ClipboardEvent) {
  e.preventDefault();
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
  color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
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
</style>
