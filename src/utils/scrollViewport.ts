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
