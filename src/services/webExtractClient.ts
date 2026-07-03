import { backendUrl } from "./backendBase";
import { isTauriEnv, tauriInvoke } from "./tauriInvoke";

export interface WebExtractRequest {
  url: string;
  mode?: "auto" | "discourse_latest" | "html" | "browser";
  limit?: number;
  proxyUrl?: string;
  /** 为 true 时走 SSE 流（通常与 onProgress 一起用） */
  stream?: boolean;
  /** 若提供，则启用 stream 并在每条进度回调中更新 UI */
  onProgress?: (message: string) => void;
}

export interface WebExtractResult {
  ok: boolean;
  status: number;
  kind?: "discourse_latest" | "html" | "browser";
  title?: string;
  text?: string;
  rawText?: string;
  error?: string;
}

/** 解析 /backend/web/extract 的 SSE（progress + result） */
async function readExtractSse(
  response: Response,
  onProgress: (message: string) => void,
): Promise<WebExtractResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, status: 0, error: "无法读取响应流" };
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      const dataStr = dataLines.join("\n");
      if (!dataStr) continue;

      try {
        const payload = JSON.parse(dataStr) as {
          message?: string;
          httpStatus?: number;
          body?: Record<string, unknown>;
        };

        if (eventName === "progress" && typeof payload.message === "string") {
          onProgress(payload.message);
        }

        if (eventName === "result") {
          const httpStatus = typeof payload.httpStatus === "number" ? payload.httpStatus : 200;
          const body = payload.body ?? {};
          if (typeof body.ok === "boolean") {
            const r = body as unknown as WebExtractResult;
            return {
              ...r,
              status: r.status ?? httpStatus,
            };
          }
          const errOnly = body as { error?: string };
          if (typeof errOnly.error === "string") {
            return {
              ok: false,
              status: httpStatus,
              error: errOnly.error,
              rawText: typeof body.rawText === "string" ? body.rawText : undefined,
            };
          }
          return {
            ok: false,
            status: httpStatus,
            error: `HTTP ${httpStatus}`,
          };
        }
      } catch {
        // 跳过损坏的分片
      }
    }

    if (done) break;
  }

  return { ok: false, status: 0, error: "流结束但未收到结果（result）" };
}

export async function extractWebText(
  request: WebExtractRequest & { onProgress?: (message: string) => void },
): Promise<WebExtractResult> {
  const { onProgress, stream: _stream, ...rest } = request;

  if (onProgress && isTauriEnv()) {
    onProgress("正在抓取网页…");
    try {
      const result = await tauriInvoke<{
        ok: boolean;
        status?: number;
        kind?: string;
        mode?: string;
        title?: string;
        text?: string;
        content?: string;
        rawText?: string;
        error?: string;
      }>(
        "web_extract",
        { url: rest.url, mode: rest.mode || null, limit: rest.limit || null, proxyUrl: rest.proxyUrl || null },
      );
      onProgress(result.ok ? "抓取完成。" : "抓取失败。");
      if (!result.ok) {
        return {
          ok: false,
          status: result.status ?? 0,
          error: result.error || "抓取失败",
          rawText: result.rawText,
        };
      }
      const kind = (result.kind || result.mode || "html") as WebExtractResult["kind"];
      const text = result.text ?? result.content;
      return {
        ok: true,
        status: result.status ?? 200,
        kind,
        title: result.title,
        text,
        rawText: result.rawText ?? text,
      };
    } catch (e: any) {
      return { ok: false, status: 0, error: e?.message || String(e) };
    }
  }

  if (onProgress) {
    try {
      const response = await fetch(backendUrl("/backend/web/extract"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ ...rest, stream: true }),
      });

      if (!response.ok) {
        const rawText = await response.text();
        let parsed: { error?: string } | undefined;
        try {
          parsed = JSON.parse(rawText) as { error?: string };
        } catch {
          parsed = undefined;
        }
        return {
          ok: false,
          status: response.status,
          rawText,
          error: parsed?.error || `抓取失败，HTTP ${response.status}`,
        };
      }

      return await readExtractSse(response, onProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知网络错误";
      return { ok: false, status: 0, error: message };
    }
  }

  // Tauri: invoke Rust web_extract (auto / html / browser / discourse_latest)
  if (isTauriEnv()) {
    try {
      const result = await tauriInvoke<{
        ok: boolean;
        status?: number;
        kind?: string;
        mode?: string;
        title?: string;
        text?: string;
        content?: string;
        rawText?: string;
        error?: string;
      }>(
        "web_extract",
        { url: rest.url, mode: rest.mode || null, limit: rest.limit || null, proxyUrl: rest.proxyUrl || null },
      );
      if (!result.ok) {
        return {
          ok: false,
          status: result.status ?? 0,
          error: result.error || "抓取失败",
          rawText: result.rawText,
        };
      }
      const kind = (result.kind || result.mode || "html") as WebExtractResult["kind"];
      const text = result.text ?? result.content;
      return {
        ok: true,
        status: result.status ?? 200,
        kind,
        title: result.title,
        text,
        rawText: result.rawText ?? text,
      };
    } catch (e: any) {
      return { ok: false, status: 0, error: e?.message || String(e) };
    }
  }

  try {
    const response = await fetch(backendUrl("/backend/web/extract"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest),
    });

    const rawText = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        rawText,
        error: (parsed && (parsed.error as string)) || `抓取失败，HTTP ${response.status}`,
      };
    }

    if (parsed && typeof parsed === "object" && typeof parsed.ok === "boolean") {
      return parsed as WebExtractResult;
    }

    return {
      ok: true,
      status: response.status,
      kind: "html",
      text: rawText,
      rawText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    return { ok: false, status: 0, error: message };
  }
}
