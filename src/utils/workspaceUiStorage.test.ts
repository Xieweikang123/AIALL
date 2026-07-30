import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readWorkspaceUi,
  removeWorkspaceUi,
  workspaceUiStorageKey,
  writeWorkspaceUi,
} from "./workspaceUiStorage";

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

describe("workspaceUiStorage", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("round-trips workspace UI per project", () => {
    const project = "D:/project/demo";
    writeWorkspaceUi(project, {
      expandedDirs: ["D:/project/demo", "D:/project/demo/src"],
      chatScrollTop: 120,
      chatPinnedToBottom: false,
      git: {
        logOpen: true,
        selectedFiles: ["src/a.ts"],
        untrackedOpen: false,
      },
      planPanelInForeground: true,
      quickSearchOpen: false,
    });

    expect(readWorkspaceUi(project)).toEqual({
      version: 1,
      expandedDirs: ["D:/project/demo", "D:/project/demo/src"],
      chatScrollTop: 120,
      chatPinnedToBottom: false,
      git: {
        logOpen: true,
        selectedFiles: ["src/a.ts"],
        untrackedOpen: false,
      },
      planPanelInForeground: true,
      quickSearchOpen: false,
    });
  });

  it("isolates projects by normalized path", () => {
    writeWorkspaceUi("D:\\project\\demo\\", {
      git: { logOpen: true },
    });
    writeWorkspaceUi("D:/project/other", {
      git: { stagedOpen: false },
    });

    expect(readWorkspaceUi("d:/project/demo")?.git?.logOpen).toBe(true);
    expect(readWorkspaceUi("D:/project/other")?.git?.stagedOpen).toBe(false);
    removeWorkspaceUi("D:/project/demo");
    expect(readWorkspaceUi("D:/project/other")?.git?.stagedOpen).toBe(false);
  });
});
