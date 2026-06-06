/**
 * 开发服：按图标模板在屏幕上查找并点击（仅 Windows）
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { readJsonBody, sendJson } from "./server/httpUtils";
import { findTemplateMatch, type MatchAlgorithm } from "./server/templateMatch";
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

async function matchTemplateForStoreItem(
  storePath: string,
  imagesDir: string,
  id: string,
  opts?: { attachScreenPngBase64?: boolean },
): Promise<
  | {
      ok: true;
      item: IconTemplateItem;
      score: number;
      clickX: number;
      clickY: number;
      topLeftX: number;
      topLeftY: number;
      matchAlgorithm: MatchAlgorithm;
      screenPngBase64?: string;
    }
  | { ok: false; status: number; error: string; screenPngBase64?: string }
> {
  const store = await readStore(storePath);
  const item = store.items.find((x) => x.id === id);
  if (!item) {
    return { ok: false, status: 404, error: `未找到模板 id：${id}` };
  }
  if (!item.imageFile) {
    return { ok: false, status: 400, error: "该条目没有模板图，请先在「图标模板」中上传" };
  }

  const tplPath = path.join(imagesDir, item.imageFile);
  const tplBuf = await fs.readFile(tplPath);

  const cap = await capturePrimaryScreenPng();
  if (Buffer.isBuffer(cap) === false) {
    return { ok: false, status: 500, error: (cap as { error: string }).error };
  }

  const screenB64 = opts?.attachScreenPngBase64 ? cap.toString("base64") : undefined;

  const match = await findTemplateMatch(cap, tplBuf);
  if ("error" in match) {
    return {
      ok: false,
      status: 422,
      error: match.error,
      ...(screenB64 ? { screenPngBase64: screenB64 } : {}),
    };
  }

  return {
    ok: true,
    item,
    score: match.score,
    clickX: match.clickX,
    clickY: match.clickY,
    topLeftX: match.topLeftX,
    topLeftY: match.topLeftY,
    matchAlgorithm: match.matchAlgorithm,
    ...(screenB64 ? { screenPngBase64: screenB64 } : {}),
  };
}

export function registerAutomationMiddleware(
  middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void },
  projectRoot: string,
) {
  const { storePath, imagesDir } = paths(projectRoot);

  middlewares.use(async (req, res, next) => {
    const pathname = (req.url || "").split("?")[0];
    if (!pathname.startsWith("/backend/automation")) {
      next();
      return;
    }

    const isOpen = pathname === "/backend/automation/open-by-template" && req.method === "POST";
    const isTest = pathname === "/backend/automation/test-match" && req.method === "POST";
    if (!isOpen && !isTest) {
      sendJson(res, 404, { ok: false, error: "Not Found" });
      return;
    }

    if (process.platform !== "win32") {
      sendJson(res, 501, { ok: false, error: "仅在本机 Windows 桌面环境下可用" });
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
      const result = await matchTemplateForStoreItem(storePath, imagesDir, id, {
        attachScreenPngBase64: isTest,
      });
      if (!result.ok) {
        sendJson(res, result.status, {
          ok: false,
          error: result.error,
          ...(result.screenPngBase64 ? { screenPngBase64: result.screenPngBase64 } : {}),
        });
        return;
      }

      if (isTest) {
        sendJson(res, 200, {
          ok: true,
          id: result.item.id,
          name: result.item.name,
          score: result.score,
          clickX: result.clickX,
          clickY: result.clickY,
          topLeftX: result.topLeftX,
          topLeftY: result.topLeftY,
          matchAlgorithm: result.matchAlgorithm,
          screenPngBase64: result.screenPngBase64 ?? "",
        });
        return;
      }

      const clickResult = await clickLeftAtScreen(result.clickX, result.clickY);
      if (clickResult && "error" in clickResult) {
        sendJson(res, 500, { ok: false, error: clickResult.error });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        id: result.item.id,
        name: result.item.name,
        score: result.score,
        clickX: result.clickX,
        clickY: result.clickY,
        topLeftX: result.topLeftX,
        topLeftY: result.topLeftY,
        matchAlgorithm: result.matchAlgorithm,
      });
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : "自动化执行失败",
      });
    }
  });
}
