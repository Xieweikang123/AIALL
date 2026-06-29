import http from "node:http";
import connect from "connect";
import { exec } from "node:child_process";
import { registerAutomationMiddleware } from "../vite.automationMiddleware";
import { registerIconTemplatesMiddleware } from "../vite.iconTemplatesMiddleware";
import { registerVibeCodingMiddleware } from "../vite.vibeCodingMiddleware";
import { registerAiRoutes } from "./aiHttpHandlers";
import { corsMiddleware } from "./httpUtils";
import { registerWebRoutes } from "./webExtract";

export const DEFAULT_BACKEND_PORT = 37891;

export function resolveProjectRoot(): string {
  return process.env.AIALL_PROJECT_ROOT || process.cwd();
}

export function createLocalApiApp(projectRoot: string) {
  const app = connect();
  app.use(corsMiddleware);

  app.use("/backend/open-url", (req: any, res: any) => {
    try {
      const parsedUrl = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const url = parsedUrl.searchParams.get("url");
      if (!url) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Missing url parameter" }));
        return;
      }
      const urlObj = new URL(url);
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Only http and https protocols are allowed" }));
        return;
      }
      const safeUrl = urlObj.toString().replace(/"/g, "%22");
      let cmd = "";
      if (process.platform === "win32") {
        cmd = `start "" "${safeUrl}"`;
      } else if (process.platform === "darwin") {
        cmd = `open "${safeUrl}"`;
      } else {
        cmd = `xdg-open "${safeUrl}"`;
      }
      exec(cmd, (err) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        }
      });
    } catch (e: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });

  registerIconTemplatesMiddleware(app, projectRoot);
  registerAutomationMiddleware(app, projectRoot);
  registerVibeCodingMiddleware(app);
  registerWebRoutes(app);
  registerAiRoutes(app);
  return app;
}

export async function startLocalApiServer(options?: {
  port?: number;
  host?: string;
  projectRoot?: string;
}) {
  const port = options?.port ?? Number(process.env.AIALL_BACKEND_PORT || DEFAULT_BACKEND_PORT);
  const host = options?.host ?? "127.0.0.1";
  const projectRoot = options?.projectRoot ?? resolveProjectRoot();
  const app = createLocalApiApp(projectRoot);
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const url = `http://${host}:${port}`;
  console.log(`[aiall-backend] listening on ${url}`);
  return { server, port, host, projectRoot, url };
}
