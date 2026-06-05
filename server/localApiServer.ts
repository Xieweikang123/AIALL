import http from "node:http";
import connect from "connect";
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
