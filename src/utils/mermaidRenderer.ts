/**
 * Mermaid 图表懒加载渲染器。
 * 首次调用时动态 import mermaid，后续复用实例。
 * 渲染后注入缩放工具栏（悬停显示）。
 */
import type Mermaid from "mermaid";

const MERMAID_ROOT_SELECTOR = "div.mermaid-render:not([data-mermaid-rendered])";
const MERMAID_CODE_SELECTOR = "code.language-mermaid";

let mermaidModule: typeof Mermaid | null = null;
let initPromise: Promise<typeof Mermaid> | null = null;

async function ensureMermaid(): Promise<typeof Mermaid> {
  if (mermaidModule) return mermaidModule;
  if (!initPromise) {
    initPromise = import("mermaid").then(async (mod) => {
      const m = mod.default ?? mod;
      await m.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        themeVariables: {
          darkMode: true,
          background: "#1e1e2e",
          primaryColor: "#89b4fa",
          primaryTextColor: "#cdd6f4",
          primaryBorderColor: "#89b4fa",
          lineColor: "#6c7086",
          secondaryColor: "#313244",
          tertiaryColor: "#45475a",
          fontSize: "14px",
        },
        fontFamily: "inherit",
      });
      mermaidModule = m;
      return m;
    }).catch((err: unknown) => {
      console.error("Failed to load mermaid:", err);
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/** 工具栏 HTML 模板 */
const TOOLBAR_HTML = `
<div class="mermaid-toolbar">
  <button class="mermaid-zoom-out" title="缩小">−</button>
  <span class="mermaid-zoom-label">100%</span>
  <button class="mermaid-zoom-in" title="放大">+</button>
  <button class="mermaid-zoom-reset" title="重置">↺</button>
  <button class="mermaid-fullscreen-btn" title="全屏查看">⛶</button>
</div>
`;

/**
 * 渲染容器内所有 <div class="mermaid-render"> 元素为 SVG 图表。
 * 可重复调用（只处理尚未渲染的元素）。
 */
export async function renderMermaidInContainer(el: HTMLElement): Promise<void> {
  const nodes = el.querySelectorAll<HTMLElement>(MERMAID_ROOT_SELECTOR);
  if (!nodes.length) return;

  const mermaid = await ensureMermaid();

  for (const node of nodes) {
    const code = node.querySelector<HTMLElement>(MERMAID_CODE_SELECTOR)?.textContent?.trim();
    if (!code) continue;
    try {
      const id = `mermaid-${++renderCounter}`;
      const { svg } = await mermaid.render(id, code);
      // 注入 SVG + 工具栏
      node.innerHTML = `<div class="mermaid-chart-wrapper">${svg}${TOOLBAR_HTML}</div>`;
      node.setAttribute("data-mermaid-rendered", "true");
      node.setAttribute("data-mermaid-source", code);
      node.setAttribute("data-zoom", "100");
      // 添加 touch-action 防止浏览器默认缩放
      node.style.touchAction = "none";
      // 绑定缩放事件
      bindZoomEvents(node);
    } catch (err) {
      console.warn("[mermaid] render failed:", err);
      node.innerHTML = `<pre style="color:#f38ba8;font-size:12px;">Mermaid 渲染失败: ${err instanceof Error ? err.message : String(err)}</pre>`;
      node.setAttribute("data-mermaid-rendered", "error");
    }
  }
}

let renderCounter = 0;

// ─── 缩放逻辑 ───────────────────────────────────────────

const ZOOM_MIN = 25;
const ZOOM_MAX = 500;
const WHEEL_CAPTURE_OPTS = { passive: false, capture: true } as const;

function touchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoom)));
}

function supportsCssZoom(): boolean {
  return typeof CSS !== "undefined" && CSS.supports?.("zoom", "1") === true;
}

