/**
 * 从标准 OpenAI 风格 /chat/completions 的 JSON 正文中取出 assistant 文本。
 */
export function extractAssistantTextFromChatResponseJson(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText) as {
      choices?: Array<{
        message?: { content?: string | null };
        delta?: { content?: string | null };
        text?: string;
      }>;
    };
    const c = parsed.choices?.[0];
    const text = c?.message?.content ?? c?.delta?.content ?? c?.text;
    if (text == null) return "";
    return String(text).trim();
  } catch {
    return "";
  }
}

/**
 * 从模型返回中尽量抠出第一个 JSON 对象并 parse（允许外层有说明或 ```json 围栏）。
 */
export function parseJsonObjectFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  const candidate = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    }
    throw new Error("无法从模型输出中解析 JSON");
  }
}
