import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { readJsonBody, sendJson } from "./server/httpUtils";
import {
  grepInProject,
  listDirectory,
  readFileContent,
  resolveProjectPath,
  searchFiles,
  writeFileContent,
} from "./server/vibeFs";

function resolvePathInsideOptionalRoot(inputPath: string, projectRoot?: string): { ok: true; path: string } | { ok: false; error: string } {
  const trimmed = String(inputPath || "").trim();
  if (!trimmed) return { ok: false, error: "路径不能为空" };

  const rootInput = projectRoot?.trim();
  if (!rootInput) return { ok: true, path: path.resolve(trimmed) };

  return resolveProjectPath(rootInput, trimmed);
}

const dirListCache = new Map<string, { items: unknown[]; ts: number }>();
const DIR_LIST_CACHE_TTL_MS = 30_000;

function getCachedDirList(dirPath: string): unknown[] | null {
  const entry = dirListCache.get(dirPath);
  if (entry && Date.now() - entry.ts < DIR_LIST_CACHE_TTL_MS) {
    return entry.items;
  }
  dirListCache.delete(dirPath);
  return null;
}

function setCachedDirList(dirPath: string, items: unknown[]) {
  dirListCache.set(dirPath, { items, ts: Date.now() });
}

export function registerFileOpsRoutes(middlewares: Connect.Server) {
  // GET /backend/vibe/list
  middlewares.use("/backend/vibe/list", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const dirPath = url.searchParams.get("path") || "";

      if (!dirPath) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(dirPath);

      const cached = getCachedDirList(resolved);
      if (cached) {
        sendJson(res, 200, { ok: true, path: resolved, items: cached });
        return;
      }

      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        sendJson(res, 400, { error: "路径不存在或不是目录" });
        return;
      }

      const items = await listDirectory(resolved);
      setCachedDirList(resolved, items);
      sendJson(res, 200, { ok: true, path: resolved, items });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "读取目录失败" });
    }
  });

  // POST /backend/vibe/read
  middlewares.use("/backend/vibe/read", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; projectRoot?: string };
      if (!body.path) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolvedPath = resolvePathInsideOptionalRoot(body.path, body.projectRoot);
      if (!resolvedPath.ok) {
        sendJson(res, 400, { error: resolvedPath.error });
        return;
      }
      const resolved = resolvedPath.path;
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isFile()) {
        sendJson(res, 400, { error: "文件不存在" });
        return;
      }

      const result = await readFileContent(resolved);
      if (!result.ok) {
        sendJson(res, 400, { error: result.error, size: result.size });
        return;
      }

      sendJson(res, 200, { ok: true, content: result.content, size: result.size, path: resolved });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "读取文件失败" });
    }
  });

  // POST /backend/vibe/write
  middlewares.use("/backend/vibe/write", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; content?: string; projectRoot?: string };
      if (!body.path || body.content === undefined) {
        sendJson(res, 400, { error: "缺少 path 或 content 参数" });
        return;
      }

      const resolvedPath = resolvePathInsideOptionalRoot(body.path, body.projectRoot);
      if (!resolvedPath.ok) {
        sendJson(res, 400, { error: resolvedPath.error });
        return;
      }
      const resolved = resolvedPath.path;
      const result = await writeFileContent(resolved, body.content);
      sendJson(res, 200, { ok: true, size: result.size, path: resolved });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "写入文件失败" });
    }
  });

  // GET /backend/vibe/search
  middlewares.use("/backend/vibe/search", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const dirPath = url.searchParams.get("path") || "";
      const query = url.searchParams.get("q") || "";

      if (!dirPath || !query) {
        sendJson(res, 400, { error: "缺少 path 或 q 参数" });
        return;
      }

      const resolved = path.resolve(dirPath);
      const results = await searchFiles(resolved, query);
      sendJson(res, 200, { ok: true, results });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "搜索失败" });
    }
  });

  // GET /backend/vibe/grep
  middlewares.use("/backend/vibe/grep", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const dirPath = url.searchParams.get("path") || "";
      const pattern = url.searchParams.get("q") || "";

      if (!dirPath || !pattern.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 或 q 参数" });
        return;
      }

      const resolved = path.resolve(dirPath);
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        sendJson(res, 400, { ok: false, error: "路径不存在或不是目录" });
        return;
      }

      const result = await grepInProject(resolved, pattern.trim());
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: result.error });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        results: result.matches.map((m) => ({
          path: m.file,
          relative: m.relative,
          line: m.line,
          text: m.text,
        })),
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "搜索失败" });
    }
  });

  // POST /backend/vibe/create
  middlewares.use("/backend/vibe/create", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; isDirectory?: boolean; content?: string; projectRoot?: string };
      if (!body.path) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolvedPath = resolvePathInsideOptionalRoot(body.path, body.projectRoot);
      if (!resolvedPath.ok) {
        sendJson(res, 400, { error: resolvedPath.error });
        return;
      }
      const resolved = resolvedPath.path;

      if (body.isDirectory) {
        await fs.promises.mkdir(resolved, { recursive: true });
        sendJson(res, 200, { ok: true, path: resolved, type: "directory" });
      } else {
        const dir = path.dirname(resolved);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(resolved, body.content || "", "utf-8");
        sendJson(res, 200, { ok: true, path: resolved, type: "file" });
      }
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "创建失败" });
    }
  });

  // DELETE /backend/vibe/delete
  middlewares.use("/backend/vibe/delete", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "DELETE") {
      sendJson(res, 405, { error: "仅支持 DELETE 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const targetPath = url.searchParams.get("path") || "";
      const projectRoot = url.searchParams.get("projectRoot") || undefined;

      if (!targetPath) {
        sendJson(res, 400, { error: "缺少 path 参数" });
        return;
      }

      const resolvedPath = resolvePathInsideOptionalRoot(targetPath, projectRoot);
      if (!resolvedPath.ok) {
        sendJson(res, 400, { error: resolvedPath.error });
        return;
      }
      const resolved = resolvedPath.path;
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat) {
        sendJson(res, 404, { error: "文件或目录不存在" });
        return;
      }

      if (stat.isDirectory()) {
        await fs.promises.rm(resolved, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(resolved);
      }

      sendJson(res, 200, { ok: true, path: resolved });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "删除失败" });
    }
  });

  // POST /backend/vibe/rename
  middlewares.use("/backend/vibe/rename", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { from?: string; to?: string; projectRoot?: string };
      const fromPath = (body.from || "").trim();
      const toPath = (body.to || "").trim();

      if (!fromPath || !toPath) {
        sendJson(res, 400, { error: "缺少 from 或 to 参数" });
        return;
      }

      const resolvedFromPath = resolvePathInsideOptionalRoot(fromPath, body.projectRoot);
      const resolvedToPath = resolvePathInsideOptionalRoot(toPath, body.projectRoot);
      if (!resolvedFromPath.ok || !resolvedToPath.ok) {
        sendJson(res, 400, { error: !resolvedFromPath.ok ? resolvedFromPath.error : resolvedToPath.error });
        return;
      }
      const resolvedFrom = resolvedFromPath.path;
      const resolvedTo = resolvedToPath.path;

      const stat = await fs.promises.stat(resolvedFrom).catch(() => null);
      if (!stat) {
        sendJson(res, 404, { error: "源路径不存在" });
        return;
      }

      await fs.promises.mkdir(path.dirname(resolvedTo), { recursive: true });
      await fs.promises.rename(resolvedFrom, resolvedTo);
      sendJson(res, 200, { ok: true, from: resolvedFrom, to: resolvedTo });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "重命名失败" });
    }
  });
}
