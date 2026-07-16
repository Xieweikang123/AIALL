import { onBeforeUnmount, onMounted } from "vue";

export interface VibeGlobalShortcutHandlers {
  openQuickSearch: () => void;
  saveFile: () => void | Promise<void>;
  switchToAdjacentSession: (delta: number) => void;
  startNewSession: () => void;
  navigateBack?: () => void;
  navigateForward?: () => void;
  toggleFilePanel?: () => void;
}

export function useVibeGlobalShortcuts(handlers: VibeGlobalShortcutHandlers) {
  function onGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      handlers.openQuickSearch();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void handlers.saveFile();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      handlers.switchToAdjacentSession(-1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      handlers.switchToAdjacentSession(1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      handlers.startNewSession();
    }
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      handlers.navigateBack?.();
      return;
    }
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      handlers.navigateForward?.();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
      e.preventDefault();
      handlers.toggleFilePanel?.();
      return;
    }
  }

  onMounted(() => {
    document.addEventListener("keydown", onGlobalKeydown);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("keydown", onGlobalKeydown);
  });

  return { onGlobalKeydown };
}
