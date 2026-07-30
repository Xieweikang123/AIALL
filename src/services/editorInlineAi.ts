import { testAiModel } from "./aiClient";

export interface EditorInlineAiRequest {
  endpoint: string;
  apiKey?: string;
  model: string;
  filePath: string;
  language: string;
  selectedText: string;
  fullContent: string;
  instruction: string;
  onStreamChunk?: (chunk: string) => void;
}

export interface EditorInlineAiResult {
  ok: boolean;
  replacement?: string;
  error?: string;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fenceMatch) return fenceMatch[1].trimEnd();
  return trimmed;
}

function buildInlineAiPrompt(params: EditorInlineAiRequest): string {
  const selectionBlock = params.selectedText.trim()
    ? `\n\n选区内容：\n\`\`\`${params.language}\n${params.selectedText}\n\`\`\``
    : "\n\n（无选区，请在光标处插入或改写附近代码）";
  return [
    "你是代码编辑助手。根据用户指令修改代码。",
    "只输出替换后的代码片段本身，不要解释，不要 markdown 围栏，除非代码本身需要。",
    `文件：${params.filePath}`,
    `语言：${params.language}`,
    selectionBlock,
    `\n用户指令：${params.instruction.trim()}`,
  ].join("\n");
}

export async function runEditorInlineAi(params: EditorInlineAiRequest): Promise<EditorInlineAiResult> {
  const prompt = buildInlineAiPrompt(params);
  const result = await testAiModel({
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    model: params.model,
    prompt,
    stream: Boolean(params.onStreamChunk),
    onStreamChunk: params.onStreamChunk,
  });
  if (!result.ok) {
    return { ok: false, error: result.error || "AI 请求失败" };
  }
  const replacement = stripCodeFence(result.rawText || "");
  if (!replacement.trim()) {
    return { ok: false, error: "AI 未返回有效代码" };
  }
  return { ok: true, replacement };
}
