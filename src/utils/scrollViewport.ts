const DEFAULT_THRESHOLD = 24;
const SESSION_SCROLL_RETRY_MS = [0, 16, 50, 120, 300, 600] as const;

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