/** 内联图表：zoom 同步布局盒（WebView2）。 */
function applyInlineVisualZoom(wrapper: HTMLElement, zoom: number) {
  const scale = zoom / 100;
  if (supportsCssZoom()) {
    wrapper.style.transform = "";
    wrapper.style.transformOrigin = "";
    wrapper.style.zoom = String(scale);
    return;
  }
  wrapper.style.zoom = "";
  wrapper.style.transform = `scale(${scale})`;
  wrapper.style.transformOrigin = "top left";
}

/** 全屏 viewport：translate + scale 统一施加在 transform 层。 */
function getFullscreenPan(overlay: HTMLElement): { x: number; y: number } {
  return {
    x: parseFloat(overlay.getAttribute("data-pan-x") || "0"),
    y: parseFloat(overlay.getAttribute("data-pan-y") || "0"),
  };
}

function setFullscreenPan(overlay: HTMLElement, x: number, y: number) {
  overlay.setAttribute("data-pan-x", String(Math.round(x)));
  overlay.setAttribute("data-pan-y", String(Math.round(y)));
  applyFullscreenTransform(overlay);
}

function applyFullscreenTransform(overlay: HTMLElement) {
  const layer = overlay.querySelector(".mermaid-fs-transform-layer") as HTMLElement | null;
  if (!layer) return;
  const zoom = getFullscreenZoom(overlay);
  const { x, y } = getFullscreenPan(overlay);
  const scale = zoom / 100;
  layer.style.transformOrigin = "center center";
  layer.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  const label = overlay.querySelector(".mermaid-zoom-label");
  if (label) label.textContent = `${zoom}%`;
}

function resetFullscreenView(overlay: HTMLElement) {
  overlay.setAttribute("data-zoom", "100");
  overlay.setAttribute("data-pan-x", "0");
  overlay.setAttribute("data-pan-y", "0");
  applyFullscreenTransform(overlay);
}

function setFullscreenZoom(overlay: HTMLElement, zoom: number) {
  overlay.setAttribute("data-zoom", String(clampZoom(zoom)));
  applyFullscreenTransform(overlay);
}

function panFullscreenBy(overlay: HTMLElement, dx: number, dy: number) {
  const { x, y } = getFullscreenPan(overlay);
  setFullscreenPan(overlay, x + dx, y + dy);
}

/** 全屏内：ctrl+滚轮 / 捏合(pixel wheel) → 缩放；普通双指滚动(line wheel) → 平移。 */
function isFullscreenZoomWheel(e: WheelEvent): boolean {
  if (e.ctrlKey || e.metaKey) return true;
  // Windows 精度触控板捏合多为 pixel 模式；双指滚动多为 line 模式
  return e.deltaMode === WheelEvent.DOM_DELTA_PIXEL;
}

function isInlineZoomWheel(e: WheelEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

function wheelZoomDelta(e: WheelEvent): number {
  return Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
}

/** 触控板捏合用连续倍率；Ctrl+滚轮用大步进。 */
function zoomFromWheel(current: number, e: WheelEvent): number {
  const delta = Math.abs(wheelZoomDelta(e));
  if (delta > 50) {
    const step = delta > 100 ? 25 : 15;
    const d = wheelZoomDelta(e);
    return clampZoom(d < 0 ? current + step : current - step);
  }
  const clampedDelta = Math.max(-20, Math.min(20, wheelZoomDelta(e)));
  return clampZoom(current * 2 ** (-clampedDelta * 0.01));
}

function getZoom(node: HTMLElement): number {
  return parseInt(node.getAttribute("data-zoom") || "100", 10);
}

function setZoom(node: HTMLElement, zoom: number) {
  zoom = clampZoom(zoom);
  node.setAttribute("data-zoom", String(zoom));
  const wrapper = node.querySelector(".mermaid-chart-wrapper");
  if (wrapper) {
    applyInlineVisualZoom(wrapper as HTMLElement, zoom);
  }
  const label = node.querySelector(".mermaid-zoom-label");
  if (label) label.textContent = `${zoom}%`;
}

function findMermaidNodeAt(clientX: number, clientY: number): HTMLElement | null {
  const hit = document.elementFromPoint(clientX, clientY);
  return hit?.closest<HTMLElement>('div.mermaid-render[data-mermaid-rendered="true"]') ?? null;
}

function getFullscreenZoom(overlay: HTMLElement): number {
  return parseInt(overlay.getAttribute("data-zoom") || "100", 10);
}

/** 当前打开的全屏 overlay；捏合缩放优先路由到此（避免 hit-test / overflow 干扰）。 */
let activeFullscreenOverlay: HTMLElement | null = null;

interface FullscreenSession {
  overlay: HTMLElement;
  /** 全屏内独立渲染的 SVG；关闭时随 overlay 移除，不扰动内联图表。 */
  svg: SVGElement | null;
}

let fullscreenSession: FullscreenSession | null = null;

function insertMermaidSvgMarkup(container: HTMLElement, svgMarkup: string): SVGSVGElement | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const parsed = doc.documentElement;
  if (parsed instanceof SVGSVGElement) {
    container.appendChild(document.importNode(parsed, true));
    return container.querySelector("svg");
  }
  const fallback = document.createElement("div");
  fallback.innerHTML = svgMarkup;
  const svg = fallback.querySelector("svg");
  if (!svg) return null;
  container.appendChild(svg);
  return svg;
}

