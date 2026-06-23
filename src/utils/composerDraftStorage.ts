/** 无活跃会话时输入框草稿的 localStorage key 后缀 */
export const COMPOSER_PENDING_DRAFT_KEY = "__composer-pending__";

export function composerDraftStorageKey(draftKey: string): string {
  return `vibe-coding-input-draft-${draftKey || "__global"}`;
}

export function isPlaceholderComposerHtml(html: string): boolean {
  const trimmed = html.trim();
  return !trimmed || trimmed === "<br>" || trimmed === "<br/>" || trimmed === "<br />";
}

export function readComposerDraftHtml(draftKey: string): string | null {
  try {
    const raw = localStorage.getItem(composerDraftStorageKey(draftKey));
    if (!raw || isPlaceholderComposerHtml(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function hasComposerDraft(draftKey: string): boolean {
  return readComposerDraftHtml(draftKey) !== null;
}

/** Plain text preview for sidebar title (strips HTML, collapses whitespace). */
export function composerDraftPreviewText(draftKey: string, maxLen = 48): string | null {
  const html = readComposerDraftHtml(draftKey);
  if (!html) return null;
  const text = html
    .replace(/<img\b[^>]*>/gi, "[图片]")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

export function removeComposerDraft(draftKey: string): void {
  try {
    localStorage.removeItem(composerDraftStorageKey(draftKey));
  } catch {
    // ignore storage errors
  }
}
