const DEFAULT_THRESHOLD = 24;
const SESSION_SCROLL_RETRY_MS = [0, 16, 50, 120, 300, 600] as const;

/** Snap when remaining distance is this small (px). */
export const SCROLL_FOLLOW_SNAP_PX = 0.6;
/** Treat as settled when |velocity| is below this (px/s). */
export const SCROLL_FOLLOW_SNAP_VEL = 12;
/**
 * Critically-damped-ish spring toward the bottom.
 * Lower stiffness = longer glide (more “smooth scroll” feel).
 */
export const SCROLL_FOLLOW_STIFFNESS = 96;
export const SCROLL_FOLLOW_DAMPING = 19.5;

export type ScrollFollowStep = {
  nextScrollTop: number;
  velocity: number;
  /** True when within the near-bottom pin threshold. */
  atBottom: boolean;
  /** True when position+velocity have settled on the bottom. */
  settled: boolean;
};

/**
 * One frame of spring stick-to-bottom follow (frame-rate independent).
 * Carries velocity so large layout jumps accelerate/decelerate like smooth scroll
 * instead of cutting a fixed fraction each frame.
 */
export function computeScrollFollowStep(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  velocity: number,
  dtSec: number,
  options?: {
    stiffness?: number;
    damping?: number;
    snapPx?: number;
    snapVel?: number;
  },
): ScrollFollowStep {
  const stiffness = options?.stiffness ?? SCROLL_FOLLOW_STIFFNESS;
  const damping = options?.damping ?? SCROLL_FOLLOW_DAMPING;
  const snapPx = options?.snapPx ?? SCROLL_FOLLOW_SNAP_PX;
  const snapVel = options?.snapVel ?? SCROLL_FOLLOW_SNAP_VEL;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const dt = Math.min(0.064, Math.max(0, dtSec));

  if (dt === 0) {
    const distance = maxScroll - scrollTop;
    return {
      nextScrollTop: scrollTop,
      velocity,
      atBottom: distance <= DEFAULT_THRESHOLD,
      settled: distance <= snapPx && Math.abs(velocity) <= snapVel,
    };
  }

  // Spring toward bottom: a = -k*(x - target) - c*v
  let x = scrollTop;
  let v = velocity;
  const accel = -stiffness * (x - maxScroll) - damping * v;
  v += accel * dt;
  x += v * dt;

  // Clamp — chat stick-to-bottom should not bounce past the end.
  if (x > maxScroll) {
    x = maxScroll;
    v = 0;
  } else if (x < 0) {
    x = 0;
    v = 0;
  }

  const distance = maxScroll - x;
  const settled = distance <= snapPx && Math.abs(v) <= snapVel;
  if (settled) {
    return { nextScrollTop: maxScroll, velocity: 0, atBottom: true, settled: true };
  }
  return {
    nextScrollTop: x,
    velocity: v,
    atBottom: distance <= DEFAULT_THRESHOLD,
    settled: false,
  };
}

/** 跳转到某条消息时，目标块顶落在视口这个比例处（留出下方上下文）。 */
export const MESSAGE_JUMP_ALIGN_RATIO = 0.28;
/** 跳转后目标块与视口上/下边缘至少留这么多留白（px）。 */
export const MESSAGE_JUMP_PAD_PX = 16;

export type ScrollToMessageInput = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  /** 目标块在滚动内容坐标系里的顶部（与 scrollTop 同一坐标系）。 */
  elementTop: number;
  elementHeight: number;
  alignRatio?: number;
  padPx?: number;
};

/**
 * 计算「把目标消息定位到视口靠上位置」所需的 scrollTop。
 *
 * 不用 `scrollIntoView({ block: "center" })` 的两个原因：
 * 1) 居中会把长回复对半切在视口中间，用户看不到问题后紧跟的答案开头；
 * 2) 它不保证目标块整体落在视口内 —— 高块会被夹在上下留白里，落到哪全看块高。
 *
 * 规则：目标块顶对齐到视口 `alignRatio` 处；高块优先露顶部；
 * 短块则保证底部也在视口内（留 `padPx`）。最后夹到可滚动范围内。
 */
export function scrollToMessageWithin(input: ScrollToMessageInput): number {
  const maxScroll = Math.max(0, input.scrollHeight - input.clientHeight);
  if (maxScroll <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, input.alignRatio ?? MESSAGE_JUMP_ALIGN_RATIO));
  const pad = Math.max(0, input.padPx ?? MESSAGE_JUMP_PAD_PX);
  let top = input.elementTop - input.clientHeight * ratio;
  // 块顶不滑出视口上方（长块优先露顶部）
  top = Math.min(top, input.elementTop - pad);
  // 块能整块塞进视口时，保证块底也在视口内（留 pad）
  if (input.elementHeight + pad * 2 <= input.clientHeight) {
    top = Math.max(top, input.elementTop + input.elementHeight + pad - input.clientHeight);
  }
  return Math.min(Math.max(top, 0), maxScroll);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isScrollNearBottom(element: HTMLElement, threshold = DEFAULT_THRESHOLD): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

export function scrollElementToBottom(
  element: HTMLElement,
  behavior: ScrollBehavior = "smooth",
): void {
  element.scrollTo({ top: element.scrollHeight, behavior });
}

/** Force scroll container to absolute bottom (auto behavior). */
export function scrollContainerToBottom(
  element: HTMLElement,
  behavior: ScrollBehavior = "auto",
): void {
  element.scrollTop = element.scrollHeight;
  if (behavior !== "auto") {
    element.scrollTo({ top: element.scrollHeight, behavior });
  }
}

/**
 * Retry scroll after session / layout changes — markdown, agent cards, and images
 * may expand the container after the first paint.
 */
export function scheduleScrollContainerToBottom(
  getElement: () => HTMLElement | null | undefined,
  options?: { behavior?: ScrollBehavior; delaysMs?: readonly number[] },
): void {
  const behavior = options?.behavior ?? "auto";
  const delaysMs = options?.delaysMs ?? SESSION_SCROLL_RETRY_MS;

  const run = () => {
    const el = getElement();
    if (el) scrollContainerToBottom(el, behavior);
  };

  for (const delay of delaysMs) {
    if (delay <= 0) {
      requestAnimationFrame(() => requestAnimationFrame(run));
    } else {
      window.setTimeout(run, delay);
    }
  }
}
