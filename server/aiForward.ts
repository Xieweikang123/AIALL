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

function parseStreamToolCalls(
  toolCallsMap: Map<number, { id: string; name: string; arguments: string }>,
  deltaToolCalls: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
) {
  for (const tc of deltaToolCalls) {
    const idx = tc.index ?? 0;
    if (!toolCallsMap.has(idx)) {
      toolCallsMap.set(idx, { id: "", name: "", arguments: "" });
    }
    const acc = toolCallsMap.get(idx)!;
    if (tc.id) acc.id = tc.id;
    if (tc.function?.name) acc.name = tc.function.name;
    if (tc.function?.arguments) acc.arguments += tc.function.arguments;
  }
}

function buildMessageFromStream(
  content: string,
  toolCallsMap: Map<number, { id: string; name: string; arguments: string }>,
): ChatCompletionMessage {
  const toolCalls = [...toolCallsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }))
    .filter((tc) => tc.id && tc.function.name);

  return {
    role: "assistant",
    content: content || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

export async function chatCompletionWithTools(params: {
  endpoint: string;
  apiKey?: string;
  model: string;
  messages: ChatCompletionMessage[];
  tools: unknown[];
  signal?: AbortSignal;
  onContentDelta?: (delta: string) => void;
}): Promise<ChatCompletionResult> {
  const chatEndpoint = resolveChatEndpoint(params.endpoint);
  const useStream = Boolean(params.onContentDelta);

  const requestBody: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: useStream,
  };
  if (params.tools.length > 0) {
    requestBody.tools = params.tools;
    requestBody.tool_choice = "auto";
  }

  const response = await fetch(chatEndpoint, {
    method: "POST",
    headers: buildHeaders(params.apiKey),
    signal: params.signal,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const rawText = await response.text();
    return {
      ok: false,
      status: response.status,
      rawText,
      error: formatAiHttpError(response.status, rawText),
    };
  }

  if (!useStream) {
    const rawText = await response.text();
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

  if (!response.body) {
    return { ok: false, status: response.status, rawText: "", error: "模型响应体为空" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string | null;
          }>;
          error?: { message?: string };
        };

        if (parsed.error?.message) {
          return {
            ok: false,
            status: response.status,
            rawText: "",
            error: parsed.error.message,
          };
        }

        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          params.onContentDelta?.(delta.content);
        }
        if (delta?.tool_calls?.length) {
          parseStreamToolCalls(toolCallsMap, delta.tool_calls);
        }
      } catch {
        // skip malformed SSE chunk
      }
    }
  }

  const message = buildMessageFromStream(content, toolCallsMap);
  if (!message.content && !message.tool_calls?.length) {
    return { ok: false, status: response.status, rawText: "", error: "模型返回为空" };
  }

  return { ok: true, status: response.status, message, rawText: "" };
}
