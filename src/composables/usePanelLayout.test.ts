import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { usePanelLayout } from "./usePanelLayout";
import {
  __resetAgentTraceDrawerForTest,
  openTraceDrawer,
  setTraceMaximized,
} from "../services/agentTraceDrawer";

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
    __resetAgentTraceDrawerForTest();
  });

  it("轨迹面板放大态不占右侧列宽（getChatPanelMaxWidth 预留为 0）", () => {
    // 构造一个足够宽的工作区，让 byEditor 项成为约束、能看出预留差异
    const workspace = { value: { clientWidth: 2000 } } as unknown as { value: HTMLDivElement };
    const { getChatPanelMaxWidth } = usePanelLayout(ref(workspace.value));

    // 未开面板：无预留
    const closed = getChatPanelMaxWidth();

    // 打开为右侧窄列：应预留 AGENT_TRACE_PANEL_WIDTH(420)
    openTraceDrawer("m1", []);
    const asColumn = getChatPanelMaxWidth();
    expect(asColumn).toBeLessThan(closed);

    // 放大占满工作区：不再预留，宽度回到未开面板的水平
    setTraceMaximized(true);
    expect(getChatPanelMaxWidth()).toBe(closed);
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