function parseSvgPixelLength(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith("%")) return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Mermaid SVG 常带 width="100%"，脱离原容器后会塌成 0×0；百分比也不能 parseFloat 成 100px。 */
function normalizeSvgForFullscreen(svg: SVGSVGElement): void {
  svg.removeAttribute("style");

  if (svg.getAttribute("width")?.includes("%")) svg.removeAttribute("width");
  if (svg.getAttribute("height")?.includes("%")) svg.removeAttribute("height");

  const viewBox = svg.viewBox?.baseVal;
  let vbW = viewBox?.width ?? 0;
  let vbH = viewBox?.height ?? 0;

  if (!vbW || !vbH) {
    const attrW = parseSvgPixelLength(svg.getAttribute("width"));
    const attrH = parseSvgPixelLength(svg.getAttribute("height"));
    if (attrW && attrH) {
      vbW = attrW;
      vbH = attrH;
    } else {
      try {
        const box = svg.getBBox();
        if (box.width > 0 && box.height > 0) {
          vbW = box.width;
          vbH = box.height;
          if (!svg.getAttribute("viewBox")) {
            svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
          }
        }
      } catch {
        return;
      }
    }
  }

  if (!vbW || !vbH) return;

  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const maxW = window.innerWidth * 0.9;
  const maxH = window.innerHeight * 0.82;
  const scale = Math.min(maxW / vbW, maxH / vbH);
  svg.setAttribute("width", String(Math.round(vbW * scale)));
  svg.setAttribute("height", String(Math.round(vbH * scale)));

  svg.style.display = "block";
  svg.style.maxWidth = "90vw";
  svg.style.maxHeight = "82vh";
}

