import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { MonacoSelectionAnchor } from "../components/CodeMonacoEditor.vue";
import { fileName } from "../utils/vibeHelpers";
import { ESCAPE_DISMISS_PRIORITY, registerEscapeDismiss } from "./useEscapeDismiss";

export interface QuotedMessage {
  messageId: string;
  content: string;
  role: "user" | "assistant";
  /** 引用自左侧方案面板（非聊天气泡正文）或编辑器选区 */
  source?: "plan" | "editor";
  /** 编辑器引用时的文件路径（展示用） */
  filePath?: string;
}

export type QuoteMessageLike = {
  id: string;
  role: "user" | "assistant";
};

export type UseMessageQuoteOptions = {
  quoteButtonRef: Ref<HTMLElement | null>;
  getChatScrollEl: () => HTMLElement | null | undefined;
  expandChat: () => void;
  focusComposer: () => void;
  planPanelMessageId: Ref<string>;
  planWorkspaceOpen: Ref<boolean>;
  activeFilePath: Ref<string>;
  activeFileRelativePath: () => string;
  /** 替换旧的 quotedMessages 机制：选中内容后直接插入 Composer */
  onQuoteReady: (content: string, filePath?: string) => void;
};

function eventComposedPathIncludes(event: MouseEvent, selector: string): boolean {
  return event.composedPath().some(
    (node) => node instanceof Element && Boolean(node.closest(selector)),
  );
}

function clampQuoteButtonPosition(x: number, y: number, btnWidth: number, btnHeight: number) {
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - btnWidth - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - btnHeight - margin)),
  };
}

/** 选区包围盒在多行时会横跨整行宽度；优先用最后一行的 client rect 锚定按钮。 */
function selectionRectUsable(rect: DOMRect): boolean {
  return rect.width > 0 || rect.height > 0;
}

function getSelectionFocusRect(selection: Selection): DOMRect | null {
  const { focusNode, focusOffset } = selection;
  if (!focusNode) return null;

  const focusRange = document.createRange();
  try {
    focusRange.setStart(focusNode, focusOffset);
    focusRange.collapse(true);
  } catch {
    return null;
  }

  const focusRects = focusRange.getClientRects();
  for (let i = focusRects.length - 1; i >= 0; i--) {
    const rect = focusRects[i];
    if (rect.width > 0 || rect.height > 0) return rect;
  }

  const collapsed = focusRange.getBoundingClientRect();
  if (collapsed.width > 0 || collapsed.height > 0) return collapsed;

  const endRange = selection.getRangeAt(0).cloneRange();
  endRange.collapse(false);
  const endRects = endRange.getClientRects();
  if (endRects.length > 0) return endRects[endRects.length - 1]!;
  return endRange.getBoundingClientRect();
}

function getSelectionAnchorRect(selection: Selection): DOMRect | null {
  const range = selection.getRangeAt(0);
  const lineRects = Array.from(range.getClientRects()).filter(selectionRectUsable);
  if (lineRects.length > 0) {
    // 优先取第一行 rect，使引用按钮始终在选区顶部附近，
    // 避免多行选区时按钮出现在最后一行导致与选区视觉分离
    return lineRects[0]!;
  }

  const focusRect = getSelectionFocusRect(selection);
  if (focusRect && selectionRectUsable(focusRect)) return focusRect;

  const bounds = range.getBoundingClientRect();
  if (selectionRectUsable(bounds)) return bounds;
  return null;
}

