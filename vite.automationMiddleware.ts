/**
 * 开发服：按图标模板在屏幕上查找并点击（仅 Windows）
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { findTemplateNcc } from "./server/templateMatch";
import { capturePrimaryScreenPng, clickLeftAtScreen } from "./server/winDesktop";

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

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function paths(projectRoot: string) {
  const base = path.join(projectRoot, "data", "icon-templates");
  const storePath = path.join(base, "store.json");
  const imagesDir = path.join(base, "images");
  return { storePath, imagesDir };
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

export function registerAutomationMiddleware(
  middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void },
  projectRoot: string,
) {
  const { storePath, imagesDir } = paths(projectRoot);

  middlewares.use(async (req, res, next) => {
    const url = req.url || "";
    if (!url.startsWith("/backend/automation")) {
      next();
      return;
    }

    if (url.split("?")[0] !== "/backend/automation/open-by-template" || req.method !== "POST") {
      sendJson(res, 404, { ok: false, error: "Not Found" });
      return;
    }

    if (process.platform !== "win32") {
      sendJson(res, 501, { ok: false, error: "仅在本机 Windows + npm run dev 下可用" });
      return;
    }

    let body: { id?: string };
    try {
      body = (await readJsonBody(req)) as { id?: string };
    } catch {
      sendJson(res, 400, { ok: false, error: "请求体不是合法 JSON" });
      return;
    }

    const id = String(body?.id || "")
      .trim()
      .toLowerCase();
    if (!id) {
      sendJson(res, 400, { ok: false, error: "缺少 id" });
      return;
    }

    try {
      const store = await readStore(storePath);
      const item = store.items.find((x) => x.id === id);
      if (!item) {
        sendJson(res, 404, { ok: false, error: `未找到模板 id：${id}` });
        return;
      }
      if (!item.imageFile) {
        sendJson(res, 400, { ok: false, error: "该条目没有模板图，请先在「图标模板」中上传" });
        return;
      }

      const tplPath = path.join(imagesDir, item.imageFile);
      const tplBuf = await fs.readFile(tplPath);

      const cap = await capturePrimaryScreenPng();
      if (Buffer.isBuffer(cap) === false) {
        sendJson(res, 500, { ok: false, error: (cap as { error: string }).error });
        return;
      }

      const match = await findTemplateNcc(cap, tplBuf);
      if ("error" in match) {
        sendJson(res, 422, { ok: false, error: match.error });
        return;
      }

      const clickResult = await clickLeftAtScreen(match.clickX, match.clickY);
      if (clickResult && "error" in clickResult) {
        sendJson(res, 500, { ok: false, error: clickResult.error });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        id: item.id,
        name: item.name,
        score: match.score,
        clickX: match.clickX,
        clickY: match.clickY,
        topLeftX: match.topLeftX,
        topLeftY: match.topLeftY,
      });
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : "自动化执行失败",
      });
    }
  });
}
