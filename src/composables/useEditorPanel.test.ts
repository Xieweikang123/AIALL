import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { ref, type Ref } from "vue";

// ── global stubs ────────────────────────────────────────────
beforeAll(() => {
  vi.stubGlobal("window", { setTimeout: vi.fn(), clearTimeout: vi.fn() });
});

// ── hoisted mocks ──────────────────────────────────────────
const readFileMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const renameItemMock = vi.hoisted(() => vi.fn());
const readEditorWorkspaceMock = vi.hoisted(() => vi.fn());
const writeEditorWorkspaceMock = vi.hoisted(() => vi.fn());
const fetchGitDiffContentMock = vi.hoisted(() => vi.fn());
const fetchGitCommitFileDiffMock = vi.hoisted(() => vi.fn());

vi.mock("../services/vibeCodingClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/vibeCodingClient")>();
  return {
    ...actual,
    readFile: readFileMock,
    writeFile: writeFileMock,
    renameItem: renameItemMock,
  };
});

vi.mock("../services/vibeGitClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/vibeGitClient")>();
  return {
    ...actual,
    fetchGitDiffContent: fetchGitDiffContentMock,
    fetchGitCommitFileDiff: fetchGitCommitFileDiffMock,
  };
});

vi.mock("../utils/editorWorkspaceStorage", () => ({
  readEditorWorkspace: readEditorWorkspaceMock,
  writeEditorWorkspace: writeEditorWorkspaceMock,
}));

// ── helpers ─────────────────────────────────────────────────
const PROJECT_PATH = "D:/project/demo";

function makeParams(overrides?: Partial<ReturnType<typeof makeDefaultParams>>) {
  const defaults = makeDefaultParams();
  return { ...defaults, ...overrides };
}

function makeDefaultParams() {
  const confirm = vi.fn();
  const confirmUnsaved = vi.fn();
  const inputPrompt = { prompt: vi.fn() };
  const composerRef = ref(null);
  const gitError = ref("");
  const gitDiffContentCache = ref<Record<string, { before: string; after: string }>>({});
  const gitDiffLoadingKey = ref("");
  const treeError = ref("");

  return {
    projectPath: ref(PROJECT_PATH) as Ref<string>,
    projectOpened: ref(true) as Ref<boolean>,
    aiConfig: ref({ endpoint: "", apiKey: "", model: "", providerName: "" }),
    configReady: ref(true) as Ref<boolean>,
    confirm,
    confirmUnsaved,
    inputPrompt,
    composerRef,
    gitError,
    gitDiffContentCache,
    gitDiffLoadingKey,
    evictOldestCacheEntry: vi.fn(),
    gitHistoryDiffKey: (hash: string, path: string, oldPath?: string) =>
      `history:${hash}:${oldPath || ""}:${path}`,
    gitWorkingTreeDiffKey: (path: string, staged?: boolean) =>
      `${staged ? "staged" : "unstaged"}:${path}`,
    treeError,
    collapseEditor: vi.fn(),
    expandEditor: vi.fn(),
    autoRetryWithCountdown: <T>(fn: () => Promise<T>) => fn(),
  };
}

