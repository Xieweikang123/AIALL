/**
 * 草稿图片的 IndexedDB 存储。
 *
 * 背景：输入框草稿整块 HTML 存在 localStorage（见 composerDraftStorage.ts），
 * 而图片是完整 base64 data URL —— 单张大截图就能撑爆 ~5MB 同源配额，导致
 * setItem 抛 QuotaExceededError、草稿静默丢失。这里把图片本体挪到 IndexedDB
 * （容量大得多），localStorage 只留 `data-image-ref` 引用，从根上解决撑爆问题。
 *
 * IndexedDB 不可用（隐私模式 / 老浏览器）时各函数返回 false / null，
 * 调用方自行降级回内联 data URL。
 */

import { awaitTransaction, openDraftDb, STORE_IMAGES } from "./draftDb";

const ID_PREFIX = "img-";

export interface DraftImageRecord {
  id: string;
  draftKey: string;
  dataUrl: string;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return openDraftDb();
}

/** 生成稳定且几乎不重复的图片记录 id（chip 上的 data-image-ref 用它）。 */
export function createDraftImageId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${ID_PREFIX}${crypto.randomUUID()}`;
    }
  } catch {
    // ignore: 回退到时间戳 + 随机串
  }
  return `${ID_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 写入/覆盖一张图片；返回 false 表示 IndexedDB 不可用或写入失败。 */
export async function putDraftImage(id: string, draftKey: string, dataUrl: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    tx.objectStore(STORE_IMAGES).put({ id, draftKey, dataUrl, updatedAt: Date.now() });
    await awaitTransaction(tx);
    return true;
  } catch {
    return false;
  }
}

/** 读取单张图片，不存在返回 null。 */
export async function getDraftImage(id: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_IMAGES, "readonly");
    const req = tx.objectStore(STORE_IMAGES).get(id);
    const record = await new Promise<DraftImageRecord | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as DraftImageRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    await awaitTransaction(tx).catch(() => undefined);
    return record?.dataUrl ?? null;
  } catch {
    return null;
  }
}

/** 批量读取图片，返回 id → dataUrl 映射（缺失的 id 不在 map 里）。 */
export async function getDraftImages(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const db = await openDb();
  if (!db) return map;
  try {
    const tx = db.transaction(STORE_IMAGES, "readonly");
    const store = tx.objectStore(STORE_IMAGES);
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            const req = store.get(id);
            req.onsuccess = () => {
              const record = req.result as DraftImageRecord | undefined;
              if (record?.dataUrl) map.set(id, record.dataUrl);
              resolve();
            };
            req.onerror = () => resolve();
          }),
      ),
    );
    await awaitTransaction(tx).catch(() => undefined);
  } catch {
    // ignore
  }
  return map;
}

/** 删除某个草稿下的全部图片（草稿被清空 / 发送后调用）。 */
export async function deleteDraftImagesForDraft(draftKey: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    const req = tx.objectStore(STORE_IMAGES).index("draftKey").openCursor(draftKey);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await awaitTransaction(tx);
  } catch {
    // ignore
  }
}

/** 保留 keepIds 中的图片，删除同一草稿下其余图片（用户删掉了某张图时清理）。 */
export async function pruneDraftImages(draftKey: string, keepIds: Set<string>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_IMAGES, "readwrite");
    const req = tx.objectStore(STORE_IMAGES).index("draftKey").openCursor(draftKey);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const record = cursor.value as DraftImageRecord;
      if (!keepIds.has(record.id)) cursor.delete();
      cursor.continue();
    };
    await awaitTransaction(tx);
  } catch {
    // ignore
  }
}