function buildFullscreenOverlay(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "mermaid-fullscreen-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "99999",
    background: "rgba(0,0,0,0.85)",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "stretch",
    touchAction: "none",
    overflow: "hidden",
  });

  const toolbar = document.createElement("div");
  Object.assign(toolbar.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    zIndex: "100000",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    background: "rgba(30,30,46,0.92)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "8px",
    padding: "4px 8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
  });
  toolbar.innerHTML = `
    <button class="mermaid-zoom-out" title="缩小" style="background:none;border:none;color:#cdd6f4;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:4px;">−</button>
    <span class="mermaid-zoom-label" style="color:#cdd6f4;font-size:13px;min-width:40px;text-align:center;">100%</span>
    <button class="mermaid-zoom-in" title="放大" style="background:none;border:none;color:#cdd6f4;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:4px;">+</button>
    <button class="mermaid-zoom-reset" title="重置" style="background:none;border:none;color:#a6adc8;font-size:14px;cursor:pointer;padding:2px 6px;border-radius:4px;">↺</button>
    <span style="width:1px;height:18px;background:#585b70;margin:0 4px;"></span>
    <button class="mermaid-fs-close" title="关闭 (ESC)" style="background:none;border:none;color:#f38ba8;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:4px;">✕</button>
  `;
  overlay.appendChild(toolbar);

  const viewport = document.createElement("div");
  viewport.className = "mermaid-fs-viewport";
  Object.assign(viewport.style, {
    position: "relative",
    flex: "1 1 auto",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    touchAction: "none",
    cursor: "grab",
  });

  const transformLayer = document.createElement("div");
  transformLayer.className = "mermaid-fs-transform-layer";
  Object.assign(transformLayer.style, {
    display: "inline-block",
    willChange: "transform",
  });

  const chartWrapper = document.createElement("div");
  chartWrapper.className = "mermaid-fs-chart-wrapper";
  Object.assign(chartWrapper.style, {
    background: "#1e1e2e",
    borderRadius: "12px",
    padding: "24px",
    display: "inline-block",
    width: "auto",
    height: "auto",
    touchAction: "none",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
  });

  transformLayer.appendChild(chartWrapper);
  viewport.appendChild(transformLayer);
  overlay.appendChild(viewport);
  return overlay;
}

let wheelDelegated = false;

let wheelHandler: ((e: WheelEvent) => void) | null = null;

function handlePinchWheelZoom(e: WheelEvent): boolean {
  if (activeFullscreenOverlay?.contains(e.target as Node)) return false;

  if (!isInlineZoomWheel(e)) return false;
  e.preventDefault();
  e.stopImmediatePropagation();

  const target = e.target as HTMLElement;
  const node =
    target.closest<HTMLElement>('div.mermaid-render[data-mermaid-rendered="true"]') ??
    findMermaidNodeAt(e.clientX, e.clientY);
  if (!node) return false;

  setZoom(node, zoomFromWheel(getZoom(node), e));
  return true;
}

/** 捕获阶段委托：在 WebView2/聊天滚动容器之前拦截 ctrl+wheel 捏合。 */
function setupWheelDelegation() {
  if (wheelDelegated) return;
  wheelDelegated = true;

  wheelHandler = (e) => {
    handlePinchWheelZoom(e);
  };
  document.addEventListener("wheel", wheelHandler, WHEEL_CAPTURE_OPTS);
}

interface GestureEventLike extends Event {
  scale?: number;
}

function bindZoomEvents(node: HTMLElement) {
  setupWheelDelegation();

  // Safari gesture API（macOS 触控板捏合）
  let gestureBase = 100;
  node.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    e.stopPropagation();
    gestureBase = getZoom(node);
  }, { passive: false });
  node.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ge = e as GestureEventLike;
    setZoom(node, Math.round(gestureBase * (ge.scale ?? 1)));
  }, { passive: false });
  node.addEventListener("gestureend", (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });

  // Touch 双指捏合兜底（移动端 / gesture API 不支持的场景）
  let touchStartDist = 0;
  let touchBase = 100;
  node.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      e.stopPropagation();
      touchStartDist = touchDistance(e.touches);
      touchBase = getZoom(node);
    }
  }, { passive: false });
  node.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      e.stopPropagation();
      const dist = touchDistance(e.touches);
      const scale = dist / touchStartDist;
      setZoom(node, Math.round(touchBase * scale));
    }
  }, { passive: false });
  node.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) {
      e.preventDefault();
    }
  }, { passive: false });
}

// ─── 事件委托（在 body 上监听一次） ─────────────────────

let delegated = false;

let delegationClickToolbar: ((e: MouseEvent) => void) | null = null;
let delegationClickFullscreen: ((e: MouseEvent) => void) | null = null;
let delegationKeydown: ((e: KeyboardEvent) => void) | null = null;

