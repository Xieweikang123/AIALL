import { backendUrl } from "./backendBase";

export interface PageScreenshotRequest {
  url: string;
  proxyUrl?: string;
  /** 默认 true：弹出 Chromium，便于登录 */
  headed?: boolean;
  /** 首屏加载后额外等待毫秒（登录窗口） */
  waitAfterGotoMs?: number;
  navigationTimeoutMs?: number;
}

export type PageScreenshotResult =
  | { ok: true; dataUrl: string; byteLength: number; mime: string }
  | { ok: false; error: string };

export async function requestPageScreenshot(req: PageScreenshotRequest): Promise<PageScreenshotResult> {
  try {
    const response = await fetch(backendUrl("/backend/web/screenshot-page"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: req.url,
        proxyUrl: req.proxyUrl,
        headed: req.headed,
        waitAfterGotoMs: req.waitAfterGotoMs ?? 0,
        navigationTimeoutMs: req.navigationTimeoutMs ?? 90_000,
      }),
    });

    const rawText = await response.text();
    let parsed: {
      ok?: boolean;
      error?: string;
      mime?: string;
      base64?: string;
      byteLength?: number;
    };
    try {
      parsed = JSON.parse(rawText) as typeof parsed;
    } catch {
      return { ok: false, error: rawText.slice(0, 500) || "响应不是 JSON" };
    }

    if (!response.ok) {
      return { ok: false, error: parsed?.error || `HTTP ${response.status}` };
    }

    if (!parsed.ok || !parsed.base64) {
      return { ok: false, error: parsed?.error || "截图失败" };
    }

    const mime = parsed.mime || "image/jpeg";
    const dataUrl = `data:${mime};base64,${parsed.base64}`;
    return {
      ok: true,
      dataUrl,
      byteLength: typeof parsed.byteLength === "number" ? parsed.byteLength : 0,
      mime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知网络错误";
    return { ok: false, error: message };
  }
}
