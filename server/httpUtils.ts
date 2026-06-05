import type { IncomingMessage, ServerResponse } from "node:http";

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
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
