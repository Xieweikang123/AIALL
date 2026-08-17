import { describe, expect, it } from "vitest";
import {
  PROVIDER_PRESETS,
  getActiveProvider,
  migratePersistedAiConfig,
  normalizeWebProxyUrl,
  parsePersistedAiConfig,
  providerToChatBase,
} from "./aiLocalConfig";

describe("migratePersistedAiConfig", () => {
  it("migrates legacy flat config to v4 with one provider", () => {
    const config = migratePersistedAiConfig({
      endpoint: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-4",
      prompt: "hi",
      stream: false,
    });

    expect(config.version).toBe(4);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].endpoint).toBe("https://api.example.com/v1");
    expect(config.providers[0].apiKey).toBe("sk-test");
    expect(config.providers[0].model).toBe("gpt-4");
    expect(config.providers[0].prompt).toBe("hi");
    expect(config.providers[0].stream).toBe(false);
    expect(config.activeProviderId).toBe(config.providers[0].id);
  });

  it("migrates v3 base config and preserves web/tts", () => {
    const config = migratePersistedAiConfig({
      version: 3,
      activeTab: "tts",
      base: {
        endpoint: "https://old.example/v1",
        apiKey: "key-old",
        model: "mimo-v2.5-pro",
        prompt: "test",
        stream: true,
      },
      web: { proxyUrl: "http://127.0.0.1:7890" },
      tts: { model: "tts-model", voice: "default_en", input: "read", format: "wav" },
    });

    expect(config.version).toBe(4);
    expect(config.activeTab).toBe("tts");
    expect(config.web.proxyUrl).toBe("http://127.0.0.1:7890");
    expect(config.tts.model).toBe("tts-model");
    expect(config.tts.format).toBe("wav");
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].name).toBe("默认供应商");
    expect(config.providers[0].endpoint).toBe("https://old.example/v1");
  });

  it("keeps v4 multi-provider config and resolves invalid active id", () => {
    const config = migratePersistedAiConfig({
      version: 4,
      activeProviderId: "missing",
      providers: [
        { id: "a", name: "OpenAI", endpoint: "https://a/v1", apiKey: "", model: "gpt-4", prompt: "", stream: true },
        { id: "b", name: "Local", endpoint: "http://localhost/v1", apiKey: "k", model: "llama", prompt: "", stream: false },
      ],
      web: { proxyUrl: "" },
      tts: { model: "mimo-v2.5-tts", voice: "mimo_default", input: "", format: "mp3" },
    });

    expect(config.activeProviderId).toBe("a");
    expect(config.providers).toHaveLength(2);
  });
});

describe("active provider resolution", () => {
  it("returns active provider chat base", () => {
    const config = migratePersistedAiConfig({
      version: 4,
      activeProviderId: "b",
      providers: [
        { id: "a", name: "A", endpoint: "https://a/v1", apiKey: "", model: "m1", prompt: "", stream: true },
        { id: "b", name: "B", endpoint: "https://b/v1", apiKey: "secret", model: "m2", prompt: "", stream: true },
      ],
      web: { proxyUrl: "" },
      tts: { model: "mimo-v2.5-tts", voice: "mimo_default", input: "", format: "mp3" },
    });

    const active = getActiveProvider(config);
    expect(active?.id).toBe("b");
    expect(providerToChatBase(active!)).toEqual({
      endpoint: "https://b/v1",
      apiKey: "secret",
      model: "m2",
      providerId: "b",
      providerName: "B",
    });
  });

  it("parses JSON string via parsePersistedAiConfig", () => {
    const raw = JSON.stringify({
      version: 3,
      base: { endpoint: "https://x/v1", apiKey: "", model: "m", prompt: "p", stream: true },
      web: { proxyUrl: "" },
      tts: { model: "t", voice: "v", input: "i", format: "mp3" },
    });
    const config = parsePersistedAiConfig(raw);
    expect(config?.version).toBe(4);
    expect(config?.providers[0].endpoint).toBe("https://x/v1");
  });

  it("normalizes web proxy URL with optional scheme", () => {
    expect(normalizeWebProxyUrl("http://127.0.0.1:7890")).toBe("http://127.0.0.1:7890/");
    expect(normalizeWebProxyUrl("127.0.0.1:10809")).toBe("http://127.0.0.1:10809/");
    expect(normalizeWebProxyUrl("  ")).toBe("");
  });
});

describe("PROVIDER_PRESETS", () => {
  it("每条预设都有非空 name/endpoint/model", () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThan(0);
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.name.trim()).toBeTruthy();
      expect(preset.endpoint.trim()).toBeTruthy();
      expect(preset.model.trim()).toBeTruthy();
    }
  });

  it("预设名称不重复", () => {
    const names = PROVIDER_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
