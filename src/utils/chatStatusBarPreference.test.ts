import { describe, it, expect, beforeEach } from "vitest";
import {
  CHAT_STATUS_BAR_STORAGE_KEY,
  CHAT_STATUS_METRICS,
  DEFAULT_CHAT_STATUS_METRICS,
  loadChatStatusMetrics,
  sanitizeChatStatusMetrics,
  saveChatStatusMetrics,
} from "./chatStatusBarPreference";

function createStore() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  return map;
}

describe("chatStatusBarPreference", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = createStore();
  });

  it("默认包含上下文占用", () => {
    expect([...DEFAULT_CHAT_STATUS_METRICS]).toEqual(["context"]);
    expect(loadChatStatusMetrics()).toEqual(["context"]);
  });

  it("清洗：丢弃未知项、去重、保持顺序", () => {
    expect(sanitizeChatStatusMetrics(["speed", "nope", "speed", "context"])).toEqual([
      "speed",
      "context",
    ]);
  });

  it("非数组输入回落到默认值", () => {
    expect(sanitizeChatStatusMetrics("speed")).toEqual(["context"]);
    expect(sanitizeChatStatusMetrics(null)).toEqual(["context"]);
  });

  it("存档损坏时回落到默认值", () => {
    store.set(CHAT_STATUS_BAR_STORAGE_KEY, "{not json");
    expect(loadChatStatusMetrics()).toEqual(["context"]);
  });

  it("保存后能读回，且过滤未知项", () => {
    saveChatStatusMetrics(["speed", "cache", "bogus" as never]);
    expect(loadChatStatusMetrics()).toEqual(["speed", "cache"]);
  });

  it("保存空列表 = 用户主动关闭所有指标（不回落默认）", () => {
    saveChatStatusMetrics([]);
    expect(loadChatStatusMetrics()).toEqual([]);
  });

  it("所有内置指标 id 都是合法项", () => {
    const ids = CHAT_STATUS_METRICS.map((m) => m.id);
    expect(sanitizeChatStatusMetrics(ids)).toEqual(ids);
  });
});