function setupDelegation() {
  if (delegated) return;
  delegated = true;

  delegationClickToolbar = (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>(
      ".mermaid-zoom-in, .mermaid-zoom-out, .mermaid-zoom-reset, .mermaid-fullscreen-btn"
    );
    if (!btn) return;

    const node = btn.closest<HTMLElement>("div.mermaid-render");
    if (!node) return;

    if (btn.classList.contains("mermaid-zoom-in")) {
      setZoom(node, getZoom(node) + 25);
    } else if (btn.classList.contains("mermaid-zoom-out")) {
      setZoom(node, getZoom(node) - 25);
    } else if (btn.classList.contains("mermaid-zoom-reset")) {
      setZoom(node, 100);
    } else if (btn.classList.contains("mermaid-fullscreen-btn")) {
      e.stopPropagation();
      openFullscreen(node);
    }
  };
  document.addEventListener("click", delegationClickToolbar);

  delegationClickFullscreen = (e) => {
    const overlay = (e.target as HTMLElement).closest<HTMLElement>(".mermaid-fullscreen-overlay");
    if (!overlay) return;
    const target = e.target as HTMLElement;
    if (
      target.classList.contains("mermaid-fs-close") ||
      target === overlay ||
      target.classList.contains("mermaid-fs-viewport")
    ) {
      closeFullscreen();
    }
  };
  document.addEventListener("click", delegationClickFullscreen);

  delegationKeydown = (e) => {
    if (e.key === "Escape") closeFullscreen();
  };
  document.addEventListener("keydown", delegationKeydown);
}

function bindFullscreenInteractions(overlay: HTMLElement) {
  const viewport = overlay.querySelector(".mermaid-fs-viewport") as HTMLElement | null;
  if (!viewport) return;

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isFullscreenZoomWheel(e)) {
      setFullscreenZoom(overlay, zoomFromWheel(getFullscreenZoom(overlay), e));
      return;
    }
    panFullscreenBy(overlay, -e.deltaX, -e.deltaY);
  };
  viewport.addEventListener("wheel", onWheel, WHEEL_CAPTURE_OPTS);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".mermaid-fs-toolbar")) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    viewport.style.cursor = "grabbing";
    viewport.setPointerCapture(e.pointerId);
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    panFullscreenBy(overlay, e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    viewport.style.cursor = "grab";
    if (viewport.hasPointerCapture(e.pointerId)) {
      viewport.releasePointerCapture(e.pointerId);
    }
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  // Safari gesture API（macOS 触控板捏合）
  let fsGestureBase = 100;
  viewport.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    fsGestureBase = getFullscreenZoom(overlay);
  }, { passive: false });
  viewport.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    const ge = e as GestureEventLike;
    setFullscreenZoom(overlay, Math.round(fsGestureBase * (ge.scale ?? 1)));
  }, { passive: false });
  viewport.addEventListener("gestureend", (e) => {
    e.preventDefault();
  }, { passive: false });

  // Touch：单指拖动平移，双指捏合缩放
  let touchMode: "none" | "pan" | "pinch" = "none";
  let touchPanStart = { x: 0, y: 0 };
  let touchPanBase = { x: 0, y: 0 };
  let touchPinchStart = 0;
  let touchPinchBase = 100;

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      touchMode = "pan";
      touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchPanBase = getFullscreenPan(overlay);
    } else if (e.touches.length === 2) {
      e.preventDefault();
      touchMode = "pinch";
      touchPinchStart = touchDistance(e.touches);
      touchPinchBase = getFullscreenZoom(overlay);
    }
  }, { passive: false });

  viewport.addEventListener("touchmove", (e) => {
    if (touchMode === "pan" && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - touchPanStart.x;
      const dy = e.touches[0].clientY - touchPanStart.y;
      setFullscreenPan(overlay, touchPanBase.x + dx, touchPanBase.y + dy);
    } else if (touchMode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const scale = touchDistance(e.touches) / touchPinchStart;
      setFullscreenZoom(overlay, Math.round(touchPinchBase * scale));
    }
  }, { passive: false });

  viewport.addEventListener("touchend", () => {
    touchMode = "none";
  }, { passive: false });
}

function openFullscreen(node: HTMLElement) {
  void openFullscreenAsync(node);
}

