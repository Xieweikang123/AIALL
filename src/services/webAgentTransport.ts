/**
 * Web/HTTP transport for the headless Agent server (agent-server).
 *
 * Desktop (Tauri) builds use the native Channel invoke; browser mode uses this
 * SSE client against the agent-server binary. See src-tauri/src/bin/agent_server.rs.
 */

import { getAuthHeaders } from "./serverAuth";

export interface WebAgentSseEvent {
  type: string;
  data: Record<string, unknown>;
}

/**
 * POST a run request and stream `data:` events until the stream closes.
 */
export async function runAgentServerSse(
  url: string,
  body: unknown,
  onEvent: (event: WebAgentSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 401) {
      throw new Error("未登录或会话已过期，请先在「AI 配置」页登录服务器");
    }
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  if (!resp.body) {
    throw new Error("响应没有 body");
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)) as WebAgentSseEvent);
          } catch {
            // 忽略无法解析的事件
          }
        }
      }
    }
  }
}
