import { ref } from "vue";
import { readFile } from "../services/vibeCodingClient";
import type FileTreeNode from "../components/FileTreeNode.vue";
type TreeNode = InstanceType<typeof FileTreeNode>["$props"]["node"];

export interface ReferencedFile {
  name: string;
  path: string;
  relative: string;
}

export interface DragGhost {
  relative: string;
  x: number;
  y: number;
}

export function useFileDrag(
  projectPath: () => string,
  insertFileRef?: (ref: ReferencedFile) => void,
  insertDroppedFile?: (file: { name: string; path: string; content: string }) => void,
) {
  const isDragging = ref(false);
  const fileDragGhost = ref<DragGhost | null>(null);
  let dragCounter = 0;

  const FILE_DRAG_THRESHOLD_PX = 5;

  function buildReferencedFile(path: string, name: string): ReferencedFile {
    const root = projectPath().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    const full = path.replace(/\\/g, "/");
    const relative =
      root && full.toLowerCase().startsWith(`${root}/`) ? full.slice(root.length + 1) : name;
    return { name, path, relative };
  }

  function isPointOverChatDropZone(x: number, y: number, el: HTMLElement | null): boolean {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function canAcceptChatDrag(e: DragEvent): boolean {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes("Files");
  }

  function acceptChatFileDrag(e: DragEvent) {
    if (!canAcceptChatDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    isDragging.value = true;
  }

  function attachFileToChat(path: string, name?: string) {
    if (!projectPath()) return;
    insertFileRef?.(buildReferencedFile(path, name ?? path.split(/[\\/]/).pop() ?? path));
  }

  function onFileDragStart(node: TreeNode, x: number, y: number, chatDropZoneEl: HTMLElement | null) {
    const file = buildReferencedFile(node.path, node.name);
    fileDragGhost.value = { relative: file.relative, x, y };
    isDragging.value = isPointOverChatDropZone(x, y, chatDropZoneEl);
  }

  function onFileDragMove(x: number, y: number, chatDropZoneEl: HTMLElement | null) {
    if (!fileDragGhost.value) return;
    fileDragGhost.value = { ...fileDragGhost.value, x, y };
    isDragging.value = isPointOverChatDropZone(x, y, chatDropZoneEl);
  }

  function onFileDragEnd(node: TreeNode, x: number, y: number, chatDropZoneEl: HTMLElement | null) {
    if (isPointOverChatDropZone(x, y, chatDropZoneEl)) {
      attachFileToChat(node.path, node.name);
    }
    fileDragGhost.value = null;
    isDragging.value = false;
  }

  function startPathDrag(
    path: string,
    name: string,
    e: PointerEvent,
    onTap: () => void,
    chatDropZoneEl: HTMLElement | null,
  ) {
    if (e.button !== 0) return;
    e.preventDefault();

    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    const stubNode: TreeNode = { path, name, isDirectory: false, isFile: true, extension: name.includes(".") ? name.split(".").pop() ?? "" : "" };

    const cleanup = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < FILE_DRAG_THRESHOLD_PX) return;
      if (!dragging) {
        dragging = true;
        onFileDragStart(stubNode, ev.clientX, ev.clientY, chatDropZoneEl);
      }
      onFileDragMove(ev.clientX, ev.clientY, chatDropZoneEl);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      cleanup(ev);
      if (dragging) {
        onFileDragEnd(stubNode, ev.clientX, ev.clientY, chatDropZoneEl);
      } else {
        onTap();
      }
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  function onChatDragEnter(e: DragEvent) {
    if (!canAcceptChatDrag(e)) return;
    dragCounter++;
    acceptChatFileDrag(e);
  }

  function onChatDragOver(e: DragEvent) {
    acceptChatFileDrag(e);
  }

  function onChatDragLeave(e: DragEvent, chatDropZoneEl: HTMLElement | null) {
    const related = e.relatedTarget as Node | null;
    if (chatDropZoneEl && related && chatDropZoneEl.contains(related)) return;
    dragCounter--;
    if (dragCounter <= 0) {
      isDragging.value = false;
      dragCounter = 0;
    }
  }

  async function handleChatFileDrop(e: DragEvent) {
    isDragging.value = false;
    dragCounter = 0;

    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;

    for (const file of Array.from(files)) {
      const path = (file as File & { path?: string }).path || "";
      if (!path) continue;

      try {
        const result = await readFile(path);
        if (result.ok && insertDroppedFile) {
          insertDroppedFile({
            name: file.name,
            path,
            content: result.content,
          });
        }
      } catch {
        // ignore unreadable files
      }
    }
  }

  function onChatDrop(e: DragEvent, chatDropZoneEl: HTMLElement | null) {
    if (!canAcceptChatDrag(e) && !(e.dataTransfer?.files?.length)) return;
    e.preventDefault();
    e.stopPropagation();
    void handleChatFileDrop(e);
  }

  function onWindowDragEnd() {
    isDragging.value = false;
    dragCounter = 0;
  }

  function onDocumentDragOverCapture(e: DragEvent, chatDropZoneEl: HTMLElement | null) {
    if (!isPointOverChatDropZone(e.clientX, e.clientY, chatDropZoneEl)) return;
    acceptChatFileDrag(e);
  }

  function onDocumentDropCapture(e: DragEvent, chatDropZoneEl: HTMLElement | null) {
    if (!isPointOverChatDropZone(e.clientX, e.clientY, chatDropZoneEl)) return;
    if (!canAcceptChatDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    void handleChatFileDrop(e);
  }

  return {
    isDragging,
    fileDragGhost,
    buildReferencedFile,
    isPointOverChatDropZone,
    canAcceptChatDrag,
    acceptChatFileDrag,
    attachFileToChat,
    onFileDragStart,
    onFileDragMove,
    onFileDragEnd,
    startPathDrag,
    onChatDragEnter,
    onChatDragOver,
    onChatDragLeave,
    handleChatFileDrop,
    onChatDrop,
    onWindowDragEnd,
    onDocumentDragOverCapture,
    onDocumentDropCapture,
  };
}
