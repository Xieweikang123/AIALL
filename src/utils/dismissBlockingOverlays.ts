import { dismissMermaidFullscreen } from "./mermaidRenderer";

const DOM_OVERLAY_SELECTORS = [
  ".mermaid-fullscreen-overlay",
  ".confirm-overlay",
  ".input-overlay",
  ".quick-search-overlay",
  ".ctx-overlay",
  ".image-viewer-overlay",
  ".project-memory-overlay",
] as const;

export type OverlayDismissDeps = {
  dismissConfirm: () => void;
  dismissInput: () => void;
  hideContextMenu: () => void;
  hideGitFileContextMenu: () => void;
  closeProjectMemory: () => void;
  closeQuickSearch: () => void;
};

let registeredDeps: OverlayDismissDeps | null = null;

export function registerOverlayDismissDeps(deps: OverlayDismissDeps): void {
  registeredDeps = deps;
}

export function scanDomBlockingOverlays(): string[] {
  return DOM_OVERLAY_SELECTORS.filter((sel) => document.querySelector(sel));
}

/** Clear module-level overlays + stray DOM nodes that block pointer events. */
export function dismissBlockingOverlays(_reason: string): string[] {
  registeredDeps?.dismissConfirm();
  registeredDeps?.dismissInput();
  registeredDeps?.hideContextMenu();
  registeredDeps?.hideGitFileContextMenu();
  registeredDeps?.closeProjectMemory();
  registeredDeps?.closeQuickSearch();
  dismissMermaidFullscreen();
  return scanDomBlockingOverlays();
}
