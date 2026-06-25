import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { usePanelLayout } from "./usePanelLayout";

function installLocalStorageMock() {
  const storage: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      for (const key of Object.keys(storage)) delete storage[key];
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  });
  return storage;
}

describe("usePanelLayout", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("restores chat collapsed from localStorage on init", () => {
    localStorage.setItem("vibe-coding-chat-collapsed", "1");
    const { chatCollapsed } = usePanelLayout(ref(null));
    expect(chatCollapsed.value).toBe(true);
  });

  it("collapseChat persists folded state", () => {
    const { collapseChat, chatCollapsed } = usePanelLayout(ref(null));
    collapseChat();
    expect(chatCollapsed.value).toBe(true);
    expect(localStorage.getItem("vibe-coding-chat-collapsed")).toBe("1");
  });

  it("collapseEditor does not expand a folded chat panel", () => {
    localStorage.setItem("vibe-coding-chat-collapsed", "1");
    const { collapseEditor, chatCollapsed, editorCollapsed } = usePanelLayout(ref(null));

    expect(chatCollapsed.value).toBe(true);
    collapseEditor();

    expect(chatCollapsed.value).toBe(true);
    expect(localStorage.getItem("vibe-coding-chat-collapsed")).toBe("1");
    expect(editorCollapsed.value).toBe(true);
    expect(localStorage.getItem("vibe-coding-editor-collapsed")).toBe("1");
  });
});
