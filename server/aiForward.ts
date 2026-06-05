export function resolveChatEndpoint(endpoint: string): string {
  const input = endpoint.trim();
  if (!input) return input;
  if (input.endsWith("/chat/completions")) return input;
  if (input.endsWith("/completions")) return input.replace(/\/completions$/, "/chat/completions");
  if (input.endsWith("/audio/speech")) return input.replace(/\/audio\/speech$/, "/chat/completions");
  return `${input.replace(/\/+$/, "")}/chat/completions`;
}

export function buildHeaders(apiKey?: string): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export function formatAiHttpError(status: number, rawText: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string }; message?: string };
    detail = String(parsed.error?.message || parsed.message || "").trim();
  } catch {
    const trimmed = rawText.trim();
    if (trimmed) detail = trimmed.slice(0, 500);
  }

  const base = detail ? `请求失败，HTTP ${status}：${detail}` : `请求失败，HTTP ${status}`;
  if (status === 401) {
    return `${base}\n鉴权失败：请到「AI 配置」填写正确的 API Key，点击「保存配置」后再试。`;
  }
  if (status === 403) {
    return `${base}\n访问被拒绝：请检查 API Key 权限或模型是否可用。`;
  }
  return base;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatCompletionMessage {
  role: string;
  content?: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionResult {
  ok: boolean;
  status: number;
  message?: ChatCompletionMessage;
  rawText: string;
  error?: string;
}

export async function chatCompletionWithTools(params: {
  endpoint: string;
  apiKey?: string;
  model: string;
  messages: ChatCompletionMessage[];
  tools: unknown[];
}): Promise<ChatCompletionResult> {
  const chatEndpoint = resolveChatEndpoint(params.endpoint);

  const response = await fetch(chatEndpoint, {
    method: "POST",
    headers: buildHeaders(params.apiKey),
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      tools: params.tools,
      tool_choice: "auto",
      stream: false,
    }),
  });

  const rawText = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      rawText,
      error: formatAiHttpError(response.status, rawText),
    };
  }

  try {
    const parsed = JSON.parse(rawText) as {
      choices?: Array<{ message?: ChatCompletionMessage }>;
      error?: { message?: string };
    };
    const message = parsed.choices?.[0]?.message;
    if (!message) {
      return {
        ok: false,
        status: response.status,
        rawText,
        error: parsed.error?.message || "模型返回为空",
      };
    }
    return { ok: true, status: response.status, message, rawText };
  } catch {
    return { ok: false, status: response.status, rawText, error: "解析模型响应失败" };
  }
}
