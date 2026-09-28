import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_PROMPT_PRESETS,
  PROMPT_PRESETS_STORAGE_KEY,
  readPromptPresets,
  sanitizePromptPresets,
  writePromptPresets,
} from "./promptPresetsStorage";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

describe("promptPresetsStorage", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    vi.restoreAllMocks();
    store = installLocalStorageMock();
  });

  it("returns built-in defaults when nothing was ever written", () => {
    const list = readPromptPresets();
    expect(list.length).toBe(DEFAULT_PROMPT_PRESETS.length);
    expect(list[0].name).toBe(DEFAULT_PROMPT_PRESETS[0].name);
  });

  it("keeps an empty stored list instead of falling back to defaults", () => {
    writePromptPresets([]);
    expect(readPromptPresets()).toEqual([]);
    expect(store.get(PROMPT_PRESETS_STORAGE_KEY)).toBe("[]");
  });

  it("round-trips user presets", () => {
    writePromptPresets([{ id: "a", name: "解释", content: "请解释" }]);
    expect(readPromptPresets()).toEqual([{ id: "a", name: "解释", content: "请解释" }]);
  });

  it("drops malformed entries and repairs missing/duplicate ids", () => {
    store.set(
      PROMPT_PRESETS_STORAGE_KEY,
      JSON.stringify([
        null,
        42,
        { name: "  ", content: "   " },
        { name: "无 id", content: "x" },
        { id: "dup", name: "一", content: "a" },
        { id: "dup", name: "二", content: "b" },
      ]),
    );
    const list = readPromptPresets();
    expect(list.map((p) => p.name)).toEqual(["无 id", "一", "二"]);
    expect(list[0].id).toBeTruthy();
    expect(new Set(list.map((p) => p.id)).size).toBe(3);
  });

  it("returns [] for non-array garbage", () => {
    store.set(PROMPT_PRESETS_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(readPromptPresets()).toEqual([]);
    expect(sanitizePromptPresets("oops")).toEqual([]);
  });

  it("does not leak the built-in default objects (mutation safety)", () => {
    const first = readPromptPresets();
    first[0].name = "被改坏了";
    expect(readPromptPresets()[0].name).toBe(DEFAULT_PROMPT_PRESETS[0].name);
  });
});
