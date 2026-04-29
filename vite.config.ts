import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import type { IncomingMessage, ServerResponse } from "node:http";

interface ForwardRequestBody {
  endpoint: string;
  apiKey?: string;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
  input?: string;
  voice?: string;
  format?: "mp3" | "wav" | "opus";
}

function readJsonBody(req: IncomingMessage): Promise<ForwardRequestBody> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as ForwardRequestBody);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function buildHeaders(apiKey?: string): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export default defineConfig({
  plugins: [
    vue(),
    {
      name: "ai-forward-middleware",
      configureServer(server) {
        server.middlewares.use("/backend/ai/test", async (req, res) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "仅支持 POST 请求" });
            return;
          }

          try {
            const body = await readJsonBody(req);
            if (!body.endpoint || !body.model || !Array.isArray(body.messages)) {
              sendJson(res, 400, { error: "请求参数不完整" });
              return;
            }

            const upstream = await fetch(body.endpoint, {
              method: "POST",
              headers: buildHeaders(body.apiKey),
              body: JSON.stringify({
                model: body.model,
                messages: body.messages,
                stream: body.stream,
              }),
            });

            res.statusCode = upstream.status;
            const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
            res.setHeader("Content-Type", contentType);

            if (!upstream.body) {
              res.end();
              return;
            }

            const reader = upstream.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) res.write(Buffer.from(value));
            }
            res.end();
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "转发请求失败",
            });
          }
        });

        server.middlewares.use("/backend/ai/models", async (req, res) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "仅支持 POST 请求" });
            return;
          }

          try {
            const body = await readJsonBody(req);
            if (!body.endpoint) {
              sendJson(res, 400, { error: "请求参数不完整" });
              return;
            }

            const upstream = await fetch(body.endpoint, {
              method: "GET",
              headers: buildHeaders(body.apiKey),
            });

            const rawText = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
            res.end(rawText);
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "获取模型失败",
            });
          }
        });

        server.middlewares.use("/backend/ai/tts", async (req, res) => {
          if (req.method !== "POST") {
            sendJson(res, 405, { error: "仅支持 POST 请求" });
            return;
          }

          try {
            const body = await readJsonBody(req);
            if (!body.endpoint || !body.model || !body.input || !body.voice) {
              sendJson(res, 400, { error: "请求参数不完整" });
              return;
            }

            const upstream = await fetch(body.endpoint, {
              method: "POST",
              headers: buildHeaders(body.apiKey),
              body: JSON.stringify({
                model: body.model,
                input: body.input,
                voice: body.voice,
                format: body.format || "mp3",
              }),
            });

            res.statusCode = upstream.status;
            res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");

            const arrayBuffer = await upstream.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "TTS 请求失败",
            });
          }
        });
      },
    },
  ],
});
