/** 与 AiConfigView 使用同一 localStorage 键，读取对话接口配置（供其它页面复用） */

export const AI_LOCAL_CONFIG_KEY = "ai-config";

export const AI_CONFIG_VERSION = 4 as const;

export interface AiProvider {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  stream: boolean;
}

export interface AiChatBaseConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  providerId?: string;
  providerName?: string;
}

export interface AiTtsConfig {
  model: string;
  voice: string;
  input: string;
  format: "mp3" | "wav" | "opus";
}

export interface AiWebConfig {
  proxyUrl: string;
}

export type AiConfigTabKey = "chat" | "tts";

export interface PersistedAiConfig {
  version: typeof AI_CONFIG_VERSION;
  activeProviderId: string;
  providers: AiProvider[];
  activeTab?: AiConfigTabKey;
  web: AiWebConfig;
  tts: AiTtsConfig;
}

const DEFAULT_ENDPOINT = "https://fufu.iqach.top/v1";
const DEFAULT_MODEL = "mimo-v2.5-pro";

const DEFAULT_TTS: AiTtsConfig = {
  model: "mimo-v2.5-tts",
  voice: "mimo_default",
  input: "你好，这是一段 TTS 测试音频。",
  format: "mp3",
};

export function generateProviderId(): string {
  return `p-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createDefaultProvider(name = "默认供应商", overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id: generateProviderId(),
    name,
    endpoint: DEFAULT_ENDPOINT,
    apiKey: "",
    model: DEFAULT_MODEL,
    prompt: "你好",
    stream: true,
    ...overrides,
  };
}

function providerFromLegacyBase(base: {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  prompt?: string;
  stream?: boolean;
}): AiProvider {
  return createDefaultProvider("默认供应商", {
    endpoint: String(base.endpoint || DEFAULT_ENDPOINT).trim(),
    apiKey: String(base.apiKey || ""),
    model: String(base.model || DEFAULT_MODEL).trim(),
    prompt: String(base.prompt || "你好"),
    stream: typeof base.stream === "boolean" ? base.stream : true,
  });
}

function normalizeTts(raw: unknown): AiTtsConfig {
  const tts = (raw && typeof raw === "object" ? raw : {}) as Partial<AiTtsConfig>;
  return {
    model: String(tts.model || DEFAULT_TTS.model),
    voice: String(tts.voice || DEFAULT_TTS.voice),
    input: String(tts.input || DEFAULT_TTS.input),
    format: tts.format === "wav" || tts.format === "opus" ? tts.format : "mp3",
  };
}

function normalizeWeb(raw: unknown): AiWebConfig {
  const web = (raw && typeof raw === "object" ? raw : {}) as Partial<AiWebConfig>;
  return { proxyUrl: String(web.proxyUrl || "") };
}

function normalizeProvider(raw: unknown, index: number): AiProvider | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<AiProvider>;
  const id = String(p.id || "").trim() || generateProviderId();
  const name = String(p.name || "").trim() || `供应商 ${index + 1}`;
  return {
    id,
    name,
    endpoint: String(p.endpoint || DEFAULT_ENDPOINT).trim(),
    apiKey: String(p.apiKey || ""),
    model: String(p.model || DEFAULT_MODEL).trim(),
    prompt: String(p.prompt || "你好"),
    stream: typeof p.stream === "boolean" ? p.stream : true,
  };
}

/** 将任意历史 JSON 规范为 v4 结构（纯函数，便于测试） */
export function migratePersistedAiConfig(parsed: unknown): PersistedAiConfig {
  if (!parsed || typeof parsed !== "object") {
    const provider = createDefaultProvider();
    return {
      version: AI_CONFIG_VERSION,
      activeProviderId: provider.id,
      providers: [provider],
      web: { proxyUrl: "" },
      tts: { ...DEFAULT_TTS },
    };
  }

  const payload = parsed as Record<string, unknown>;
  const version = Number(payload.version) || 0;

  if (version >= AI_CONFIG_VERSION && Array.isArray(payload.providers)) {
    const providers = payload.providers
      .map((item, index) => normalizeProvider(item, index))
      .filter((item): item is AiProvider => Boolean(item));
    const fallback = createDefaultProvider();
    const resolvedProviders = providers.length ? providers : [fallback];
    const activeId = String(payload.activeProviderId || "").trim();
    const activeProviderId = resolvedProviders.some((p) => p.id === activeId)
      ? activeId
      : resolvedProviders[0].id;
    const activeTab = payload.activeTab === "tts" ? "tts" : payload.activeTab === "chat" ? "chat" : undefined;
    return {
      version: AI_CONFIG_VERSION,
      activeProviderId,
      providers: resolvedProviders,
      activeTab,
      web: normalizeWeb(payload.web),
      tts: normalizeTts(payload.tts),
    };
  }

  // v2/v3：单供应商 base 字段
  if ((version === 2 || version === 3) && payload.base && typeof payload.base === "object") {
    const provider = providerFromLegacyBase(payload.base as Record<string, unknown>);
    return {
      version: AI_CONFIG_VERSION,
      activeProviderId: provider.id,
      providers: [provider],
      activeTab: payload.activeTab === "tts" ? "tts" : payload.activeTab === "chat" ? "chat" : undefined,
      web: normalizeWeb(payload.web),
      tts: normalizeTts(payload.tts),
    };
  }

  // 更早期：扁平 endpoint/apiKey/model
  const legacy = payload as {
    endpoint?: string;
    apiKey?: string;
    model?: string;
    prompt?: string;
    stream?: boolean;
  };
  const provider = providerFromLegacyBase(legacy);
  return {
    version: AI_CONFIG_VERSION,
    activeProviderId: provider.id,
    providers: [provider],
    web: normalizeWeb(payload.web),
    tts: normalizeTts(payload.tts),
  };
}

export function parsePersistedAiConfig(raw: string): PersistedAiConfig | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return migratePersistedAiConfig(parsed);
  } catch {
    return null;
  }
}

export function getActiveProvider(config: PersistedAiConfig): AiProvider | null {
  if (!config.providers.length) return null;
  return config.providers.find((p) => p.id === config.activeProviderId) ?? config.providers[0];
}

export function providerToChatBase(provider: AiProvider): AiChatBaseConfig {
  return {
    endpoint: provider.endpoint.trim(),
    apiKey: provider.apiKey,
    model: provider.model.trim(),
    providerId: provider.id,
    providerName: provider.name.trim(),
  };
}

export function loadPersistedAiConfigFromStorage(): PersistedAiConfig | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(AI_LOCAL_CONFIG_KEY);
  if (!raw) return null;
  return parsePersistedAiConfig(raw);
}

export function savePersistedAiConfigToStorage(config: PersistedAiConfig): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AI_LOCAL_CONFIG_KEY, JSON.stringify(config));
}

export function loadAiChatBaseFromStorage(): AiChatBaseConfig | null {
  const config = loadPersistedAiConfigFromStorage();
  if (!config) return null;
  const provider = getActiveProvider(config);
  if (!provider) return null;
  const base = providerToChatBase(provider);
  if (!base.endpoint && !base.model) return null;
  return base;
}

/** 规范化网页抓取代理地址（允许省略 http://） */
export function normalizeWebProxyUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (/^https?:$/.test(url.protocol)) return url.toString();
  } catch {
    // 允许省略协议，如 127.0.0.1:7890
  }
  try {
    const url = new URL(`http://${trimmed}`);
    if (url.hostname) return url.toString();
  } catch {
    return "";
  }
  return "";
}

export function loadWebProxyUrlFromStorage(): string {
  const config = loadPersistedAiConfigFromStorage();
  if (!config?.web?.proxyUrl) return "";
  return normalizeWebProxyUrl(config.web.proxyUrl);
}
