import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_JSON_BODY_MAX_BYTES = 48 * 1024 * 1024;

export function readJsonBody(req: IncomingMessage, maxBytes = DEFAULT_JSON_BODY_MAX_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`请求体超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

type FlushableResponse = ServerResponse & { flush?: () => void };

/** Push SSE headers and first bytes to the client immediately (avoid proxy/socket buffering). */
export function flushSseResponse(res: ServerResponse) {
  const flushable = res as FlushableResponse;
  if (typeof flushable.flush === "function") {
    flushable.flush();
  }
  const socket = res.socket;
  if (socket && typeof socket.setNoDelay === "function") {
    socket.setNoDelay(true);
  }
  if (socket && typeof socket.uncork === "function") {
    socket.uncork();
  }
}

export function sendSseHeaders(res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  flushSseResponse(res);
}

export function sendSseEvent(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  flushSseResponse(res);
}

export function sendSseComment(res: ServerResponse, comment = "keepalive") {
  res.write(`: ${comment}\n\n`);
  flushSseResponse(res);
}

export function corsMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  next();
}
