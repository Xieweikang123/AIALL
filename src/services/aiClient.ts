export interface AiTestRequest {
  endpoint: string;
  model: string;
  prompt: string;
  stream: boolean;
  onStreamChunk?: (chunkText: string) => void;
}

export interface AiTestResult {
  ok: boolean;
  status: number;
  rawText: string;
  parsed?: unknown;
  error?: string;
}

function buildPayload(model: string, prompt: string, stream: boolean) {
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    stream,
  };
}

function parseStreamContentFromLine(line: string): string {
  const cleanLine = line.trim();
  if (!cleanLine.startsWith("data:")) return "";
  const dataPart = cleanLine.slice(5).trim();
  if (!dataPart || dataPart === "[DONE]") return "";

  try {
    const payload = JSON.parse(dataPart) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
    };
    const choice = payload.choices?.[0];
    return choice?.delta?.content || choice?.message?.content || "";
  } catch {
    return "";
  }
}

export async function testAiModel(request: AiTestRequest): Promise<AiTestResult> {
  try {
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload(request.model, request.prompt, request.stream)),
    });

    if (request.stream && response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let pending = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";

        for (const line of lines) {
          const chunkText = parseStreamContentFromLine(line);
          if (chunkText) {
            fullText += chunkText;
            request.onStreamChunk?.(chunkText);
          }
        }
      }

      // 补一次尾部解码，避免最后一个分片遗漏。
      pending += decoder.decode();
      if (pending.trim()) {
        const tailChunk = parseStreamContentFromLine(pending);
        if (tailChunk) {
          fullText += tailChunk;
          request.onStreamChunk?.(tailChunk);
        }
      }

      return {
        ok: true,
        status: response.status,
        rawText: fullText,
      };
    }

    const rawText = await response.text();
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }

    return {
      ok: response.ok,
      status: response.status,
      rawText,
      parsed,
      error: response.ok ? undefined : `请求失败，HTTP ${response.status}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知网络错误";
    const hint =
      "浏览器可能触发跨域限制。开发环境建议使用 /api/v1/chat/completions 代理地址；Tauri 生产环境建议走后端命令代理。";
    return {
      ok: false,
      status: 0,
      rawText: "",
      error: `${errorMessage}\n${hint}`,
    };
  }
}
