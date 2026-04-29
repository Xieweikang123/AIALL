export interface ClaudeCliCheckResult {
  ok: boolean;
  version?: string;
  error?: string;
  detail?: string;
}

export interface ClaudeRunRequest {
  prompt: string;
  cwd?: string;
  bare?: boolean;
  model?: string;
  maxTurns?: number;
  allowedTools?: string;
  permissionMode?: string;
}

export type ClaudeSseEvent =
  | { type: "status"; data: { phase: string; [k: string]: unknown } }
  | { type: "stderr"; data: { text: string } }
  | { type: "claude"; data: { stream: "stdout"; raw: string; parsed?: unknown } }
  | { type: "git_status"; data: { files: Array<{ status: string; file: string }>; at: number } }
  | { type: "unknown"; data: unknown };

export async function checkClaudeCli(): Promise<ClaudeCliCheckResult> {
  const res = await fetch("/backend/claude/check", { method: "GET" });
  const rawText = await res.text();
  try {
    return JSON.parse(rawText) as ClaudeCliCheckResult;
  } catch {
    return { ok: false, error: "解析检查结果失败", detail: rawText };
  }
}

function safeJsonParse(input: string): unknown | undefined {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
}

export function runClaudeCodeSse(
  request: ClaudeRunRequest,
  onEvent: (event: ClaudeSseEvent) => void,
) {
  const controller = new AbortController();

  (async () => {
    const response = await fetch("/backend/claude/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      onEvent({
        type: "status",
        data: { phase: "http_error", status: response.status, text },
      });
      return;
    }

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

      if (type === "status") onEvent({ type: "status", data: (parsed || {}) as any });
      else if (type === "stderr") onEvent({ type: "stderr", data: (parsed || {}) as any });
      else if (type === "claude") onEvent({ type: "claude", data: (parsed || {}) as any });
      else if (type === "git_status") onEvent({ type: "git_status", data: (parsed || {}) as any });
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
          continue;
        }
      }
    }

    pending += decoder.decode();
    if (pending.trim()) {
      // SSE 末尾可能没有空行，尽量兜底一次。
      currentDataLines.push(pending.trim());
      flush();
    }
  })().catch((error) => {
    if (controller.signal.aborted) return;
    const message = error instanceof Error ? error.message : "未知错误";
    onEvent({ type: "status", data: { phase: "client_error", message } });
  });

  return {
    abort: () => controller.abort(),
  };
}

