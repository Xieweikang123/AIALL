import type { IncomingMessage, ServerResponse } from "node:http";
import { buildHeaders, resolveChatEndpoint } from "./aiForward";
import { readJsonBody, sendJson } from "./httpUtils";

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

function ttsFormatToMime(format?: string): string {
  if (format === "wav") return "audio/wav";
  if (format === "opus") return "audio/opus";
  return "audio/mpeg";
}

type ConnectApp = {
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
};

export function registerAiRoutes(middlewares: ConnectApp) {
  middlewares.use("/backend/ai/test", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as ForwardRequestBody;
      if (!body.endpoint || !body.model || !Array.isArray(body.messages)) {
        sendJson(res, 400, { error: "请求参数不完整" });
        return;
      }

      const chatEndpoint = resolveChatEndpoint(body.endpoint);

      const upstream = await fetch(chatEndpoint, {
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

      if (body.stream) {
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Accel-Buffering", "no");
        if (res.socket) res.socket.setNoDelay(true);
      }

      if (!upstream.body) {
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          res.write(Buffer.from(value));
          if (typeof (res as any).flush === "function") (res as any).flush();
        }
      }
      res.end();
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "转发请求失败",
      });
    }
  });

  middlewares.use("/backend/ai/models", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as ForwardRequestBody;
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

  middlewares.use("/backend/ai/tts", async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as ForwardRequestBody;
      if (!body.endpoint || !body.model || !body.input || !body.voice) {
        sendJson(res, 400, { error: "请求参数不完整" });
        return;
      }

      const chatEndpoint = resolveChatEndpoint(body.endpoint);
      const model = body.model || "";
      const useMimoTts = /mimo.*tts|tts.*mimo/i.test(model);

      if (useMimoTts) {
        const upstream = await fetch(chatEndpoint, {
          method: "POST",
          headers: buildHeaders(body.apiKey),
          body: JSON.stringify({
            model,
            messages: [
              { role: "user", content: "" },
              { role: "assistant", content: body.input },
            ],
            audio: {
              format: body.format || "mp3",
              voice: body.voice,
            },
          }),
        });

        const rawText = await upstream.text();
        if (!upstream.ok) {
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
          res.end(rawText);
          return;
        }

        let audioBase64 = "";
        try {
          const parsed = JSON.parse(rawText) as {
            choices?: Array<{ message?: { audio?: { data?: string } } }>;
          };
          audioBase64 = parsed.choices?.[0]?.message?.audio?.data || "";
        } catch {
          sendJson(res, 502, { error: "TTS 响应解析失败" });
          return;
        }

        if (!audioBase64) {
          sendJson(res, 502, { error: "TTS 响应中未找到音频数据" });
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", ttsFormatToMime(body.format));
        res.end(Buffer.from(audioBase64, "base64"));
        return;
      }

      let speechEndpoint = body.endpoint.trim();
      if (!speechEndpoint.endsWith("/audio/speech")) {
        speechEndpoint = speechEndpoint.replace(/\/chat\/completions$/, "/audio/speech");
        if (!speechEndpoint.endsWith("/audio/speech")) {
          speechEndpoint = `${speechEndpoint.replace(/\/+$/, "")}/audio/speech`;
        }
      }

      const upstream = await fetch(speechEndpoint, {
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
}
