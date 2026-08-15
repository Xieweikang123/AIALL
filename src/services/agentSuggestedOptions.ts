import { Channel } from "@tauri-apps/api/core";
import type { AiOption } from "../utils/parseAiOptions";
import { streamChatHttp } from "./aiClient";
import { isTauriEnv, tauriInvoke } from "./tauriInvoke";

const SUGGESTED_OPTIONS_FIRST_BYTE_MS = 60_000;
const MAX_SUGGESTED_OPTIONS = 4;

export interface ExtractSuggestedOptionsParams {
  endpoint: string;
  apiKey?: string;
  model: string;
  assistantText: string;
}

export function buildSuggestedOptionsPrompt(assistantText: string): string {
  return [
    "你是编程 AI 助手的「回复选项提取器」。用户的诉求：AI 助手回复末尾若在向用户提出一个需要用户选择或确认的问题，就提取出用户可能点击回复的选项按钮。",
    "",
    "判断标准：",
    "- 选择题：用户可以直接用「是/否」或从有限几个选项作答（如「要我继续吗？」「你选哪种方案？」）。",
    "- 不是选择题：开放问题（问事实、原因、方式、性质，如「这是什么？」「为什么？」「怎么改？」），或不是问句的陈述。",
    "",
    "只输出一行合法 JSON，不要 markdown 围栏或解释：",
    '{"isChoice": true, "options": ["选项1完整句子", "选项2完整句子"]}',
    '或 {"isChoice": false, "options": []}',
    "",
    "要求：",
    "- options 每项必须是可直接作为用户下一条消息发送的完整句子；",
    "- 第一项通常是默认接受的回答（如「好，按你说的做」）；",
    "- 选项 2~4 个，不要多余，不要重复；",
    "- 若回复正文已列出编号选项，直接对应生成同等数量的选项。",
    "",
    "待分析的回复文本：",
    assistantText,
  ].join("\n");
}

export function parseSuggestedOptionsResponse(text: string): AiOption[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
    const candidate = fence ? fence[1].trim() : trimmed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      parsed = JSON.parse(candidate.slice(start, end + 1));
    }
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.isChoice !== true) return [];

  const raw = record.options;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const options: AiOption[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const label = item.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    options.push({ index: options.length, label, fullText: label, showIndex: false });
    if (options.length >= MAX_SUGGESTED_OPTIONS) break;
  }
  return options.length >= 2 ? options : [];
}

async function streamOnce(params: {
  endpoint: string;
  apiKey?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
}): Promise<{ ok: boolean; content?: string; error?: string }> {
  const body = {
    model: params.model,
    messages: params.messages,
    stream: true,
    temperature: 0,
  };

  if (isTauriEnv()) {
    return new Promise((resolve) => {
      let firstByteReceived = false;
      const timer = setTimeout(() => {
        resolve({ ok: false, error: `选项提取请求超时（${SUGGESTED_OPTIONS_FIRST_BYTE_MS / 1000}s）` });
      }, SUGGESTED_OPTIONS_FIRST_BYTE_MS);

      const channel = new Channel<string>();
      channel.onmessage = () => {
        if (!firstByteReceived) {
          firstByteReceived = true;
          clearTimeout(timer);
        }
      };

      tauriInvoke<{ ok: boolean; status?: number; rawText?: string; error?: string }>(
        "ai_test_stream",
        {
          endpoint: params.endpoint,
          apiKey: params.apiKey || null,
          body,
          onChunk: channel,
        },
      )
        .then((result) => {
          clearTimeout(timer);
          if (!result.ok) {
            resolve({ ok: false, error: result.error || "选项提取失败" });
            return;
          }
          const content = result.rawText?.trim();
          resolve(content ? { ok: true, content } : { ok: false, error: "模型返回为空" });
        })
        .catch((error) => {
          clearTimeout(timer);
          const message = error instanceof Error ? error.message : String(error);
          resolve({ ok: false, error: message });
        });
    });
  }

  // Web（服务器）模式：走 /backend/ai/test（服务端注入 key）。
  const result = await streamChatHttp({
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    model: params.model,
    messages: params.messages,
  });
  return { ok: result.ok, content: result.rawText, error: result.error };
}

/**
 * 让 AI 判断一段助手回复末尾是否为选择题，并提取可点击选项。
 * 返回 null 表示提取失败（不标记）；[] 表示判定为非选择题；其余为选项按钮。
 */
export async function extractSuggestedOptions(
  params: ExtractSuggestedOptionsParams,
): Promise<AiOption[] | null> {
  const text = params.assistantText.trim();
  if (!text) return null;

  const messages = [
    { role: "system", content: "你是严格的 JSON 输出器，只输出一行合法 JSON。" },
    { role: "user", content: buildSuggestedOptionsPrompt(text) },
  ];

  const result = await streamOnce({
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    model: params.model,
    messages,
  });
  if (!result.ok || !result.content) return null;
  return parseSuggestedOptionsResponse(result.content);
}
