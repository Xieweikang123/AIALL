const DEFAULT_THRESHOLD = 24;

export function isScrollNearBottom(element: HTMLElement, threshold = DEFAULT_THRESHOLD): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

export function scrollElementToBottom(
  element: HTMLElement,
  behavior: ScrollBehavior = "smooth",
): void {
  element.scrollTo({ top: element.scrollHeight, behavior });
}
