/** 无活跃会话时输入框草稿的 localStorage key 后缀 */
export const COMPOSER_PENDING_DRAFT_KEY = "__composer-pending__";

import { lsGet, lsRemove } from "./localStorageSafe";
import { deleteDraftImagesForDraft } from "./draftImageStore";

export function composerDraftStorageKey(draftKey: string): string {
  return `vibe-coding-input-draft-${draftKey || "__global"}`;
}

export function isPlaceholderComposerHtml(html: string): boolean {
  const trimmed = html.trim();
  return !trimmed || trimmed === "<br>" || trimmed === "<br/>" || trimmed === "<br />";
}

export function readComposerDraftHtml(draftKey: string): string | null {
  const raw = lsGet(composerDraftStorageKey(draftKey));
  if (!raw || isPlaceholderComposerHtml(raw)) return null;
  return raw;
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
  lsRemove(composerDraftStorageKey(draftKey));
  // 草稿被删除时同步清掉其图片（IndexedDB），避免残留孤儿数据
  void deleteDraftImagesForDraft(draftKey || "__global");
}
