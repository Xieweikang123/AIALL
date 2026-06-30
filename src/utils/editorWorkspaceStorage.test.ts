import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  editorWorkspaceStorageKey,
  readEditorWorkspace,
  removeEditorWorkspace,
  writeEditorWorkspace,
} from "./editorWorkspaceStorage";

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

describe("editorWorkspaceStorage", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("round-trips workspace per project", () => {
    const project = "D:/project/demo";
    writeEditorWorkspace(project, {
      tabs: [{ path: "D:/project/demo/src/a.ts" }, { path: "D:/project/demo/src/b.ts", dirty: true, content: "draft" }],
      activePath: "D:/project/demo/src/b.ts",
    });

    expect(readEditorWorkspace(project)).toEqual({
      tabs: [
        { path: "D:/project/demo/src/a.ts" },
        { path: "D:/project/demo/src/b.ts", dirty: true, content: "draft" },
      ],
      activePath: "D:/project/demo/src/b.ts",
    });
  });

  it("removes storage when tabs are empty", () => {
    const project = "D:/project/demo";
    writeEditorWorkspace(project, {
      tabs: [{ path: "D:/project/demo/src/a.ts" }],
      activePath: "D:/project/demo/src/a.ts",
    });
    writeEditorWorkspace(project, { tabs: [], activePath: "" });
    expect(readEditorWorkspace(project)).toBeNull();
    expect(localStorage.getItem(editorWorkspaceStorageKey(project))).toBeNull();
  });

  it("isolates projects by normalized path", () => {
    writeEditorWorkspace("D:\\project\\demo\\", {
      tabs: [{ path: "D:/project/demo/a.ts" }],
      activePath: "D:/project/demo/a.ts",
    });
    writeEditorWorkspace("D:/project/other", {
      tabs: [{ path: "D:/project/other/x.ts" }],
      activePath: "D:/project/other/x.ts",
    });

    expect(readEditorWorkspace("d:/project/demo")?.activePath).toBe("D:/project/demo/a.ts");
    expect(readEditorWorkspace("D:/project/other")?.activePath).toBe("D:/project/other/x.ts");
    removeEditorWorkspace("D:/project/demo");
    expect(readEditorWorkspace("D:/project/other")?.activePath).toBe("D:/project/other/x.ts");
  });
});