async function openFullscreenAsync(node: HTMLElement) {
  if (fullscreenSession) return;

  const source = node.getAttribute("data-mermaid-source");
  const inlineSvg = node.querySelector("svg");
  if (!source && !inlineSvg) return;

  setupDelegation();
  setupWheelDelegation();

  const overlay = buildFullscreenOverlay();
  const chartWrapper = overlay.querySelector(".mermaid-fs-chart-wrapper") as HTMLElement;
  chartWrapper.textContent = "加载中…";
  Object.assign(chartWrapper.style, {
    color: "#a6adc8",
    fontSize: "14px",
    textAlign: "center",
    minWidth: "120px",
  });

  overlay.setAttribute("data-zoom", "100");
  overlay.setAttribute("data-pan-x", "0");
  overlay.setAttribute("data-pan-y", "0");
  document.body.appendChild(overlay);
  activeFullscreenOverlay = overlay;

  let svg: SVGSVGElement | null = null;

  if (source) {
    try {
      const mermaid = await ensureMermaid();
      const id = `mermaid-fs-${++renderCounter}`;
      const { svg: svgMarkup } = await mermaid.render(id, source);
      chartWrapper.textContent = "";
      Object.assign(chartWrapper.style, { color: "", fontSize: "", textAlign: "", minWidth: "" });
      svg = insertMermaidSvgMarkup(chartWrapper, svgMarkup);
    } catch (err) {
      console.warn("[mermaid] fullscreen render failed:", err);
    }
  }

  if (!svg && inlineSvg) {
    chartWrapper.textContent = "";
    Object.assign(chartWrapper.style, { color: "", fontSize: "", textAlign: "", minWidth: "" });
    const clone = inlineSvg.cloneNode(true) as SVGSVGElement;
    chartWrapper.appendChild(clone);
    svg = clone;
  }

  if (!svg) {
    closeFullscreen();
    return;
  }

  normalizeSvgForFullscreen(svg);

  fullscreenSession = { overlay, svg };
  bindFullscreenInteractions(overlay);
  applyFullscreenTransform(overlay);

  overlay.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(
      ".mermaid-zoom-in, .mermaid-zoom-out, .mermaid-zoom-reset",
    );
    if (!btn) return;
    e.stopPropagation();
    const cur = getFullscreenZoom(overlay);
    if (btn.classList.contains("mermaid-zoom-reset")) {
      resetFullscreenView(overlay);
      return;
    }
    if (btn.classList.contains("mermaid-zoom-in")) {
      setFullscreenZoom(overlay, cur + 25);
    } else if (btn.classList.contains("mermaid-zoom-out")) {
      setFullscreenZoom(overlay, cur - 25);
    }
  });
}

function closeFullscreen() {
  if (!fullscreenSession) return;
  const { overlay } = fullscreenSession;
  overlay.remove();
  fullscreenSession = null;
  activeFullscreenOverlay = null;
}

/** Remove leaked mermaid fullscreen overlay (e.g. after HMR or aborted open). */
export function dismissMermaidFullscreen(): void {
  closeFullscreen();
  document.querySelectorAll(".mermaid-fullscreen-overlay").forEach((el) => el.remove());
}

/** Remove all document-level event listeners and reset module state for cleanup/re-init. */
export function disposeMermaidRenderer(): void {
  dismissMermaidFullscreen();
  if (wheelHandler) {
    document.removeEventListener("wheel", wheelHandler, WHEEL_CAPTURE_OPTS);
    wheelHandler = null;
  }
  if (delegationClickToolbar) {
    document.removeEventListener("click", delegationClickToolbar);
    delegationClickToolbar = null;
  }
  if (delegationClickFullscreen) {
    document.removeEventListener("click", delegationClickFullscreen);
    delegationClickFullscreen = null;
  }
  if (delegationKeydown) {
    document.removeEventListener("keydown", delegationKeydown);
    delegationKeydown = null;
  }
  wheelDelegated = false;
  delegated = false;
}

// 页面加载时设置一次事件委托
setupDelegation();
setupWheelDelegation();
