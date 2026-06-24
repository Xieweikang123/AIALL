import { debugSessionLog } from "./debugSessionLog";
import { scanDomBlockingOverlays } from "./dismissBlockingOverlays";

/** Detect clicks blocked by invisible/fullscreen overlays or main-thread stalls. */
export function installUiFreezeProbe(getState: () => Record<string, unknown>): void {
  // #region agent log
  if (typeof PerformanceObserver !== "undefined") {
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 50) continue;
          debugSessionLog(
            "uiFreezeProbe:longTask",
            "main thread blocked",
            {
              durationMs: Math.round(entry.duration),
              startTime: Math.round(entry.startTime),
              ...getState(),
            },
            "UI2",
          );
        }
      });
      longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask unsupported
    }
  }
  // #endregion

  document.addEventListener(
    "pointerdown",
    (event) => {
      const state = getState();
      const top = document.elementFromPoint(event.clientX, event.clientY);
      if (!top) return;

      const domOverlays = scanDomBlockingOverlays();
      const blocker = top.closest(
        ".confirm-overlay, .input-overlay, .ctx-overlay, .quick-search-overlay, .mermaid-fullscreen-overlay, .image-viewer-overlay, .project-memory-overlay",
      );
      const toolbarTarget = (event.target as Element)?.closest?.(".app-toolbar");
      const toolbarTop = top.closest(".app-toolbar");

      if (blocker || top === document.body || top === document.documentElement) {
        // #region agent log
        debugSessionLog(
          "uiFreezeProbe:pointerdown",
          "click hit overlay or bare root",
          {
            topTag: top.tagName,
            topClass: typeof top.className === "string" ? top.className.slice(0, 120) : "",
            blockerClass: blocker?.className?.slice(0, 80) ?? "",
            domOverlays,
            ...state,
          },
          "UI1",
        );
        // #endregion
        return;
      }

      if (state.chatSending && (toolbarTarget || toolbarTop)) {
        // #region agent log
        debugSessionLog(
          "uiFreezeProbe:toolbarClick",
          "toolbar click during agent run",
          {
            targetTag: (event.target as Element)?.tagName ?? "",
            topTag: top.tagName,
            topClass: typeof top.className === "string" ? top.className.slice(0, 80) : "",
            domOverlays,
            ...state,
          },
          toolbarTop ? "UI2" : "UI1",
        );
        // #endregion
      }
    },
    true,
  );
}
