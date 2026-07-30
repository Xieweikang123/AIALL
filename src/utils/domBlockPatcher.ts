/**
 * DOM Block Patcher - Minimal DOM updates for streaming Markdown.
 */

export function patchDomWithHtml(container: HTMLElement, newHtml: string): void {
  if (!container) return;

  const temp = document.createElement("div");
  temp.innerHTML = newHtml || "<!--__empty__-->";
  const newElements = Array.from(temp.children);
  const oldElements = Array.from(container.children);

  if (newElements.length === 0) {
    container.innerHTML = "";
    return;
  }

  if (
    newElements.length === oldElements.length &&
    newElements.length > 0 &&
    newElements.every((ne, i) => ne.tagName === oldElements[i].tagName)
  ) {
    for (let i = 0; i < newElements.length; i++) {
      const newEl = newElements[i];
      const oldEl = oldElements[i];
      if (i === newElements.length - 1) {
        if (oldEl.innerHTML !== newEl.innerHTML) {
          oldEl.innerHTML = newEl.innerHTML;
        }
      } else {
        if (oldEl.innerHTML !== newEl.innerHTML) {
          oldEl.innerHTML = newEl.innerHTML;
        }
        syncAttributes(oldEl, newEl);
      }
    }
  } else {
    container.innerHTML = newHtml || "";
  }
}

function syncAttributes(target: Element, source: Element): void {
  const sourceAttrs = source.attributes;
  const toRemove: string[] = [];
  for (let i = 0; i < target.attributes.length; i++) {
    const attr = target.attributes[i];
    if (!source.hasAttribute(attr.name)) toRemove.push(attr.name);
  }
  for (const name of toRemove) target.removeAttribute(name);
  for (let i = 0; i < sourceAttrs.length; i++) {
    const attr = sourceAttrs[i];
    if (target.getAttribute(attr.name) !== attr.value) {
      target.setAttribute(attr.name, attr.value);
    }
  }
}