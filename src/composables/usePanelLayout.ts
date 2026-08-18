import { ref, computed, onBeforeUnmount, getCurrentInstance, type Ref } from "vue";
import { lsGet, lsSet, lsGetJson, lsSetJson } from "../utils/localStorageSafe";

const PANEL_WIDTH_KEY = "vibe-coding-panel-widths";
const EDITOR_COLLAPSED_KEY = "vibe-coding-editor-collapsed";
const CHAT_COLLAPSED_KEY = "vibe-coding-chat-collapsed";
const FILE_COLLAPSED_KEY = "vibe-coding-file-collapsed";

const FILE_MIN_WIDTH = 180;
const FILE_MAX_WIDTH = 500;
const CHAT_MIN_WIDTH = 260;
const CHAT_MAX_WIDTH = 1200;
const EDITOR_MIN_WIDTH = 280;
const RESIZE_HANDLES_WIDTH = 8;
export const MOBILE_BREAKPOINT = 768;

export type MobileTab = "chat" | "editor" | "files" | "git";

export function usePanelLayout(workspaceRef: Ref<HTMLElement | null>) {
  const isMobileView = ref(typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false);
  const activeMobileTab = ref<MobileTab>("chat");

  function checkMobileView() {
    if (typeof window === "undefined") return;
    isMobileView.value = window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function switchMobileTab(tab: MobileTab) {
    activeMobileTab.value = tab;
  }

  function loadPanelWidths(): { file: number; chat: number } {
    const parsed = lsGetJson<{ file?: number; chat?: number }>(PANEL_WIDTH_KEY);
    if (parsed && typeof parsed.file === "number" && typeof parsed.chat === "number") {
      return { file: parsed.file, chat: parsed.chat };
    }
    return { file: 280, chat: 360 };
  }

  function savePanelWidths() {
    lsSetJson(PANEL_WIDTH_KEY, { file: filePanelWidth.value, chat: chatPanelWidth.value });
  }

  function loadEditorCollapsed(): boolean {
    return lsGet(EDITOR_COLLAPSED_KEY) === "1";
  }

  function saveEditorCollapsed() {
    lsSet(EDITOR_COLLAPSED_KEY, editorCollapsed.value ? "1" : "0");
  }

  function loadChatCollapsed(): boolean {
    return lsGet(CHAT_COLLAPSED_KEY) === "1";
  }

  function saveChatCollapsed() {
    lsSet(CHAT_COLLAPSED_KEY, chatCollapsed.value ? "1" : "0");
  }

  function loadFilePanelCollapsed(): boolean {
    return lsGet(FILE_COLLAPSED_KEY) === "1";
  }

  function saveFilePanelCollapsed() {
    lsSet(FILE_COLLAPSED_KEY, filePanelCollapsed.value ? "1" : "0");
  }

  const savedWidths = loadPanelWidths();
  const filePanelWidth = ref(savedWidths.file);
  const chatPanelWidth = ref(savedWidths.chat);
  const editorCollapsed = ref(loadEditorCollapsed());
  const chatCollapsed = ref(loadChatCollapsed());
  const filePanelCollapsed = ref(loadFilePanelCollapsed());
  const isResizing = ref(false);

  let resizeType: "file" | "chat" | null = null;
  let startX = 0;
  let startWidth = 0;

  const chatPanelStyle = computed(() => {
    if (editorCollapsed.value) {
      return { flex: "1", minWidth: `${CHAT_MIN_WIDTH}px`, width: "auto" };
    }
    return { width: `${chatPanelWidth.value}px`, flexShrink: "0" };
  });

  function getWorkspaceWidth(): number {
    return workspaceRef.value?.clientWidth || window.innerWidth;
  }

  function getChatPanelMaxWidth(): number {
    const workspace = getWorkspaceWidth();
    if (editorCollapsed.value) {
      return Math.max(CHAT_MIN_WIDTH, workspace - filePanelWidth.value - RESIZE_HANDLES_WIDTH - 24);
    }
    const byRatio = Math.floor(workspace * 0.78);
    const byEditor = workspace - filePanelWidth.value - EDITOR_MIN_WIDTH - RESIZE_HANDLES_WIDTH;
    return Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, byRatio, byEditor));
  }

  function startResize(type: "file" | "chat", e: MouseEvent) {
    e.preventDefault();
    isResizing.value = true;
    resizeType = type;
    startX = e.clientX;
    startWidth = type === "file" ? filePanelWidth.value : chatPanelWidth.value;
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onResize(e: MouseEvent) {
    if (!isResizing.value || !resizeType) return;
    const delta = e.clientX - startX;
    if (resizeType === "file") {
      filePanelWidth.value = Math.min(Math.max(FILE_MIN_WIDTH, startWidth + delta), FILE_MAX_WIDTH);
    } else {
      chatPanelWidth.value = Math.min(Math.max(CHAT_MIN_WIDTH, startWidth - delta), getChatPanelMaxWidth());
    }
  }

  function stopResize() {
    isResizing.value = false;
    resizeType = null;
    savePanelWidths();
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function nudgePanelWidth(type: "file" | "chat", delta: number) {
    if (type === "file") {
      filePanelWidth.value = Math.min(
        Math.max(FILE_MIN_WIDTH, filePanelWidth.value + delta),
        FILE_MAX_WIDTH,
      );
    } else {
      chatPanelWidth.value = Math.min(
        Math.max(CHAT_MIN_WIDTH, chatPanelWidth.value + delta),
        getChatPanelMaxWidth(),
      );
    }
    savePanelWidths();
  }

  function onResizeKeydown(type: "file" | "chat", e: KeyboardEvent) {
    const step = e.shiftKey ? 40 : 12;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudgePanelWidth(type, type === "file" ? -step : step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nudgePanelWidth(type, type === "file" ? step : -step);
    }
  }

  function collapseEditor() {
    editorCollapsed.value = true;
    saveEditorCollapsed();
  }

  function expandEditor() {
    editorCollapsed.value = false;
    saveEditorCollapsed();
  }

  function collapseChat() {
    chatCollapsed.value = true;
    saveChatCollapsed();
  }

  function expandChat() {
    chatCollapsed.value = false;
    saveChatCollapsed();
  }

  function collapseFilePanel() {
    filePanelCollapsed.value = true;
    saveFilePanelCollapsed();
  }

  function expandFilePanel() {
    filePanelCollapsed.value = false;
    saveFilePanelCollapsed();
  }

  if (typeof window !== "undefined" && getCurrentInstance()) {
    window.addEventListener("resize", checkMobileView, { passive: true });
    window.addEventListener("orientationchange", checkMobileView, { passive: true });
    onBeforeUnmount(() => {
      window.removeEventListener("resize", checkMobileView);
      window.removeEventListener("orientationchange", checkMobileView);
      document.removeEventListener("mousemove", onResize);
      document.removeEventListener("mouseup", stopResize);
    });
  }

  return {
    filePanelWidth,
    chatPanelWidth,
    editorCollapsed,
    chatCollapsed,
    filePanelCollapsed,
    isResizing,
    isMobileView,
    activeMobileTab,
    switchMobileTab,
    checkMobileView,
    chatPanelStyle,
    startResize,
    stopResize,
    nudgePanelWidth,
    onResizeKeydown,
    collapseEditor,
    expandEditor,
    collapseChat,
    expandChat,
    collapseFilePanel,
    expandFilePanel,
    getChatPanelMaxWidth,
    CHAT_MIN_WIDTH,
    CHAT_MAX_WIDTH,
    FILE_MIN_WIDTH,
    FILE_MAX_WIDTH,
    EDITOR_MIN_WIDTH,
    RESIZE_HANDLES_WIDTH,
  };
}
