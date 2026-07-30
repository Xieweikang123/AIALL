import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import type { ProjectReportSection } from "../services/projectReportDisplay";

const QUOTED_EXCERPT_PREVIEW_MAX = 160;
const QUOTE_BUTTON_EST_WIDTH = 108;
const QUOTE_BUTTON_EST_HEIGHT = 32;
const SCROLL_BOTTOM_THRESHOLD = 64;

export interface UseKnowledgePanelUiOptions {
  layout: ComputedRef<"sidebar" | "main" | "full">;
  editing: ComputedRef<boolean>;
  exploreRunning: ComputedRef<boolean>;
  tocSections: ComputedRef<ProjectReportSection[]>;
  bodyRef: Ref<HTMLElement | null>;
  bodyScrollRef: Ref<HTMLElement | null>;
  tocNavRef: Ref<HTMLElement | null>;
  followUpInputRef: Ref<HTMLInputElement | null>;
  stickScrollToBottom: Ref<boolean>;
  showActionHint: (text: string) => void;
}

export function useKnowledgePanelUi(options: UseKnowledgePanelUiOptions) {
  const {
    layout,
    editing,
    exploreRunning,
    tocSections,
    bodyRef,
    bodyScrollRef,
    tocNavRef,
    followUpInputRef,
    stickScrollToBottom,
    showActionHint,
  } = options;

  const searchQuery = ref("");
  const activeSectionId = ref("");
  const quotedExcerpt = ref("");
  const pendingSelectionText = ref("");
  const bodySelectionText = ref("");
  const showKnowledgeQuoteButton = ref(false);
  const knowledgeQuoteButtonPos = ref({ x: 0, y: 0 });

  let selectionQuoteTimer: ReturnType<typeof setTimeout> | null = null;
  let quoteHiddenAt = 0;
  let suppressScrollActiveSection = false;

  const quoteSelectionEnabled = computed(() => layout.value === "main");

  const filteredTocSections = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return tocSections.value;
    return tocSections.value.filter((s) => s.title.toLowerCase().includes(q));
  });

  const quotedExcerptPreview = computed(() => {
    const text = quotedExcerpt.value.trim();
    if (text.length <= QUOTED_EXCERPT_PREVIEW_MAX) return text;
    return `${text.slice(0, QUOTED_EXCERPT_PREVIEW_MAX)}…`;
  });

  const followUpPlaceholder = computed(() => {
    if (exploreRunning.value) return "完成后可继续追问…";
    if (quotedExcerpt.value.trim()) return "针对引用段落提问（可直接发送核实）…";
    return "针对知识库追问，或选中正文后引用…";
  });

  watch(
    () => filteredTocSections.value,
    (sections) => {
      if (!searchQuery.value.trim()) return;
      if (!sections.length) return;
      const first = sections[0];
      void nextTick(() => scrollToSection(first.id));
    },
  );

  function scrollToSection(sectionId: string) {
    const scrollRoot = bodyScrollRef.value;
    const root = bodyRef.value;
    if (!scrollRoot || !root) return;
    const target = root.querySelector(`#${sectionId}`);
    if (!(target instanceof HTMLElement)) return;
    activeSectionId.value = sectionId;
    suppressScrollActiveSection = true;
    const scrollTop =
      target.getBoundingClientRect().top
      - scrollRoot.getBoundingClientRect().top
      + scrollRoot.scrollTop;
    scrollRoot.scrollTo({ top: Math.max(0, scrollTop - 8), behavior: "auto" });
    requestAnimationFrame(() => { suppressScrollActiveSection = false; });
  }

  function scrollActiveTocIntoView(sectionId: string) {
    const nav = tocNavRef.value;
    if (!nav) return;
    const btn = nav.querySelector(`[data-section-id="${sectionId}"]`);
    if (btn instanceof HTMLElement) {
      btn.scrollIntoView({ block: "nearest" });
    }
  }

  function updateActiveSectionFromScroll() {
    if (suppressScrollActiveSection) return;
    const scrollRoot = bodyScrollRef.value;
    const root = bodyRef.value;
    if (!scrollRoot || !root || editing.value || !tocSections.value.length) return;

    const anchorTop = scrollRoot.getBoundingClientRect().top + 12;
    let nextId = tocSections.value[0].id;

    for (const section of tocSections.value) {
      const el = root.querySelector(`#${section.id}`);
      if (!(el instanceof HTMLElement)) continue;
      if (el.getBoundingClientRect().top <= anchorTop) {
        nextId = section.id;
      } else {
        break;
      }
    }

    if (nextId !== activeSectionId.value) {
      activeSectionId.value = nextId;
      scrollActiveTocIntoView(nextId);
    }
  }

  function selectionRectUsable(rect: DOMRect): boolean {
    return rect.width > 0 || rect.height > 0;
  }

  function selectionWithinBody(selection: Selection, root: HTMLElement): boolean {
    if (!selection.rangeCount) return false;
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
    return Boolean(el && root.contains(el));
  }

  function getKnowledgeSelectionAnchorRect(selection: Selection): DOMRect | null {
    const range = selection.getRangeAt(0);
    const lineRects = Array.from(range.getClientRects()).filter(selectionRectUsable);
    if (lineRects.length > 0) return lineRects[0]!;

    const bounds = range.getBoundingClientRect();
    if (selectionRectUsable(bounds)) return bounds;

    const startNode = range.startContainer;
    const anchorEl = startNode.nodeType === Node.ELEMENT_NODE
      ? (startNode as Element)
      : startNode.parentElement;
    if (anchorEl) {
      const anchorRect = anchorEl.getBoundingClientRect();
      if (anchorRect.width || anchorRect.height) return anchorRect;
    }
    return null;
  }

  function clampKnowledgeQuoteButtonPos(x: number, y: number, width: number, height: number) {
    const margin = 8;
    const maxX = window.innerWidth - width - margin;
    const maxY = window.innerHeight - height - margin;
    return {
      x: Math.min(Math.max(margin, x), Math.max(margin, maxX)),
      y: Math.min(Math.max(margin, y), Math.max(margin, maxY)),
    };
  }

  function positionKnowledgeQuoteButton(anchor: DOMRect) {
    const margin = 8;
    const bottomSafe = 120;
    let x = anchor.left + (anchor.width - QUOTE_BUTTON_EST_WIDTH) / 2;
    let y = anchor.top - QUOTE_BUTTON_EST_HEIGHT - margin;
    if (y < margin) y = anchor.bottom + margin;
    const maxBottom = window.innerHeight - bottomSafe;
    if (y + QUOTE_BUTTON_EST_HEIGHT > maxBottom) y = maxBottom - QUOTE_BUTTON_EST_HEIGHT;
    knowledgeQuoteButtonPos.value = clampKnowledgeQuoteButtonPos(
      x,
      y,
      QUOTE_BUTTON_EST_WIDTH,
      QUOTE_BUTTON_EST_HEIGHT,
    );
  }

  function hideKnowledgeQuoteButton() {
    showKnowledgeQuoteButton.value = false;
    pendingSelectionText.value = "";
    quoteHiddenAt = Date.now();
  }

  function refreshBodySelection() {
    if (!quoteSelectionEnabled.value) {
      bodySelectionText.value = "";
      return;
    }
    const root = bodyRef.value;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || !selectionWithinBody(selection, root)) {
      bodySelectionText.value = "";
      return;
    }
    bodySelectionText.value = selection.toString().trim();
  }

  function tryShowKnowledgeQuoteButton() {
    if (!quoteSelectionEnabled.value) return;
    refreshBodySelection();
    const root = bodyRef.value;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || editing.value || exploreRunning.value) {
      hideKnowledgeQuoteButton();
      return;
    }
    if (!selectionWithinBody(selection, root)) {
      hideKnowledgeQuoteButton();
      return;
    }
    const text = bodySelectionText.value;
    if (text.length < 2) {
      hideKnowledgeQuoteButton();
      return;
    }
    const anchor = getKnowledgeSelectionAnchorRect(selection);
    if (!anchor) {
      hideKnowledgeQuoteButton();
      return;
    }
    pendingSelectionText.value = text;
    positionKnowledgeQuoteButton(anchor);
    showKnowledgeQuoteButton.value = true;
  }

  function scheduleSelectionQuoteCheck() {
    if (!quoteSelectionEnabled.value) return;
    if (selectionQuoteTimer) clearTimeout(selectionQuoteTimer);
    selectionQuoteTimer = setTimeout(() => {
      selectionQuoteTimer = null;
      tryShowKnowledgeQuoteButton();
    }, 20);
  }

  function onDocumentMouseUpForQuote() {
    scheduleSelectionQuoteCheck();
  }

  function onSelectionChangeForQuote() {
    scheduleSelectionQuoteCheck();
  }

  function onDocumentMouseDownForQuote(event: MouseEvent) {
    if (!showKnowledgeQuoteButton.value) return;
    if (Date.now() - quoteHiddenAt < 120) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".knowledge-quote-floating")) return;
    if (bodyRef.value?.contains(target)) return;
    hideKnowledgeQuoteButton();
  }

  function quoteCurrentSelection() {
    const text = bodySelectionText.value.trim() || pendingSelectionText.value.trim();
    if (!text) return;
    quotedExcerpt.value = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
    hideKnowledgeQuoteButton();
    bodySelectionText.value = "";
    window.getSelection()?.removeAllRanges();
    void nextTick(() => followUpInputRef.value?.focus());
    showActionHint("已引用选中段落");
  }

  function quoteSelectedExcerpt() {
    quoteCurrentSelection();
  }

  function clearQuotedExcerpt() {
    quotedExcerpt.value = "";
  }

  function onBodyScroll() {
    updateActiveSectionFromScroll();
    hideKnowledgeQuoteButton();
    const el = bodyScrollRef.value;
    if (!el || !exploreRunning.value) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickScrollToBottom.value = distance <= SCROLL_BOTTOM_THRESHOLD;
  }

  onMounted(() => {
    void nextTick(() => updateActiveSectionFromScroll());
    if (!quoteSelectionEnabled.value) return;
    document.addEventListener("mouseup", onDocumentMouseUpForQuote);
    document.addEventListener("selectionchange", onSelectionChangeForQuote);
    document.addEventListener("mousedown", onDocumentMouseDownForQuote);
  });

  onBeforeUnmount(() => {
    if (selectionQuoteTimer) clearTimeout(selectionQuoteTimer);
    if (!quoteSelectionEnabled.value) return;
    document.removeEventListener("mouseup", onDocumentMouseUpForQuote);
    document.removeEventListener("selectionchange", onSelectionChangeForQuote);
    document.removeEventListener("mousedown", onDocumentMouseDownForQuote);
  });

  return {
    searchQuery,
    filteredTocSections,
    activeSectionId,
    scrollToSection,
    updateActiveSectionFromScroll,
    onBodyScroll,
    showKnowledgeQuoteButton,
    knowledgeQuoteButtonPos,
    bodySelectionText,
    quotedExcerpt,
    quotedExcerptPreview,
    followUpPlaceholder,
    quoteCurrentSelection,
    quoteSelectedExcerpt,
    clearQuotedExcerpt,
  };
}
