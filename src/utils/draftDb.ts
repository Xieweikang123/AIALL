/**
 * 草稿 IndexedDB 连接（共享 opener）。
 *
 * 草稿有两类「大块」内容都放 IndexedDB：
 * - images：图片本体（见 draftImageStore.ts）
 * - content：输入框 HTML + 拖入文件全文（见 draftContentStore.ts）
 *
 * 两者共用同一个数据库，所以 store 的创建必须集中在一次 upgrade 里完成：
 * 若各自用不同 open 版本，先开的那个把 DB 升到高版本后，后开的不会再触发
 * upgradeneeded，缺失的 store 就永远建不出来。这里统一 DB_VERSION 与建表逻辑。
 *
 * IndexedDB 不可用（隐私模式 / 老浏览器）时 openDraftDb 解析为 null，
 * 调用方自行降级回内联 localStorage。
 */

const DB_NAME = "aiall-composer-drafts";
const DB_VERSION = 2;
export const STORE_IMAGES = "images";
export const STORE_CONTENT = "content";

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function openDraftDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          const store = db.createObjectStore(STORE_IMAGES, { keyPath: "id" });
          store.createIndex("draftKey", "draftKey", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CONTENT)) {
          db.createObjectStore(STORE_CONTENT, { keyPath: "draftKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb transaction aborted"));
  });
}
