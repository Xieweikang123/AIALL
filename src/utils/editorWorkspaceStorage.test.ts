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

  it("drops volatile git content/diff but keeps the git reference", () => {
    const project = "D:/project/big";
    writeEditorWorkspace(project, {
      tabs: [
        {
          path: "D:/project/big/src/a.ts",
          kind: "git-change",
          content: "整份文件正文".repeat(1000),
          diff: { before: "a".repeat(5000), after: "整份文件正文".repeat(1000) },
          readOnly: true,
          git: { filePath: "src/a.ts" },
        },
      ],
      activePath: "D:/project/big/src/a.ts",
    });

    const raw = JSON.parse(localStorage.getItem(editorWorkspaceStorageKey(project))!);
    // 未超预算时保留内容，但绝不写入体积最大的 diff；超预算才彻底剥离。
    expect(raw.tabs[0].diff).toBeUndefined();
    expect(raw.tabs[0].git).toEqual({ filePath: "src/a.ts" });
    expect(raw.tabs[0].readOnly).toBe(true);
  });

  it("strips all volatile content once the workspace exceeds the byte budget", () => {
    const project = "D:/project/huge";
    writeEditorWorkspace(project, {
      tabs: [
        { path: "D:/project/huge/src/a.ts", kind: "file", dirty: true, content: "x".repeat(700 * 1024) },
        { path: "D:/project/huge/src/b.ts", kind: "file", dirty: true, content: "y".repeat(700 * 1024) },
      ],
      activePath: "D:/project/huge/src/a.ts",
    });

    const raw = JSON.parse(localStorage.getItem(editorWorkspaceStorageKey(project))!);
    expect(raw.tabs).toHaveLength(2);
    expect(raw.tabs.every((tab: { content?: string }) => tab.content === undefined)).toBe(true);
    expect(raw.tabs.map((tab: { path: string }) => tab.path)).toEqual([
      "D:/project/huge/src/a.ts",
      "D:/project/huge/src/b.ts",
    ]);
  });

  it("falls back to metadata-only when quota rejects the full write", () => {
    const project = "D:/project/quota";
    const storage = installLocalStorageMock();
    vi.stubGlobal("localStorage", {
      ...((globalThis as unknown as { localStorage: object }).localStorage as object),
      setItem: (key: string, value: string) => {
        if (value.includes('"content"')) {
          const err = new Error("exceeded the quota");
          err.name = "QuotaExceededError";
          throw err;
        }
        storage[key] = value;
      },
    });

    writeEditorWorkspace(project, {
      tabs: [{ path: "D:/project/quota/src/a.ts", kind: "scratch", dirty: true, content: "draft text" }],
      activePath: "D:/project/quota/src/a.ts",
    });

    const raw = JSON.parse(localStorage.getItem(editorWorkspaceStorageKey(project))!);
    expect(raw.tabs).toHaveLength(1);
    expect(raw.tabs[0]).toMatchObject({ path: "D:/project/quota/src/a.ts", kind: "scratch" });
    expect(raw.tabs[0].content).toBeUndefined();
  });
});
