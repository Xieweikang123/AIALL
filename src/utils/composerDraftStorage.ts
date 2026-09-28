/**
 * 输入框草稿的存储层。
 *
 * 历史：整块草稿 HTML 直接写 localStorage（~5MB 同源配额）。图片本体挪去
 * IndexedDB 后，HTML 里仍内联着拖入文件的全文，正文也会越来越长，照样能撑爆。
 *
 * 现在：
 * - 草稿正文（HTML）放 IndexedDB（见 draftContentStore.ts），localStorage 不再存 HTML；
 * - localStorage 只留一个极小的「标记」键，值为侧栏预览用的纯文本摘要 ——
 *   它同时承担「该会话有没有草稿」与「列表标题预览」两个同步查询的职责；
 * - IndexedDB 不可用（隐私模式 / 老浏览器）时回退到旧行为：整块 HTML 写 localStorage，
 *   保证功能不丢。
 *
 * 兼容：旧用户 localStorage 里已是整块 HTML，`readComposerDraft` 会自动读取，
 * 组件下次保存时迁移到 IndexedDB 并清理旧键。
 */

import { lsGet, lsRemove, lsSet } from "./localStorageSafe";
import { deleteDraftImagesForDraft } from "./draftImageStore";
import {
  deleteDraftContent,
  getDraftContent,
  putDraftContent,
} from "./draftContentStore";

/** 无活跃会话时输入框草稿的 localStorage key 后缀 */
export const COMPOSER_PENDING_DRAFT_KEY = "__composer-pending__";

const LEGACY_HTML_PREFIX = "vibe-coding-input-draft-";
const META_PREFIX = "vibe-coding-draft-meta-";

/** 旧格式：整块 HTML 直接存这个 key（现仅作降级 / 迁移读取） */
export function composerDraftStorageKey(draftKey: string): string {
  return `${LEGACY_HTML_PREFIX}${draftKey || "__global"}`;
}

/** 轻量标记 + 预览键（值为纯文本摘要，体积与正文大块内容无关） */
export function composerDraftMetaKey(draftKey: string): string {
  return `${META_PREFIX}${draftKey || "__global"}`;
}

export interface StoredComposerDraft {
  html: string;
  preview: string;
  /** 拖入文件正文（从 HTML 里剥出，按 dropRef 索引）；IDB 模式下才有 */
  inlineDropContents?: Record<string, string>;
}

export function isPlaceholderComposerHtml(html: string): boolean {
  const trimmed = html.trim();
  return !trimmed || trimmed === "<br>" || trimmed === "<br/>" || trimmed === "<br />";
}

