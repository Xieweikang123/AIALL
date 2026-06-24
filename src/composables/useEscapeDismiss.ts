import { onBeforeUnmount, watch, type Ref } from "vue";

/** Higher priority closes first when multiple overlays are open. */
export const ESCAPE_DISMISS_PRIORITY = {
  MODAL: 100,
  PROJECT_MEMORY: 90,
  CONTEXT_MENU: 80,
  SESSION_PICKER: 70,
  MENTION: 60,
  TOKEN_DETAIL: 50,
  PROJECT_HISTORY: 40,
  QUOTE_BUTTON: 30,
  QUOTED_PREVIEW: 20,
  AGENT_RUN: 15,
} as const;

type EscapeEntry = {
  id: symbol;
  close: () => void;
  priority: number;
};

const stack: EscapeEntry[] = [];
let listenerAttached = false;

function sortStack() {
  stack.sort((a, b) => b.priority - a.priority);
}

function onDocumentEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || !stack.length) return;
  e.preventDefault();
  e.stopPropagation();
  stack[0].close();
}

function attachListener() {
  if (!listenerAttached) {
    document.addEventListener("keydown", onDocumentEscape, true);
    listenerAttached = true;
  }
}

function detachListenerIfEmpty() {
  if (listenerAttached && stack.length === 0) {
    document.removeEventListener("keydown", onDocumentEscape, true);
    listenerAttached = false;
  }
}

function removeEntry(id: symbol) {
  const idx = stack.findIndex((entry) => entry.id === id);
  if (idx >= 0) stack.splice(idx, 1);
  detachListenerIfEmpty();
}

/**
 * Register an overlay/popup to close on Esc (capture phase, topmost priority wins).
 * Call from component setup; cleans up on unmount.
 */
export function registerEscapeDismiss(
  source: Ref<boolean> | (() => boolean),
  close: () => void,
  priority: number,
): void {
  const id = Symbol("escape-dismiss");
  const stop = watch(
    source,
    (open) => {
      removeEntry(id);
      if (open) {
        stack.push({ id, close, priority });
        sortStack();
        attachListener();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stop();
    removeEntry(id);
  });
}
