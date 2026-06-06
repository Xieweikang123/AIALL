/**
 * 开发服：图标模板资源库（JSON + 本地图片）
 * 数据目录：<projectRoot>/data/icon-templates/
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { readJsonBody, sendJson } from "./server/httpUtils";

const STORE_VERSION = 1 as const;

interface IconTemplateItem {
  id: string;
  name: string;
  aliases: string[];
  note: string;
  imageFile: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoreFile {
  version: typeof STORE_VERSION;
  updatedAt: string;
  items: IconTemplateItem[];
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function sanitizeId(raw: string): string | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!ID_RE.test(s)) return null;
  return s;
}

function parseBase64Image(
  input: string,
): { ext: string; buffer: Buffer } | { error: string } {
  const trimmed = String(input || "").trim();
  if (!trimmed) return { error: "图片为空" };

  const dataUrl = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i.exec(trimmed);
  if (dataUrl) {
    const kind = dataUrl[1].toLowerCase();
    const ext = kind === "jpeg" ? "jpg" : kind;
    try {
      const buffer = Buffer.from(dataUrl[2], "base64");
      if (!buffer.length) return { error: "图片解码后为空" };
      return { ext, buffer };
    } catch {
      return { error: "Base64 解码失败" };
    }
  }

  try {
    const buffer = Buffer.from(trimmed, "base64");
    if (!buffer.length) return { error: "请使用 PNG/JPEG 的 data URL 或合法 base64" };
    return { ext: "png", buffer };
  } catch {
    return { error: "Base64 解码失败" };
  }
}

function paths(projectRoot: string) {
  const base = path.join(projectRoot, "data", "icon-templates");
  const storePath = path.join(base, "store.json");
  const imagesDir = path.join(base, "images");
  return { base, storePath, imagesDir };
}

async function ensureDirs(imagesDir: string) {
  await fs.mkdir(imagesDir, { recursive: true });
}

async function readStore(storePath: string): Promise<StoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.items)) {
      return { version: STORE_VERSION, updatedAt: new Date().toISOString(), items: [] };
    }
    return parsed;
  } catch {
    return { version: STORE_VERSION, updatedAt: new Date().toISOString(), items: [] };
  }
}

async function writeStore(storePath: string, store: StoreFile) {
  store.updatedAt = new Date().toISOString();
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf-8");
}

function safeAssetName(name: string): boolean {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  return /^[a-z0-9._-]+\.(png|jpg|jpeg|gif|webp)$/i.test(name);
}

function pathnameOnly(url: string): string {
  try {
    const p = new URL(url, "http://vite.local").pathname.replace(/\/+$/, "") || "/";
    return p;
  } catch {
    return "/";
  }
}

export function registerIconTemplatesMiddleware(
  middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void },
  projectRoot: string,
) {
  const { storePath, imagesDir } = paths(projectRoot);

  middlewares.use(async (req, res, next) => {
    const url = req.url || "";
    if (!url.startsWith("/backend/icon-templates")) {
      next();
      return;
    }

    const pathname = pathnameOnly(url);
    const assetPrefix = "/backend/icon-templates/assets/";
    if (pathname.startsWith(`${assetPrefix}`) && req.method === "GET") {
      const name = decodeURIComponent(pathname.slice(assetPrefix.length) || "");
      if (!safeAssetName(name)) {
        sendJson(res, 400, { ok: false, error: "非法资源名" });
        return;
      }
      const filePath = path.join(imagesDir, name);
      const resolved = path.resolve(filePath);
      const imagesResolved = path.resolve(imagesDir);
      if (!resolved.startsWith(imagesResolved + path.sep) && resolved !== imagesResolved) {
        sendJson(res, 400, { ok: false, error: "路径非法" });
        return;
      }
      try {
        const buf = await fs.readFile(resolved);
        const lower = name.toLowerCase();
        const mime = lower.endsWith(".png")
          ? "image/png"
          : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
            ? "image/jpeg"
            : lower.endsWith(".gif")
              ? "image/gif"
              : lower.endsWith(".webp")
                ? "image/webp"
                : "application/octet-stream";
        res.statusCode = 200;
        res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "no-cache");
        res.end(buf);
      } catch {
        res.statusCode = 404;
        res.end();
      }
      return;
    }

    if (pathname === "/backend/icon-templates" && req.method === "GET") {
      try {
        await ensureDirs(imagesDir);
        const store = await readStore(storePath);
        const items = store.items.map((item) => ({
          ...item,
          imageUrl: item.imageFile ? `${assetPrefix}${encodeURIComponent(item.imageFile)}` : null,
        }));
        sendJson(res, 200, {
          ok: true,
          storePath: path.relative(projectRoot, storePath) || "data/icon-templates/store.json",
          imagesPath: path.relative(projectRoot, imagesDir) || "data/icon-templates/images",
          items,
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : "读取失败" });
      }
      return;
    }

    if (pathname === "/backend/icon-templates" && req.method === "POST") {
      try {
        await ensureDirs(imagesDir);
        const body = (await readJsonBody(req)) as {
          id?: string;
          name?: string;
          aliases?: unknown;
          note?: string;
          imageBase64?: string | null;
          clearImage?: boolean;
        };

        const id = sanitizeId(body.id || "");
        if (!id) {
          sendJson(res, 400, {
            ok: false,
            error: "id 须为小写字母/数字/下划线/短横线，长度 1～64，且以字母或数字开头",
          });
          return;
        }

        const name = String(body.name || "").trim();
        if (!name) {
          sendJson(res, 400, { ok: false, error: "名称不能为空" });
          return;
        }

        let aliases: string[] = [];
        if (Array.isArray(body.aliases)) {
          aliases = body.aliases.map((a) => String(a || "").trim()).filter(Boolean).slice(0, 32);
        }

        const note = String(body.note || "").trim().slice(0, 500);
        const store = await readStore(storePath);
        const now = new Date().toISOString();
        const idx = store.items.findIndex((x) => x.id === id);
        const prev = idx >= 0 ? store.items[idx] : null;

        let imageFile: string | null = prev?.imageFile ?? null;

        if (body.clearImage) {
          if (imageFile) {
            try {
              await fs.unlink(path.join(imagesDir, imageFile));
            } catch {
              // ignore
            }
          }
          imageFile = null;
        } else if (body.imageBase64 != null && String(body.imageBase64).trim()) {
          const parsed = parseBase64Image(String(body.imageBase64));
          if ("error" in parsed) {
            sendJson(res, 400, { ok: false, error: parsed.error });
            return;
          }
          const newName = `${id}.${parsed.ext}`;
          if (imageFile && imageFile !== newName) {
            try {
              await fs.unlink(path.join(imagesDir, imageFile));
            } catch {
              // ignore
            }
          }
          await fs.writeFile(path.join(imagesDir, newName), parsed.buffer);
          imageFile = newName;
        }

        if (!prev && !imageFile) {
          sendJson(res, 400, { ok: false, error: "新建条目必须上传一张模板小图" });
          return;
        }

        const item: IconTemplateItem = {
          id,
          name,
          aliases,
          note,
          imageFile,
          createdAt: prev?.createdAt ?? now,
          updatedAt: now,
        };

        if (idx >= 0) store.items[idx] = item;
        else store.items.push(item);

        await writeStore(storePath, store);
        sendJson(res, 200, { ok: true, item });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : "保存失败" });
      }
      return;
    }

    if (pathname === "/backend/icon-templates" && req.method === "DELETE") {
      try {
        const q = new URL(url, "http://vite.local").searchParams;
        const id = sanitizeId(q.get("id") || "");
        if (!id) {
          sendJson(res, 400, { ok: false, error: "缺少合法 id" });
          return;
        }
        await ensureDirs(imagesDir);
        const store = await readStore(storePath);
        const idx = store.items.findIndex((x) => x.id === id);
        if (idx < 0) {
          sendJson(res, 404, { ok: false, error: "未找到该 id" });
          return;
        }
        const removed = store.items[idx];
        store.items.splice(idx, 1);
        if (removed.imageFile) {
          try {
            await fs.unlink(path.join(imagesDir, removed.imageFile));
          } catch {
            // ignore
          }
        }
        await writeStore(storePath, store);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : "删除失败" });
      }
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
  });
}
