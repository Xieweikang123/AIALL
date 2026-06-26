import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { readJsonBody, sendJson, sendSseEvent, sendSseComment, sendSseHeaders } from "./server/httpUtils";

export function registerFileWatcherRoutes(middlewares: Connect.Server) {
  // POST /backend/vibe/file-watcher/start
  middlewares.use("/backend/vibe/file-watcher/start", async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = (await readJsonBody(req)) as { path?: string; watchPaths?: string[] };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const watchPaths = body.watchPaths || [resolved];

      const { startGlobalWatcher, getGlobalWatcher } = await import("./server/fileWatcher");
      const watcher = getGlobalWatcher();

      if (watcher.isWatching()) {
        await watcher.stop();
      }

      await startGlobalWatcher(watchPaths);
      sendJson(res, 200, { ok: true, message: "文件监听已启动", watchedPaths: watcher.getWatchedPaths() });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "启动文件监听失败" });
    }
  });

  // POST /backend/vibe/file-watcher/stop
  middlewares.use("/backend/vibe/file-watcher/stop", async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const { stopGlobalWatcher } = await import("./server/fileWatcher");
      await stopGlobalWatcher();
      sendJson(res, 200, { ok: true, message: "文件监听已停止" });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "停止文件监听失败" });
    }
  });

  // GET /backend/vibe/file-watcher/stream (SSE)
  middlewares.use("/backend/vibe/file-watcher/stream", async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const { getGlobalWatcher } = await import("./server/fileWatcher");
      const watcher = getGlobalWatcher();

      if (!watcher.isWatching()) {
        sendJson(res, 200, { ok: false, error: "文件监听未启动" });
        return;
      }

      sendSseHeaders(res);
      sendSseEvent(res, "status", { connected: true });

      const onChanges = (changes: Array<{ type: string; path: string; timestamp: number }>) => {
        sendSseEvent(res, "changes", { changes });
      };

      watcher.on("changes", onChanges);

      const keepalive = setInterval(() => {
        sendSseComment(res, "keepalive");
      }, 15_000);

      req.on("close", () => {
        clearInterval(keepalive);
        watcher.removeListener("changes", onChanges);
      });
    } catch (error) {
      sendSseEvent(res, "error", { message: error instanceof Error ? error.message : "SSE 连接失败" });
      res.end();
    }
  });
}