export function useMessageQuote(options: UseMessageQuoteOptions) {
  const pendingQuote = ref<QuotedMessage | null>(null);
  const quoteButtonPosition = ref({ x: 0, y: 0 });
  const showQuoteButton = ref(false);
  const quoteButtonSource = ref<"chat" | "plan" | "editor" | null>(null);

  let quoteHiddenAt = 0;
  let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollQuoteHideHandler: (() => void) | null = null;

  function hideQuoteButtonNow() {
    showQuoteButton.value = false;
    pendingQuote.value = null;
    quoteButtonSource.value = null;
    quoteHiddenAt = Date.now();
  }

  async function showQuoteButtonAt(anchor: DOMRect | MonacoSelectionAnchor) {
    const margin = 8;
    const bottomSafe = 80; // 底部输入面板安全距离
    const estimatedWidth = 72;
    const estimatedHeight = 32;
    const maxBottom = window.innerHeight - bottomSafe;

    let x = anchor.left + (anchor.width - estimatedWidth) / 2;
    let y = anchor.top - estimatedHeight - margin;
    // 上方空间不足时回退到下方，但不能超出底部安全区
    if (y < margin) y = anchor.top + anchor.height + margin;
    if (y + estimatedHeight > maxBottom) y = maxBottom - estimatedHeight;
    if (y < margin) y = margin;
    ({ x, y } = clampQuoteButtonPosition(x, y, estimatedWidth, estimatedHeight));
    quoteButtonPosition.value = { x, y };
    showQuoteButton.value = true;
    await nextTick();
    const btn = options.quoteButtonRef.value;
    if (!btn) return;
    const btnWidth = btn.offsetWidth;
    const btnHeight = btn.offsetHeight;
    x = anchor.left + (anchor.width - btnWidth) / 2;
    y = anchor.top - btnHeight - margin;
    if (y < margin) y = anchor.top + anchor.height + margin;
    if (y + btnHeight > maxBottom) y = maxBottom - btnHeight;
    if (y < margin) y = margin;
    ({ x, y } = clampQuoteButtonPosition(x, y, btnWidth, btnHeight));
    quoteButtonPosition.value = { x, y };
  }

  function onDocumentClick(event: MouseEvent) {
    if (!showQuoteButton.value) return;
    if (eventComposedPathIncludes(event, ".quote-floating")) return;
    if (quoteButtonSource.value === "editor" && eventComposedPathIncludes(event, ".monaco-editor")) return;
    hideQuoteButtonNow();
  }

  function shouldIgnoreQuoteSelectEvent(event: MouseEvent): boolean {
    if (event.detail <= 1 && Date.now() - quoteHiddenAt < 150) return true;
    const target = event.target;
    return (
      target instanceof Element
      && Boolean(
        target.closest(
          ".msg-toolbar, .agent-recovery-actions, .agent-recovery-footer, .inline-diff-head, .msg-actions, .ai-option-buttons",
        ),
      )
    );
  }

  function tryShowQuoteButtonFromSelection(message: QuoteMessageLike): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const anchor = getSelectionAnchorRect(selection);
    if (!anchor || !selectionRectUsable(anchor)) return;

    pendingQuote.value = {
      messageId: message.id,
      content: selectedText,
      role: message.role,
    };
    quoteButtonSource.value = "chat";

    void showQuoteButtonAt(anchor);
  }

  function onMessageSelect(event: MouseEvent, message: QuoteMessageLike) {
    if (shouldIgnoreQuoteSelectEvent(event)) return;
    // 双击/三击时选区在 mouseup 时尚未就绪，推迟到 microtask（dblclick 也会再触发一次）
    if (event.detail >= 2) {
      queueMicrotask(() => tryShowQuoteButtonFromSelection(message));
      return;
    }
    tryShowQuoteButtonFromSelection(message);
  }

  function onMessageDoubleClick(event: MouseEvent, message: QuoteMessageLike) {
    if (shouldIgnoreQuoteSelectEvent(event)) return;
    tryShowQuoteButtonFromSelection(message);
  }

  function shouldIgnorePlanQuoteSelectEvent(event: MouseEvent): boolean {
    if (shouldIgnoreQuoteSelectEvent(event)) return true;
    const target = event.target;
    return (
      target instanceof Element
      && Boolean(target.closest(".plan-main-head, .plan-main-btn, .plan-main-head-actions"))
    );
  }

  function tryShowQuoteButtonFromPlanPanel(): void {
    if (!options.planPanelMessageId.value) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const anchor = getSelectionAnchorRect(selection);
    if (!anchor || !selectionRectUsable(anchor)) return;

    pendingQuote.value = {
      messageId: options.planPanelMessageId.value,
      content: selectedText,
      role: "assistant",
      source: "plan",
    };
    quoteButtonSource.value = "plan";

    void showQuoteButtonAt(anchor);
  }

  function onPlanPanelMouseUp(event: MouseEvent) {
    if (!options.planWorkspaceOpen.value) return;
    if (shouldIgnorePlanQuoteSelectEvent(event)) return;
    if (event.detail >= 2) {
      queueMicrotask(() => tryShowQuoteButtonFromPlanPanel());
      return;
    }
    tryShowQuoteButtonFromPlanPanel();
  }

  function onPlanPanelDoubleClick(event: MouseEvent) {
    if (!options.planWorkspaceOpen.value) return;
    if (shouldIgnorePlanQuoteSelectEvent(event)) return;
    tryShowQuoteButtonFromPlanPanel();
  }

  function onEditorSelect(text: string, anchor: MonacoSelectionAnchor | null) {
    if (!text.trim() || !anchor || !options.activeFilePath.value) {
      if (quoteButtonSource.value === "editor") hideQuoteButtonNow();
      return;
    }

    const relPath = options.activeFileRelativePath() || fileName(options.activeFilePath.value);
    pendingQuote.value = {
      messageId: `editor:${options.activeFilePath.value}`,
      content: text.trim(),
      role: "user",
      source: "editor",
      filePath: relPath,
    };
    quoteButtonSource.value = "editor";
    void showQuoteButtonAt(anchor);
  }

  function quoteSelectedText() {
    if (!pendingQuote.value) return;

    const next = pendingQuote.value;
    options.onQuoteReady(next.content, next.filePath);
    pendingQuote.value = null;
    showQuoteButton.value = false;
    quoteButtonSource.value = null;

    options.expandChat();

    nextTick(() => {
      options.focusComposer();
    });
  }

  function onSelectionChange() {
    if (!showQuoteButton.value) return;
    if (quoteButtonSource.value === "editor") return;
    if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
    selectionChangeTimer = setTimeout(() => {
      selectionChangeTimer = null;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        hideQuoteButtonNow();
      }
    }, 120);
  }

  registerEscapeDismiss(showQuoteButton, hideQuoteButtonNow, ESCAPE_DISMISS_PRIORITY.QUOTE_BUTTON);

  onMounted(() => {
    document.addEventListener("mousedown", onDocumentClick, true);
    document.addEventListener("selectionchange", onSelectionChange);
    nextTick(() => {
      const scrollHost = options.getChatScrollEl();
      if (scrollHost) {
        scrollQuoteHideHandler = () => {
          if (showQuoteButton.value) hideQuoteButtonNow();
        };
        scrollHost.addEventListener("scroll", scrollQuoteHideHandler, { passive: true });
      }
    });
  });

  onBeforeUnmount(() => {
    document.removeEventListener("mousedown", onDocumentClick, true);
    document.removeEventListener("selectionchange", onSelectionChange);
    if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
    const scrollHost = options.getChatScrollEl();
    if (scrollQuoteHideHandler && scrollHost) {
      scrollHost.removeEventListener("scroll", scrollQuoteHideHandler);
      scrollQuoteHideHandler = null;
    }
  });

  return {
    pendingQuote,
    quoteButtonPosition,
    showQuoteButton,
    quoteButtonSource,
    hideQuoteButtonNow,
    quoteSelectedText,
    onMessageSelect,
    onMessageDoubleClick,
    onPlanPanelMouseUp,
    onPlanPanelDoubleClick,
    onEditorSelect,
  };
}
