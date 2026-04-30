/** 与 AiConfigView 使用同一 localStorage 键，读取对话接口配置（供其它页面复用） */

export const AI_LOCAL_CONFIG_KEY = "ai-config";

export interface AiChatBaseConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export function loadAiChatBaseFromStorage(): AiChatBaseConfig | null {
  const raw = localStorage.getItem(AI_LOCAL_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      base?: { endpoint?: string; apiKey?: string; model?: string };
      endpoint?: string;
      apiKey?: string;
      model?: string;
    };
    if ((parsed.version === 3 || parsed.version === 2) && parsed.base) {
      return {
        endpoint: String(parsed.base.endpoint || "").trim(),
        apiKey: String(parsed.base.apiKey || ""),
        model: String(parsed.base.model || "").trim(),
      };
    }
    return {
      endpoint: String(parsed.endpoint || "").trim(),
      apiKey: String(parsed.apiKey || ""),
      model: String(parsed.model || "").trim(),
    };
  } catch {
    return null;
  }
}
