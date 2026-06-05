import { backendUrl } from "./backendBase";

const DEV_SIDECAR_ORIGIN = "http://127.0.0.1:37891";

/** Agent SSE must not go through Vite's dev proxy (it buffers until the response ends). */
function agentRunUrl(): string {
  const envBase = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");
  if (envBase) return `${envBase}/backend/vibe/agent/run`;
  if (import.meta.env.DEV) return `${DEV_SIDECAR_ORIGIN}/backend/vibe/agent/run`;
  return backendUrl("/backend/vibe/agent/run");
}

export interface VibeAgentRunRequest {
  prompt: string;
  projectPath: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  maxTurns?: number;
  openFilePath?: string;
}

export type VibeAgentSseEvent =
  | {
      type: "status";
      data: {
        phase: string;
        turn?: number;
        maxTurns?: number;
        openFile?: string;
        model?: string;
      };
    }
  | { type: "tool_start"; data: { id: string; name: string; args: Record<string, unknown> } }
  | { type: "tool_end"; data: { id: string; name: string; ok: boolean; summary: string } }
  | { type: "message"; data: { text: string } }
  | { type: "message_delta"; data: { delta: string } }
  | { type: "error"; data: { message: string } }
  | { type: "done"; data: { writtenFiles: string[]; turns: number } }
  | { type: "unknown"; data: unknown };

function safeJsonParse(input: string): unknown | undefined {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
}

export function runVibeAgentSse(request: VibeAgentRunRequest, onEvent: (event: VibeAgentSseEvent) => void) {
  const controller = new AbortController();
  let doneReceived = false;

  (async () => {
    onEvent({ type: "status", data: { phase: "connecting_local" } });

    const response = await fetch(agentRunUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      onEvent({
        type: "error",
        data: { message: text || `Agent 请求失败，HTTP ${response.status}` },
      });
      return;
    }

    onEvent({ type: "status", data: { phase: "stream_connected" } });

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let pending = "";
    let currentEvent = "message";
    let currentDataLines: string[] = [];

    const flush = () => {
      if (!currentDataLines.length) return;
      const dataStr = currentDataLines.join("\n");
      const parsed = safeJsonParse(dataStr);
      const type = currentEvent || "message";

      if (type === "status") onEvent({ type: "status", data: (parsed || {}) as VibeAgentSseEvent extends { type: "status"; data: infer D } ? D : never });
      else if (type === "tool_start") onEvent({ type: "tool_start", data: (parsed || {}) as any });
      else if (type === "tool_end") onEvent({ type: "tool_end", data: (parsed || {}) as any });
      else if (type === "message") onEvent({ type: "message", data: (parsed || {}) as any });
      else if (type === "message_delta") onEvent({ type: "message_delta", data: (parsed || {}) as any });
      else if (type === "error") onEvent({ type: "error", data: (parsed || {}) as any });
      else if (type === "done") {
        doneReceived = true;
        onEvent({ type: "done", data: (parsed || {}) as any });
      }
      else onEvent({ type: "unknown", data: parsed ?? dataStr });

      currentEvent = "message";
      currentDataLines = [];
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) {
          flush();
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          currentDataLines.push(line.slice(5).trimStart());
        }
      }
    }

    pending += decoder.decode();
    if (pending.trim()) {
      currentDataLines.push(pending.trim());
      flush();
    }
  })()
    .then(() => {
      if (!controller.signal.aborted && !doneReceived) {
        onEvent({ type: "done", data: { writtenFiles: [], turns: 0 } });
      }
    })
    .catch((error) => {
      if (controller.signal.aborted) {
        if (!doneReceived) {
          onEvent({ type: "status", data: { phase: "aborted" } });
          onEvent({ type: "done", data: { writtenFiles: [], turns: 0 } });
        }
        return;
      }
      const message = error instanceof Error ? error.message : "未知错误";
      onEvent({ type: "error", data: { message } });
      if (!doneReceived) {
        onEvent({ type: "done", data: { writtenFiles: [], turns: 0 } });
      }
    });

  return {
    abort: () => controller.abort(),
  };
}
