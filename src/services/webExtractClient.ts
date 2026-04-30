export interface WebExtractRequest {
  url: string;
  mode?: "auto" | "discourse_latest" | "html";
  limit?: number;
  proxyUrl?: string;
}

export interface WebExtractResult {
  ok: boolean;
  status: number;
  kind?: "discourse_latest" | "html";
  title?: string;
  text?: string;
  rawText?: string;
  error?: string;
}

export async function extractWebText(request: WebExtractRequest): Promise<WebExtractResult> {
  try {
    const response = await fetch("/backend/web/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
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

