/**
 * 草稿「大块内容」的 IndexedDB 存储：输入框 HTML（含拖入文件全文）+ 摘要。
 *
 * 背景：早期草稿整块 HTML 存 localStorage（~5MB 同源配额），图片挪去 IndexedDB
 * 后仍在 HTML 里留两大隐患 —— ① 拖入文件的全文（`data-drop-content`）
 * ② 越来越长的正文。两者都能把 localStorage 撑爆，导致 setItem 抛错、草稿丢失。
 * 这里把 HTML 与「侧栏预览用的摘要」一起搬到 IndexedDB，localStorage 不再存 HTML。
 *
 * 降级：IndexedDB 不可用（隐私模式 / 老浏览器）时各函数返回 false / null，
 * 由调用方（composerDraftStorage）回退到 localStorage 内联存储，行为不丢。
 */

import { STORE_CONTENT, awaitTransaction, openDraftDb } from "./draftDb";

export interface DraftContentRecord {
  draftKey: string;
  /** 已序列化的草稿 HTML（图片只留 data-image-id 引用；拖入文件只留 dropRef） */
  html: string;
  /** 侧栏预览用的纯文本摘要（不含大块内容） */
  preview: string;
  /** 从 HTML 中剥出的拖入文件正文（按 dropRef 索引）；IndexedDB 不可用时用于内联降级 */
  inlineDropContents?: Record<string, string>;
  updatedAt: number;
}

/** 写入 / 覆盖某个草稿的内容记录；返回 false 表示 IndexedDB 不可用或写入失败。 */
export async function putDraftContent(record: DraftContentRecord): Promise<boolean> {
  const db = await openDraftDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE_CONTENT, "readwrite");
    tx.objectStore(STORE_CONTENT).put(record);
    await awaitTransaction(tx);
    return true;
  } catch {
    return false;
  }
}

/** 读取某个草稿的内容记录，不存在返回 null。 */
export async function getDraftContent(draftKey: string): Promise<DraftContentRecord | null> {
  const db = await openDraftDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_CONTENT, "readonly");
    const req = tx.objectStore(STORE_CONTENT).get(draftKey);
    const record = await new Promise<DraftContentRecord | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as DraftContentRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    await awaitTransaction(tx).catch(() => undefined);
    return record ?? null;
  } catch {
    return null;
  }
}

/** 删除某个草稿的内容记录（草稿被清空 / 发送后调用）。 */
export async function deleteDraftContent(draftKey: string): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_CONTENT, "readwrite");
    tx.objectStore(STORE_CONTENT).delete(draftKey);
    await awaitTransaction(tx);
  } catch {
    // ignore
  }
}