/** 从 HTML 计算侧栏预览用的纯文本摘要（不含大块内容）。 */
export function previewTextFromHtml(html: string, maxLen = 48): string | null {
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

/** 写入 / 更新标记键（标记存在即代表「该会话有草稿」）。 */
export function writeComposerDraftMarker(draftKey: string, preview: string): void {
  lsSet(composerDraftMetaKey(draftKey), preview);
}

/** 读取标记键的预览文本；无草稿或纯图片草稿返回 null。 */
export function composerDraftPreviewText(draftKey: string, maxLen = 48): string | null {
  const marker = lsGet(composerDraftMetaKey(draftKey));
  if (marker !== null) {
    const text = marker.trim();
    if (!text) return null;
    return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
  }
  // 兼容：旧草稿没有标记键，从 localStorage 的 HTML 里现算
  const legacy = lsGet(composerDraftStorageKey(draftKey));
  if (legacy === null) return null;
  return previewTextFromHtml(legacy, maxLen);
}

/** 是否存在草稿（标记键存在，或旧格式 HTML 键存在）。 */
export function hasComposerDraft(draftKey: string): boolean {
  if (lsGet(composerDraftMetaKey(draftKey)) !== null) return true;
  return lsGet(composerDraftStorageKey(draftKey)) !== null;
}

/**
 * 异步读取草稿正文：优先 IndexedDB；无记录时回退 localStorage（旧格式 / 无 IDB 降级）。
 * 返回 null 表示没有草稿。
 */
export async function readComposerDraft(draftKey: string): Promise<StoredComposerDraft | null> {
  const rec = await getDraftContent(draftKey);
  if (rec) {
    return {
      html: rec.html,
      preview: rec.preview,
      inlineDropContents: rec.inlineDropContents,
    };
  }
  const legacy = lsGet(composerDraftStorageKey(draftKey));
  if (legacy === null) return null;
  return { html: legacy, preview: composerDraftPreviewText(draftKey) ?? "" };
}

/**
 * 同步读取 localStorage 里的草稿 HTML（旧格式 / 降级路径）。
 * IDB 模式下 HTML 不在 localStorage，会返回 null —— 需要正文请用 `readComposerDraft`。
 */
export function readComposerDraftHtml(draftKey: string): string | null {
  const raw = lsGet(composerDraftStorageKey(draftKey));
  if (!raw || isPlaceholderComposerHtml(raw)) return null;
  return raw;
}

/** 持久化草稿正文：优先写 IndexedDB（localStorage 只留标记），失败则回退整块写 localStorage。
 *
 *  注意：标记键（hasComposerDraft 的同步判据）在函数开头就同步写入 ——
 *  因为不少调用方「保存后立刻同步查 hasComposerDraft」（如切换会话时
 *  finalizeDraftSessionOnLeave），若等 IndexedDB await 完再写标记，查询会漏。
 *  正文 HTML 异步落 IndexedDB；两者都失败时回滚标记，避免留下「有标记没内容」的幻影草稿。
 */
export async function persistComposerDraft(
  draftKey: string,
  record: { html: string; preview: string; inlineDropContents?: Record<string, string> },
): Promise<boolean> {
  writeComposerDraftMarker(draftKey, record.preview);

  const ok = await putDraftContent({
    draftKey,
    html: record.html,
    preview: record.preview,
    inlineDropContents: record.inlineDropContents,
    updatedAt: Date.now(),
  });
  if (ok) {
    // 迁移完成后清掉旧的大块 HTML 键
    lsRemove(composerDraftStorageKey(draftKey));
    return true;
  }
  // 降级：IndexedDB 不可用，回到旧行为（整块 HTML 写 localStorage）。
  // 此时需把剥出的文件正文内联回 HTML，保证 localStorage 里是自包含的完整内容。
  const fallbackHtml = inlineDropContents(record.html, record.inlineDropContents);
  const fallbackOk = lsSet(composerDraftStorageKey(draftKey), fallbackHtml);
  if (!fallbackOk) {
    // 正文没落盘，标记也不能留 —— 否则 hasComposerDraft 会误报有草稿
    lsRemove(composerDraftMetaKey(draftKey));
  }
  return fallbackOk;
}

/** 异步彻底删除草稿：正文(IDB) + 标记 + 旧 HTML + 图片(IDB)。 */
export async function removeComposerDraft(draftKey: string): Promise<void> {
  lsRemove(composerDraftMetaKey(draftKey));
  lsRemove(composerDraftStorageKey(draftKey));
  await Promise.all([
    deleteDraftContent(draftKey || "__global"),
    deleteDraftImagesForDraft(draftKey || "__global"),
  ]);
}

/* ------------------------------------------------------------------ *
 * 拖入文件正文的抽取 / 回填
 *
 * 与图片同一套路：HTML 里只留 `data-drop-ref`，正文（可能很大）存 IndexedDB。
 * 这些是纯字符串函数，便于单测。
 * ------------------------------------------------------------------ */

const DROP_TAG_RE = /<span\b[^>]*\bclass="[^"]*\bcomposer-chip-drop\b[^"]*"[^>]*>/gi;
const DROP_CONTENT_ATTR_RE = /\sdata-drop-content="([^"]*)"/i;

/** DOM 序列化只会把 `&` / `"` 转义，这里保持一致，保证 extract → inline 语义可逆。 */
function escapeAttrValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function unescapeAttrValue(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 把 HTML 里所有拖入文件正文抽出，用 `data-drop-ref` 替换，返回剥离后的 HTML 与映射。 */
export function extractDropContents(html: string): {
  html: string;
  contents: Record<string, string>;
} {
  const contents: Record<string, string> = {};
  let n = 0;
  const stripped = html.replace(DROP_TAG_RE, (tag) => {
    const m = tag.match(DROP_CONTENT_ATTR_RE);
    if (!m) return tag;
    const ref = `drop-ref-${n++}`;
    contents[ref] = unescapeAttrValue(m[1]!);
    return tag.replace(DROP_CONTENT_ATTR_RE, ` data-drop-ref="${ref}"`);
  });
  return { html: stripped, contents };
}

/** 把抽出的拖入文件正文按 `data-drop-ref` 回填进 HTML。 */
export function inlineDropContents(
  html: string,
  contents: Record<string, string> | undefined,
): string {
  if (!contents) return html;
  return html.replace(
    /<span\b[^>]*\bdata-drop-ref="([^"]*)"[^>]*>/gi,
    (tag, ref: string) => {
      const content = contents[ref];
      if (content == null) return tag;
      return tag.replace(
        /\sdata-drop-ref="[^"]*"/i,
        ` data-drop-content="${escapeAttrValue(content)}"`,
      );
    },
  );
}