// ── tests ───────────────────────────────────────────────────
describe("useEditorPanel — 异步缺口修复", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockResolvedValue({ ok: true, content: "file content" });
    writeFileMock.mockResolvedValue({ ok: true });
    renameItemMock.mockResolvedValue({ ok: true });
  });

  // ─── 1. openFile: 新文件时序 ──────────────────────────
  describe("openFile (新文件)", () => {
    it("应该在 await readFile 前就把标签加入 openTabs 并设 activeFilePath", async () => {
      // 让 readFile 保持 pending，检查中间状态
      let resolveRead!: (v: unknown) => void;
      readFileMock.mockImplementation(() => new Promise((r) => { resolveRead = r; }));

      const params = makeParams();
      const { openFile, openTabs, activeFilePath, fileContent } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      const openPromise = openFile(`${PROJECT_PATH}/src/a.ts`);

      // 在微任务回调中检查：readFile 还在 pending，但状态已提前就绪
      await vi.waitFor(() => {
        expect(activeFilePath.value).toBe(`${PROJECT_PATH}/src/a.ts`);
        expect(openTabs.value.some((t) => t.path === `${PROJECT_PATH}/src/a.ts`)).toBe(true);
        expect(fileContent.value).toBe(""); // 已清空旧内容
      });

      resolveRead!({ ok: true, content: "hello world" });
      await openPromise;

      expect(fileContent.value).toBe("hello world");
      const tab = openTabs.value.find((t) => t.path === `${PROJECT_PATH}/src/a.ts`);
      expect(tab?.content).toBe("hello world");
    });

    it("readFile 失败时不应残留旧文件内容", async () => {
      readFileMock.mockResolvedValue({ ok: false, error: "读取失败" });

      const params = makeParams();
      const { openFile, activeFilePath, fileContent, fileLoadError } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      // 先打开一个文件填充内容
      readFileMock.mockResolvedValueOnce({ ok: true, content: "old content" });
      await openFile(`${PROJECT_PATH}/src/a.ts`);
      expect(fileContent.value).toBe("old content");

      // 再打开一个不存在的文件
      readFileMock.mockResolvedValueOnce({ ok: false, error: "file not found" });
      await openFile(`${PROJECT_PATH}/src/bad.ts`);

      // 失败后 fileContent 应为空字符串而非 "old content"
      expect(fileContent.value).toBe("");
      expect(fileLoadError.value).toBe("file not found");
    });

    it("已有缓存的标签走快速路径，不经过 readFile", async () => {
      const params = makeParams();
      const { openFile, openTabs, activeFilePath } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      // 先打开新文件
      await openFile(`${PROJECT_PATH}/src/a.ts`);
      expect(openTabs.value).toHaveLength(1);

      // 再次打开同一文件应走缓存分支
      readFileMock.mockClear();
      await openFile(`${PROJECT_PATH}/src/a.ts`);
      expect(activeFilePath.value).toBe(`${PROJECT_PATH}/src/a.ts`);
      expect(readFileMock).not.toHaveBeenCalled();
    });

    it("打开文件后 selectedTreePath 应同步为文件路径", async () => {
      const params = makeParams();
      const { openFile, selectedTreePath } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      await openFile(`${PROJECT_PATH}/src/a.ts`);
      expect(selectedTreePath.value).toBe(`${PROJECT_PATH}/src/a.ts`);

      await openFile(`${PROJECT_PATH}/src/b.ts`);
      expect(selectedTreePath.value).toBe(`${PROJECT_PATH}/src/b.ts`);
    });

    it("打开已缓存标签后 selectedTreePath 仍应同步（快速路径）", async () => {
      const params = makeParams();
      const { openFile, selectedTreePath } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      await openFile(`${PROJECT_PATH}/src/a.ts`);
      await openFile(`${PROJECT_PATH}/src/b.ts`);
      // 回到已打开的 a
      await openFile(`${PROJECT_PATH}/src/a.ts`);
      expect(selectedTreePath.value).toBe(`${PROJECT_PATH}/src/a.ts`);
    });

    it("selectTreeItem 后紧跟 openFile（文件树点击事件）selectedTreePath 应为新文件", async () => {
      const params = makeParams();
      const { openFile, selectTreeItem, selectedTreePath } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      // 模拟 FileTreeNode onFileTap: 先 emit select 再 emit open
      selectTreeItem(`${PROJECT_PATH}/src/b.ts`);
      await openFile(`${PROJECT_PATH}/src/b.ts`);
      expect(selectedTreePath.value).toBe(`${PROJECT_PATH}/src/b.ts`);
    });
  });

  // ─── 2. handleUnsavedTabChoice: 保存顺序 ──────────────
  describe("handleUnsavedTabChoice (保存分支)", () => {
    it("选择保存时，应该先 syncActiveTabToCache + saveFile 再切换 UI", async () => {
      let saveResolve!: (v: unknown) => void;
      writeFileMock.mockImplementation(() => new Promise((r) => { saveResolve = r; }));

      const confirmUnsaved = vi.fn().mockResolvedValue("save");
      const params = makeParams({ confirmUnsaved });
      const { openFile, activeFilePath, fileContent, fileDirty } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      // 先打开文件 A 并修改
      await openFile(`${PROJECT_PATH}/src/a.ts`);
      fileContent.value = "modified a content";
      fileDirty.value = true;

      // 再打开文件 B → 触发 handleUnsavedTabChoice("a.ts", "switch")
      readFileMock.mockResolvedValueOnce({ ok: true, content: "b content" });
      const openBPromise = openFile(`${PROJECT_PATH}/src/b.ts`);

      // 在 waitFor 中检查：saveFile 还在 pending，UI 应仍显示文件 A 的内容
      await vi.waitFor(() => {
        expect(activeFilePath.value).toBe(`${PROJECT_PATH}/src/a.ts`);
        expect(fileContent.value).toBe("modified a content");
      });

      saveResolve!({ ok: true });
      await openBPromise;

      // 保存完成后才切换到文件 B
      expect(activeFilePath.value).toBe(`${PROJECT_PATH}/src/b.ts`);
      expect(fileContent.value).toBe("b content");
    });

    it("选择放弃时不应调用 saveFile", async () => {
      const confirmUnsaved = vi.fn().mockResolvedValue("discard");
      const params = makeParams({ confirmUnsaved });
      const { openFile, activeFilePath, fileContent, fileDirty } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      await openFile(`${PROJECT_PATH}/src/a.ts`);
      fileContent.value = "modified";
      fileDirty.value = true;

      readFileMock.mockResolvedValueOnce({ ok: true, content: "b content" });
      await openFile(`${PROJECT_PATH}/src/b.ts`);

      expect(writeFileMock).not.toHaveBeenCalled();
      expect(activeFilePath.value).toBe(`${PROJECT_PATH}/src/b.ts`);
    });

    it("取消时应保持原状态不变", async () => {
      const confirmUnsaved = vi.fn().mockResolvedValue("cancel");
      const params = makeParams({ confirmUnsaved });
      const { openFile, activeFilePath, fileContent, fileDirty } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      await openFile(`${PROJECT_PATH}/src/a.ts`);
      fileContent.value = "modified";
      fileDirty.value = true;

      readFileMock.mockResolvedValueOnce({ ok: true, content: "b content" });
      await openFile(`${PROJECT_PATH}/src/b.ts`);

      // 取消后应仍留在原标签
      expect(activeFilePath.value).toBe(`${PROJECT_PATH}/src/a.ts`);
      expect(fileContent.value).toBe("modified");
      expect(fileDirty.value).toBe(true);
    });
  });

  // ─── 3. commitRename: 成功后才清除 renamingPath ─────
  describe("commitRename", () => {
    it("重命名成功后才清除 renamingPath", async () => {
      const params = makeParams();
      const { commitRename, renamingPath } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      renamingPath.value = `${PROJECT_PATH}/src/old.ts`;

      await commitRename(`${PROJECT_PATH}/src/old.ts`, "new.ts");

      expect(renameItemMock).toHaveBeenCalledWith(
        `${PROJECT_PATH}/src/old.ts`,
        `${PROJECT_PATH}/src/new.ts`,
      );
      expect(renamingPath.value).toBe("");
    });

    it("重命名失败时应保留 renamingPath", async () => {
      renameItemMock.mockResolvedValue({ ok: false, error: "rename failed" });

      const params = makeParams();
      const { commitRename, renamingPath } =
        (await import("./useEditorPanel")).useEditorPanel(params);

      renamingPath.value = `${PROJECT_PATH}/src/old.ts`;

      await commitRename(`${PROJECT_PATH}/src/old.ts`, "new.ts");

      // 失败后 renamingPath 不应被清除（让用户重新编辑）
      expect(renamingPath.value).toBe(`${PROJECT_PATH}/src/old.ts`);
      expect((params.treeError as Ref<string>).value).toBe("rename failed");
    });
  });

  // ─── 4. reorderTabs: 标签拖拽排序 ─────────────────────
  describe("reorderTabs", () => {
    const a = `${PROJECT_PATH}/src/a.ts`;
    const b = `${PROJECT_PATH}/src/b.ts`;
    const c = `${PROJECT_PATH}/src/c.ts`;
    const d = `${PROJECT_PATH}/src/d.ts`;

    async function makeEditorWithTabs() {
      readFileMock.mockResolvedValue({ ok: true, content: "content" });
      const editor = (await import("./useEditorPanel")).useEditorPanel(makeParams());
      await editor.openFile(a);
      await editor.openFile(b);
      await editor.openFile(c);
      await editor.openFile(d);
      return editor;
    }

    it("将标签从索引 0 移到索引 2（移到索引 2 的标签之前）", async () => {
      const { openTabs, reorderTabs } = await makeEditorWithTabs();
      expect(openTabs.value.map((t) => t.path)).toEqual([a, b, c, d]);

      reorderTabs(0, 2); // 将 a 移到 c 之前

      // a(idx0) removed→[b,c,d]; fromIndex<toIndex adj 2→1; splice(1,0,a)→[b,a,c,d]
      expect(openTabs.value.map((t) => t.path)).toEqual([b, a, c, d]);
    });

    it("将标签从索引 3 移到索引 0（移到开头）", async () => {
      const { openTabs, reorderTabs } = await makeEditorWithTabs();
      // 将 d(idx3) 移到 a 之前
      reorderTabs(3, 0);

      // d(idx3) removed→[a,b,c]; fromIndex>toIndex adj→0; splice(0,0,d)→[d,a,b,c]
      expect(openTabs.value.map((t) => t.path)).toEqual([d, a, b, c]);
    });

    it("将标签从索引 0 移到末尾（toIndex = length）", async () => {
      const { openTabs, reorderTabs } = await makeEditorWithTabs();
      // 将 a 追加到末尾
      reorderTabs(0, 4);

      // a(idx0) removed→[b,c,d]; adj 4-1=3; splice(3,0,a)→[b,c,d,a]
      expect(openTabs.value.map((t) => t.path)).toEqual([b, c, d, a]);
    });

    it("相同索引时不做任何操作", async () => {
      const { openTabs, reorderTabs } = await makeEditorWithTabs();
      const before = openTabs.value.map((t) => t.path);

      reorderTabs(1, 1);

      expect(openTabs.value.map((t) => t.path)).toEqual(before);
    });

    it("超出边界的索引不报错", async () => {
      const { openTabs, reorderTabs } = await makeEditorWithTabs();
      const before = openTabs.value.map((t) => t.path);

      reorderTabs(-1, 2);
      expect(openTabs.value.map((t) => t.path)).toEqual(before);

      reorderTabs(0, 999);
      expect(openTabs.value.map((t) => t.path)).toEqual(before);
    });

    it("将标签从索引 2 移到索引 1（移到索引 1 的标签之前）", async () => {
      const { openTabs, reorderTabs } = await makeEditorWithTabs();
      // 将 c(idx2) 移到 b(idx1) 之前 → [a,c,b,d]
      reorderTabs(2, 1);

      // c(idx2) removed→[a,b,d]; fromIndex>toIndex adj→1; splice(1,0,c)→[a,c,b,d]
      expect(openTabs.value.map((t) => t.path)).toEqual([a, c, b, d]);
    });

    it("活跃标签路径不应因排序而改变", async () => {
      const { openTabs, activeFilePath, reorderTabs } = await makeEditorWithTabs();
      expect(activeFilePath.value).toBe(d);

      reorderTabs(0, 3); // 将 a 移到 d 之前

      expect(activeFilePath.value).toBe(d);
      expect(openTabs.value.map((t) => t.path)).toHaveLength(4);
    });
  });
});
