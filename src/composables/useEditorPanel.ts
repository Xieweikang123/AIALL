import { computed, nextTick, ref, unref, watch, type Ref } from "vue";
import { type TreeNode } from "../components/FileTreeNode.vue";
import EditorPanel from "../components/vibe/EditorPanel.vue";
import {
  readFile,
  writeFile,
  createItem,
  deleteItem,
  renameItem,
  listDirectory,
  searchFiles,
  grepContent,
  formatFetchError,
  type FileEntry,
} from "../services/vibeCodingClient";
import {
  fetchGitDiffContent,
  fetchGitCommitFileDiff,
  type GitLogEntry,
  type GitLogFile,
} from "../services/vibeGitClient";
import type { EditorTabKind } from "../utils/vibeHelpers";
import {
  UNTITLED_SCHEME,
  isScratchPath,
  scratchDisplayName,
} from "../utils/vibeHelpers";
import { readEditorWorkspace, writeEditorWorkspace, type PersistedEditorTab } from "../utils/editorWorkspaceStorage";

type FileDiff = {
  before: string;
  after: string;
  deleted?: boolean;
  created?: boolean;
};

type OpenTab = {
  path: string;
  content: string;
  dirty: boolean;
  kind: EditorTabKind;
};

type MonacoNavHandle = {
  getScrollTop?: () => number;
  setScrollTop?: (v: number) => void;
  getPosition?: () => { lineNumber: number; column: number } | null;
  setPosition?: (v: { lineNumber: number; column: number }) => void;
};

function resolveMonacoNavHandle(editorPanelRef?: Ref<InstanceType<typeof EditorPanel> | null>): MonacoNavHandle | null {
  const raw = unref(editorPanelRef?.value?.editorRef);
  return raw && typeof raw === "object" ? (raw as MonacoNavHandle) : null;
}

export interface UseEditorPanelParams {
  projectPath: Ref<string>;
  projectOpened: Ref<boolean>;
  aiConfig: Ref<{ endpoint: string; apiKey: string; model: string; providerName: string }>;
  configReady: Ref<boolean>;
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>;
  confirmUnsaved: (
    fileName: string,
    context: "switch" | "close" | "project",
    event?: MouseEvent,
  ) => Promise<"save" | "discard" | "cancel">;
  inputPrompt: { prompt: (msg: string, options?: { defaultValue?: string }) => Promise<string | null> };
  composerRef: Ref<{ setPlainText: (text: string) => void; focus: () => void } | null>;
  editorPanelRef?: Ref<InstanceType<typeof EditorPanel> | null>;
  gitError: Ref<string>;
  gitDiffContentCache: Ref<Record<string, FileDiff>>;
  gitDiffLoadingKey: Ref<string>;
  evictOldestCacheEntry: () => void;
  gitHistoryDiffKey: (hash: string, filePath: string, oldPath?: string) => string;
  gitWorkingTreeDiffKey: (filePath: string, staged?: boolean) => string;
  treeError: Ref<string>;
  collapseEditor: () => void;
  expandEditor: () => void;
  autoRetryWithCountdown: <T>(fn: () => Promise<T>, options?: { onRetry?: (remaining: number, attempt: number, maxRetries: number) => void }) => Promise<T>;
  gitActiveRepoPath?: Ref<string>;
}

export function useEditorPanel(params: UseEditorPanelParams) {
  const {
    projectPath,
    projectOpened,
    confirm,
    confirmUnsaved,
    inputPrompt,
    composerRef,
    editorPanelRef,
    gitError,
    gitDiffContentCache,
    gitDiffLoadingKey,
    evictOldestCacheEntry,
    gitHistoryDiffKey,
    gitWorkingTreeDiffKey,
    treeError,
    collapseEditor,
    expandEditor,
    autoRetryWithCountdown,
    gitActiveRepoPath,
  } = params;

  const fileTree = ref<TreeNode[]>([]);
  const expandedDirs = ref<Set<string>>(new Set());
  const openTabs = ref<OpenTab[]>([]);
  const activeFilePath = ref("");
  const selectedTreePath = ref("");
  const fileContent = ref("");
  const fileDirty = ref(false);
  const fileLoadError = ref("");
  const fileDiffs = ref<Record<string, FileDiff>>({});
  const readOnlyFileKeys = ref<Set<string>>(new Set());
  const showDiffMode = ref(false);
  const renamingPath = ref("");
  let scratchSeq = 0;

  /* ---- 导航历史（浏览器式后退/前进） ---- */
  interface NavEntry {
    path: string;
    scrollTop?: number;
    cursorLine?: number;
    cursorColumn?: number;
  }
  const navBackStack = ref<NavEntry[]>([]);
  const navForwardStack = ref<NavEntry[]>([]);
  const canGoBack = computed(() => navBackStack.value.length > 0);
  const canGoForward = computed(() => navForwardStack.value.length > 0);
  let navSuppressNext = false; // 内部导航跳转时抑制记录

  function snapshotCurrentNavEntry(): NavEntry | null {
    if (!activeFilePath.value) return null;
    const entry: NavEntry = { path: activeFilePath.value };
    // 尝试获取编辑器滚动位置和光标
    try {
      const monacoEditor = resolveMonacoNavHandle(editorPanelRef);
      if (monacoEditor?.getScrollTop) entry.scrollTop = monacoEditor.getScrollTop();
      if (monacoEditor?.getPosition) {
        const pos = monacoEditor.getPosition();
        if (pos) {
          entry.cursorLine = pos.lineNumber;
          entry.cursorColumn = pos.column;
        }
      }
    } catch { /* ignore */ }
    return entry;
  }

  function recordNavEntry() {
    if (navSuppressNext) { navSuppressNext = false; return; }
    const entry = snapshotCurrentNavEntry();
    if (entry) {
      navBackStack.value = [...navBackStack.value, entry];
      navForwardStack.value = []; // 新导航清空前进栈
    }
  }

  async function navigateBack() {
    if (!canGoBack.value) return;
    const current = snapshotCurrentNavEntry();
    const prev = navBackStack.value[navBackStack.value.length - 1];
    navBackStack.value = navBackStack.value.slice(0, -1);
    if (current) navForwardStack.value = [...navForwardStack.value, current];
    navSuppressNext = true;
    await openFile(prev.path, { skipUnsavedCheck: true });
    // 恢复滚动和光标
    try {
      const monacoEditor = resolveMonacoNavHandle(editorPanelRef);
      if (monacoEditor) {
        if (prev.scrollTop != null && monacoEditor.setScrollTop) monacoEditor.setScrollTop(prev.scrollTop);
        if (prev.cursorLine != null && monacoEditor.setPosition) monacoEditor.setPosition({ lineNumber: prev.cursorLine, column: prev.cursorColumn || 1 });
      }
    } catch { /* ignore */ }
  }

  async function navigateForward() {
    if (!canGoForward.value) return;
    const current = snapshotCurrentNavEntry();
    const next = navForwardStack.value[navForwardStack.value.length - 1];
    navForwardStack.value = navForwardStack.value.slice(0, -1);
    if (current) navBackStack.value = [...navBackStack.value, current];
    navSuppressNext = true;
    await openFile(next.path, { skipUnsavedCheck: true });
    try {
      const monacoEditor = resolveMonacoNavHandle(editorPanelRef);
      if (monacoEditor) {
        if (next.scrollTop != null && monacoEditor.setScrollTop) monacoEditor.setScrollTop(next.scrollTop);
        if (next.cursorLine != null && monacoEditor.setPosition) monacoEditor.setPosition({ lineNumber: next.cursorLine, column: next.cursorColumn || 1 });
      }
    } catch { /* ignore */ }
  }

  let diffAbortController: AbortController | null = null;

  function normalizePathKey(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase();
  }

  function joinProjectPath(base: string, relative: string): string {
    const rel = relative.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel) return base;
    if (/^[a-zA-Z]:/.test(rel)) return rel;
    const baseNorm = base.replace(/\\/g, "/").replace(/\/$/, "");
    return `${baseNorm}/${rel}`;
  }

  function findNode(nodes: TreeNode[], targetPath: string): TreeNode | null {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      if (node.children?.length) {
        const found = findNode(node.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  }

  function findNodeByKey(nodes: TreeNode[], key: string): TreeNode | null {
    for (const node of nodes) {
      if (normalizePathKey(node.path) === key) return node;
      if (node.children?.length) {
        const found = findNodeByKey(node.children, key);
        if (found) return found;
      }
    }
    return null;
  }

  function resolveFullPathFromRel(rel: string): string {
    const joined = joinProjectPath(projectPath.value, rel);
    const key = normalizePathKey(joined);
    const node = findNodeByKey(fileTree.value, key);
    return node?.path || joined;
  }

  function entryToNode(entry: FileEntry): TreeNode {
    return { ...entry, children: entry.isDirectory ? [] : undefined, loaded: !entry.isDirectory };
  }

  async function loadDirChildren(dirPath: string): Promise<TreeNode[]> {
    const result = await listDirectory(dirPath);
    if (!result.ok) throw new Error(result.error || "读取目录失败");
    return result.items.map(entryToNode);
  }

  function setFileDiff(path: string, diff: FileDiff) {
    fileDiffs.value = { ...fileDiffs.value, [normalizePathKey(path)]: diff };
  }

  function getFileDiff(path: string): FileDiff | null {
    if (!path) return null;
    return fileDiffs.value[normalizePathKey(path)] || null;
  }

  function syncActiveTabToCache() {
    if (!activeFilePath.value) return;
    const tab = findOpenTab(activeFilePath.value);
    if (!tab) return;
    tab.content = fileContent.value;
    tab.dirty = fileDirty.value;
  }

  async function discardTabChanges(path: string): Promise<boolean> {
    const tab = findOpenTab(path);
    if (!tab || !tab.dirty) return true;
    if (isVirtualSchemePath(path)) {
      tab.dirty = false;
      if (activeFilePath.value === path) fileDirty.value = false;
      return true;
    }
    const result = await readFile(path);
    if (!result.ok) {
      fileLoadError.value = result.error || "读取失败";
      return false;
    }
    tab.content = result.content;
    tab.dirty = false;
    if (activeFilePath.value === path) {
      fileContent.value = result.content;
      fileDirty.value = false;
      fileLoadError.value = "";
    }
    return true;
  }

  async function handleUnsavedTabChoice(
    path: string,
    context: "switch" | "close" | "project",
  ): Promise<boolean> {
    const name = isScratchPath(path) ? scratchDisplayName(path) : fileName(path);
    const choice = await confirmUnsaved(name, context);
    if (choice === "cancel") return false;
    if (choice === "discard") {
      if (isScratchPath(path) && context === "close") return true;
      return discardTabChanges(path);
    }
    // "save" 分支：先保存当前文件，再切换到目标标签
    const switching = activeFilePath.value !== path;
    if (switching) {
      syncActiveTabToCache();
      // 保存非当前页签：先切过去再保存（临时窗口走「另存为」）
      const tab = findOpenTab(path);
      if (!tab) return false;
      const prevPath = activeFilePath.value;
      const prevContent = fileContent.value;
      const prevDirty = fileDirty.value;
      activeFilePath.value = path;
      fileContent.value = tab.content;
      fileDirty.value = tab.dirty;
      const saved = await saveFile();
      if (!saved) {
        activeFilePath.value = prevPath;
        fileContent.value = prevContent;
        fileDirty.value = prevDirty;
        return false;
      }
      return true;
    }
    await saveFile();
    return !fileDirty.value;
  }

  async function ensureCanLeaveCurrentTab(): Promise<boolean> {
    if (!fileDirty.value || !activeFilePath.value) return true;
    return handleUnsavedTabChoice(activeFilePath.value, "switch");
  }

  async function ensureCanLeaveAllOpenTabs(): Promise<boolean> {
    for (const tab of [...openTabs.value]) {
      if (!tab.dirty) continue;
      const ok = await handleUnsavedTabChoice(tab.path, "project");
      if (!ok) return false;
    }
    return true;
  }

  function findOpenTab(path: string): OpenTab | undefined {
    return openTabs.value.find((tab) => tab.path === path);
  }

  function fileName(p: string) {
    const parts = p.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || p;
  }

  function displayFilePath(path: string): string {
    if (!path) return "";
    if (isScratchPath(path)) return scratchDisplayName(path);
    if (path.startsWith("git-index://")) return path.slice("git-index://".length);
    if (path.startsWith("git-history://")) {
      const rest = path.slice("git-history://".length);
      const slash = rest.indexOf("/");
      return slash >= 0 ? rest.slice(slash + 1) : rest;
    }
    return path;
  }

  function isVirtualSchemePath(path: string): boolean {
    return path.startsWith("git-index://") || path.startsWith("git-history://") || isScratchPath(path);
  }

  function gitWorkingTreePreviewPath(filePath: string, staged = false): string {
    if (!staged) {
      const base = gitActiveRepoPath?.value?.trim() || projectPath.value;
      // 已是绝对路径（如多仓总览拼好的）直接返回，避免二次拼接
      if (/^[a-zA-Z]:/.test(filePath.trim()) || filePath.startsWith("/")) {
        const key = normalizePathKey(filePath);
        const node = findNodeByKey(fileTree.value, key);
        return node?.path || filePath;
      }
      return joinProjectPath(base, filePath);
    }
    return `git-index://${filePath}`;
  }

  async function refreshTree() {
    if (!projectOpened.value) return;
    const normalized = projectPath.value.trim();
    if (!normalized) return;
    try {
      fileTree.value = await autoRetryWithCountdown(
        () => loadDirChildren(normalized),
        {
          onRetry: (remaining, attempt, max) => {
            treeError.value = `刷新目录失败，正在重试… ${remaining}s (${attempt}/${max})`;
          },
        },
      );
      treeError.value = "";
    } catch (e) {
      treeError.value = formatFetchError(e, "刷新目录失败");
    }
  }

  function syncEditorPanelForOpenFiles() {
    if (!activeFilePath.value && projectOpened.value) {
      collapseEditor();
    }
  }

  function resolveGitTabKind(path: string, explicit?: EditorTabKind): EditorTabKind {
    if (explicit) return explicit;
    if (path.startsWith("git-history://")) return "git-history";
    if (path.startsWith("git-index://")) return "git-staged";
    return "git-change";
  }

  async function openDiffPreview(
    path: string,
    diff: FileDiff,
    options?: { readOnly?: boolean; tabKind?: EditorTabKind },
  ) {
    if (!(await ensureCanLeaveCurrentTab())) return;
    syncActiveTabToCache();
    if (options?.readOnly) {
      const nextReadOnly = new Set(readOnlyFileKeys.value);
      nextReadOnly.add(normalizePathKey(path));
      readOnlyFileKeys.value = nextReadOnly;
    }
    const tabKind = resolveGitTabKind(path, options?.tabKind);
    expandEditor();
    setFileDiff(path, diff);
    selectedTreePath.value = options?.readOnly ? "" : path;
    activeFilePath.value = path;
    fileContent.value = diff.after;
    fileDirty.value = false;
    fileLoadError.value = "";
    showDiffMode.value = true;

    const cached = findOpenTab(path);
    if (cached) {
      cached.content = diff.after;
      cached.dirty = false;
      cached.kind = tabKind;
    } else {
      openTabs.value.push({ path, content: diff.after, dirty: false, kind: tabKind });
    }
  }

  async function openGitLogFile(entry: GitLogEntry, file: GitLogFile) {
    if (!projectOpened.value) return;
    gitError.value = "";
    const cacheKey = gitHistoryDiffKey(entry.hash, file.path, file.oldPath);
    const cached = gitDiffContentCache.value[cacheKey];
    try {
      let diff = cached;
      if (!diff) {
        gitDiffLoadingKey.value = cacheKey;
        const result = await fetchGitCommitFileDiff(projectPath.value.trim(), entry.hash, file.path, file.oldPath);
        if (!result.ok) {
          gitError.value = result.error || "获取提交文件 diff 失败";
          return;
        }
        diff = { before: result.before, after: result.after, deleted: file.status === "D" };
        gitDiffContentCache.value = { ...gitDiffContentCache.value, [cacheKey]: diff };
        evictOldestCacheEntry();
      }

      const displayPath = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
      const previewPath = `git-history://${entry.shortHash}/${displayPath}`;
      const nextReadOnly = new Set(readOnlyFileKeys.value);
      nextReadOnly.add(normalizePathKey(previewPath));
      readOnlyFileKeys.value = nextReadOnly;
      await openDiffPreview(previewPath, diff, { readOnly: true });
    } catch (e) {
      gitError.value = e instanceof Error ? e.message : "获取提交文件 diff 失败";
    } finally {
      if (gitDiffLoadingKey.value === cacheKey) gitDiffLoadingKey.value = "";
    }
  }

  async function showGitFileDiff(filePath: string, staged = false) {
    // 防御：文件夹路径不应请求 diff
    if (filePath.endsWith('/')) return
    if (!projectOpened.value) return;
    if (diffAbortController) diffAbortController.abort();
    const cacheKey = gitWorkingTreeDiffKey(filePath, staged);
    gitError.value = "";
    const previewPath = gitWorkingTreePreviewPath(filePath, staged);
    const cached = gitDiffContentCache.value[cacheKey];
    try {
      let diff = cached;
      if (!diff) {
        gitDiffLoadingKey.value = cacheKey;
        const controller = new AbortController();
        diffAbortController = controller;
        const effectiveRepo = gitActiveRepoPath?.value?.trim() || projectPath.value.trim();
        const result = await fetchGitDiffContent(effectiveRepo, filePath, staged, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok) {
          if (result.error !== "已取消") gitError.value = result.error || "获取 diff 失败";
          return;
        }
        diff = { before: result.before, after: result.after };
        gitDiffContentCache.value = { ...gitDiffContentCache.value, [cacheKey]: diff };
        evictOldestCacheEntry();
      }
      await openDiffPreview(previewPath, diff, {
        readOnly: staged,
        tabKind: staged ? "git-staged" : "git-change",
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        gitError.value = e instanceof Error ? e.message : "获取 diff 失败";
      }
    } finally {
      diffAbortController = null;
      if (gitDiffLoadingKey.value === cacheKey) gitDiffLoadingKey.value = "";
    }
  }

  async function openFile(filePath: string, options?: { force?: boolean; skipUnsavedCheck?: boolean }) {
    if (!options?.skipUnsavedCheck && activeFilePath.value && activeFilePath.value !== filePath) {
      const canLeave = await ensureCanLeaveCurrentTab();
      if (!canLeave) return;
      syncActiveTabToCache();
    } else {
      syncActiveTabToCache();
    }

    // 记录导航历史（非历史跳转时）
    if (activeFilePath.value && activeFilePath.value !== filePath) {
      recordNavEntry();
    }

    expandEditor();
    showDiffMode.value = false;
    fileLoadError.value = "";
    selectedTreePath.value = isVirtualSchemePath(filePath) ? selectedTreePath.value : filePath;

    const cached = findOpenTab(filePath);
    if (cached && !options?.force) {
      activeFilePath.value = filePath;
      fileContent.value = cached.content;
      fileDirty.value = cached.dirty;
      if (!isVirtualSchemePath(filePath) && cached.kind !== "scratch") {
        cached.kind = "file";
      }
      void revealInTree(filePath);
      return;
    }

    // 对于新文件，先加入 openTabs 占位，确保 DOM 就绪后 activeFilePath 变化
    // 能滚动标签到可视区；内容在 readFile 完成后更新。
    if (!cached) {
      openTabs.value.push({
        path: filePath,
        content: "",
        dirty: false,
        kind: isScratchPath(filePath) ? "scratch" : "file",
      });
    }
    activeFilePath.value = filePath;
    fileContent.value = "";        // 清除旧内容，避免 await 期间残留上一文件
    fileDirty.value = false;
    fileLoadError.value = "";

    if (isVirtualSchemePath(filePath)) {
      fileContent.value = cached?.content || "";
      fileDirty.value = cached?.dirty || false;
      fileLoadError.value = cached || isScratchPath(filePath) ? "" : "预览文件不可直接读取";
      return;
    }

    const result = await readFile(filePath);
    if (!result.ok) {
      fileContent.value = "";
      fileLoadError.value = result.error || "读取失败";
      if (cached) {
        cached.content = "";
        cached.dirty = false;
      }
      return;
    }

    fileContent.value = result.content;
    if (cached) {
      cached.content = result.content;
      cached.dirty = false;
      cached.kind = "file";
    } else {
      const tab = openTabs.value.find((t) => t.path === filePath);
      if (tab) {
        tab.content = result.content;
        tab.dirty = false;
        tab.kind = "file";
      }
    }
    void revealInTree(filePath);
  }

  async function reloadFile() {
    if (!activeFilePath.value) return;
    if (activeFileReadOnly.value) return;
    if (isScratchPath(activeFilePath.value)) return;
    await openFile(activeFilePath.value, { force: true, skipUnsavedCheck: true });
  }

  function nextScratchPath(): string {
    scratchSeq += 1;
    while (findOpenTab(`${UNTITLED_SCHEME}${scratchSeq}`)) {
      scratchSeq += 1;
    }
    return `${UNTITLED_SCHEME}${scratchSeq}`;
  }

  async function openScratchTab() {
    if (!projectOpened.value) return;
    if (activeFilePath.value) {
      const canLeave = await ensureCanLeaveCurrentTab();
      if (!canLeave) return;
      syncActiveTabToCache();
    }

    const path = nextScratchPath();
    expandEditor();
    showDiffMode.value = false;
    fileLoadError.value = "";
    openTabs.value.push({ path, content: "", dirty: false, kind: "scratch" });
    activeFilePath.value = path;
    fileContent.value = "";
    fileDirty.value = false;
    schedulePersistEditorWorkspace();
  }

  async function saveScratchAs(): Promise<boolean> {
    const from = activeFilePath.value;
    if (!from || !isScratchPath(from)) return false;

    const name = await inputPrompt.prompt("保存临时窗口为（相对项目路径，可含子目录）", {
      defaultValue: "untitled.txt",
    });
    if (!name?.trim()) return false;

    const target = joinProjectPath(parentDirForCreate(), name.trim());
    const content = fileContent.value;
    const createResult = await createItem(target, false, content);
    if (!createResult.ok) {
      const writeResult = await writeFile(target, content);
      if (!writeResult.ok) {
        fileLoadError.value = writeResult.error || createResult.error || "保存失败";
        return false;
      }
    }

    const tab = findOpenTab(from);
    if (tab) {
      tab.path = target;
      tab.content = content;
      tab.dirty = false;
      tab.kind = "file";
    }
    activeFilePath.value = target;
    fileDirty.value = false;
    fileLoadError.value = "";
    selectedTreePath.value = target;
    treeError.value = "";
    await refreshTree();
    schedulePersistEditorWorkspace();
    return true;
  }

  async function saveFile(): Promise<boolean> {
    if (!activeFilePath.value) return false;
    if (activeFileReadOnly.value) return false;
    if (isScratchPath(activeFilePath.value)) {
      return saveScratchAs();
    }
    const result = await writeFile(activeFilePath.value, fileContent.value);
    if (!result.ok) {
      fileLoadError.value = result.error || "保存失败";
      return false;
    }
    fileDirty.value = false;
    fileLoadError.value = "";
    const tab = findOpenTab(activeFilePath.value);
    if (tab) {
      tab.content = fileContent.value;
      tab.dirty = false;
    }
    return true;
  }

  function switchTab(path: string) {
    if (path === activeFilePath.value) return;
    if (readOnlyFileKeys.value.has(normalizePathKey(path))) {
      void switchReadOnlyTab(path);
      return;
    }
    void openFile(path);
  }

  async function switchReadOnlyTab(path: string) {
    const canLeave = await ensureCanLeaveCurrentTab();
    if (!canLeave) return;
    syncActiveTabToCache();
    const tab = findOpenTab(path);
    if (!tab) return;
    activeFilePath.value = path;
    fileContent.value = tab.content;
    fileDirty.value = false;
    fileLoadError.value = "";
    selectedTreePath.value = "";
    showDiffMode.value = Boolean(getFileDiff(path));
  }

  async function closeTab(path: string) {
    const tab = findOpenTab(path);
    if (!tab) return;

    if (tab.dirty) {
      const ok = await handleUnsavedTabChoice(path, "close");
      if (!ok) return;
    }

    const idx = openTabs.value.findIndex((item) => item.path === path);
    if (idx < 0) return;
    openTabs.value.splice(idx, 1);
    if (readOnlyFileKeys.value.has(normalizePathKey(path))) {
      const nextReadOnly = new Set(readOnlyFileKeys.value);
      nextReadOnly.delete(normalizePathKey(path));
      readOnlyFileKeys.value = nextReadOnly;
      const nextDiffs = { ...fileDiffs.value };
      delete nextDiffs[normalizePathKey(path)];
      fileDiffs.value = nextDiffs;
    }

    if (activeFilePath.value !== path) return;

    const nextTab = openTabs.value[idx] || openTabs.value[idx - 1];
    if (nextTab) {
      activeFilePath.value = nextTab.path;
      fileContent.value = nextTab.content;
      fileDirty.value = nextTab.dirty;
      fileLoadError.value = "";
      showDiffMode.value = readOnlyFileKeys.value.has(normalizePathKey(nextTab.path)) && Boolean(getFileDiff(nextTab.path));
      selectedTreePath.value =
        showDiffMode.value || isVirtualSchemePath(nextTab.path) ? "" : nextTab.path;
      return;
    }

    activeFilePath.value = "";
    fileContent.value = "";
    fileDirty.value = false;
    fileLoadError.value = "";
    showDiffMode.value = false;
    syncEditorPanelForOpenFiles();
  }

  async function closeOtherTabs(keepPath: string) {
    const keepTab = findOpenTab(keepPath);
    if (!keepTab) return;
    syncActiveTabToCache();
    const others = openTabs.value.filter((t) => t.path !== keepPath);
    for (const t of others) {
      await closeTab(t.path);
    }
    if (activeFilePath.value !== keepPath) {
      const kt = findOpenTab(keepPath);
      if (kt) {
        syncActiveTabToCache();
        activeFilePath.value = kt.path;
        fileContent.value = kt.content;
        fileDirty.value = kt.dirty;
        fileLoadError.value = "";
        showDiffMode.value = readOnlyFileKeys.value.has(normalizePathKey(kt.path)) && Boolean(getFileDiff(kt.path));
      }
    }
  }

  async function closeRightTabs(keepPath: string) {
    syncActiveTabToCache();
    const keepIdx = openTabs.value.findIndex((t) => t.path === keepPath);
    if (keepIdx < 0) return;
    const rightTabs = openTabs.value.slice(keepIdx + 1);
    for (const t of rightTabs) {
      await closeTab(t.path);
    }
  }

  async function closeAllTabs() {
    syncActiveTabToCache();
    const all = [...openTabs.value];
    for (const t of all) {
      await closeTab(t.path);
    }
  }

  function reorderTabs(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= openTabs.value.length) return;
    // Allow toIndex == length (drop at the end)
    if (toIndex < 0 || toIndex > openTabs.value.length) return;

    const tabs = [...openTabs.value];
    const [moved] = tabs.splice(fromIndex, 1);
    // After splicing fromIndex, items after it shift left by 1.
    // Adjust toIndex for the shift when moving forward.
    const adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
    tabs.splice(adjustedTo, 0, moved);
    openTabs.value = tabs;

    schedulePersistEditorWorkspace();
  }

  function updateOpenTabPath(from: string, to: string) {
    const tab = findOpenTab(from);
    if (tab) tab.path = to;
  }

  function parentDirForCreate(): string {
    const treeSel = selectedTreePath.value.trim();
    const active = activeFilePath.value;
    const candidates = [treeSel, active, projectPath.value].filter(Boolean);
    for (const sel of candidates) {
      if (isVirtualSchemePath(sel)) continue;
      const node = findNode(fileTree.value, sel);
      if (node?.isDirectory) return sel;
      const norm = sel.replace(/\\/g, "/");
      const idx = norm.lastIndexOf("/");
      if (idx > 0) {
        const parent = norm.slice(0, idx);
        if (parent && !isVirtualSchemePath(parent)) return parent;
      }
    }
    return projectPath.value;
  }

  async function createNewFile() {
    if (!projectOpened.value) return;
    const name = await inputPrompt.prompt("新建文件（可含子目录，如 src/utils/helper.ts）", {
      defaultValue: "new-file.ts",
    });
    if (!name) return;
    const target = joinProjectPath(parentDirForCreate(), name.trim());
    const result = await createItem(target, false, "");
    if (!result.ok) {
      treeError.value = result.error || "创建失败";
      return;
    }
    treeError.value = "";
    await refreshTree();
    selectedTreePath.value = target;
    await openFile(target);
  }

  async function createNewFolder() {
    if (!projectOpened.value) return;
    const name = await inputPrompt.prompt("新建文件夹（可含子目录）", {
      defaultValue: "new-folder",
    });
    if (!name) return;
    const target = joinProjectPath(parentDirForCreate(), name.trim());
    const result = await createItem(target, true);
    if (!result.ok) {
      treeError.value = result.error || "创建失败";
      return;
    }
    treeError.value = "";
    selectedTreePath.value = target;
    await refreshTree();
    await toggleDir(target);
  }

  async function commitRename(path: string, newName: string) {
    const from = path;
    const parent = from.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    const to = joinProjectPath(parent, newName);
    const result = await renameItem(from, to);
    if (!result.ok) {
      treeError.value = result.error || "重命名失败";
      return;
    }
    renamingPath.value = "";          // 重命名确认成功后再清状态
    treeError.value = "";
    if (activeFilePath.value === from) {
      activeFilePath.value = to;
      const fromDiff = getFileDiff(from);
      if (fromDiff) {
        setFileDiff(to, fromDiff);
        const next = { ...fileDiffs.value };
        delete next[normalizePathKey(from)];
        fileDiffs.value = next;
      }
    }
    updateOpenTabPath(from, to);
    selectedTreePath.value = to;
    await refreshTree();
  }

  function cancelRename() {
    renamingPath.value = "";
  }

  async function deleteSelectedItem() {
    const target = selectedTreePath.value;
    if (!target) return;
    const root = projectPath.value.replace(/\\/g, "/").replace(/\/$/, "");
    const normalized = target.replace(/\\/g, "/");
    if (normalized === root) {
      treeError.value = "不能删除项目根目录";
      return;
    }
    if (!(await confirm(`确定删除「${fileName(target)}」？`))) return;

    const result = await deleteItem(target);
    if (!result.ok) {
      treeError.value = result.error || "删除失败";
      return;
    }
    treeError.value = "";
    const tabIdx = openTabs.value.findIndex((tab) => tab.path === target);
    if (tabIdx >= 0) openTabs.value.splice(tabIdx, 1);
    if (activeFilePath.value === target) {
      const nextTab = openTabs.value[tabIdx] || openTabs.value[tabIdx - 1];
      if (nextTab) {
        activeFilePath.value = nextTab.path;
        fileContent.value = nextTab.content;
        fileDirty.value = nextTab.dirty;
      } else {
        activeFilePath.value = "";
        fileContent.value = "";
        fileDirty.value = false;
        syncEditorPanelForOpenFiles();
      }
      showDiffMode.value = false;
    }
    if (getFileDiff(target)) {
      const next = { ...fileDiffs.value };
      delete next[normalizePathKey(target)];
      fileDiffs.value = next;
    }
    selectedTreePath.value = projectPath.value;
    await refreshTree();
  }

  function toggleDiffMode() {
    if (!activeFileDiff.value) return;
    showDiffMode.value = !showDiffMode.value;
  }

  function storeFileDiff(relPath: string, before: string, after: string, deleted?: boolean) {
    const full = resolveFullPathFromRel(relPath);
    setFileDiff(full, { before, after, deleted });
  }

  async function toggleDir(dirPath: string) {
    const expanded = expandedDirs.value;
    if (expanded.has(dirPath)) {
      expanded.delete(dirPath);
      expandedDirs.value = new Set(expanded);
      return;
    }

    expanded.add(dirPath);
    expandedDirs.value = new Set(expanded);

    const node = findNode(fileTree.value, dirPath);
    if (node && node.isDirectory && !node.loaded) {
      try {
        node.children = await loadDirChildren(dirPath);
        node.loaded = true;
      } catch (e) {
        node.children = [];
        treeError.value = e instanceof Error ? e.message : "加载目录失败";
      }
    }
  }

  function selectTreeItem(path: string) {
    selectedTreePath.value = path;
  }

  /**
   * 展开目标文件的父目录链并在文件树中滚动定位。
   * 目录可能尚未加载 children（懒加载），逐级展开 + 加载。
   */
  async function revealInTree(filePath: string) {
    const target = filePath.trim();
    if (!target || !projectPath.value.trim()) return;

    const dirs = parentDirChain(target);
    for (const dir of dirs) {
      if (!expandedDirs.value.has(dir)) {
        const expanded = expandedDirs.value;
        expanded.add(dir);
        expandedDirs.value = new Set(expanded);
        const node = findNode(fileTree.value, dir);
        if (node?.isDirectory && !node.loaded) {
          try {
            node.children = await loadDirChildren(dir);
            node.loaded = true;
          } catch {
            node.children = [];
          }
        }
      }
    }

    await nextTick();
    scrollTreeNodeIntoView(target);
  }

  /** 目标文件的各级父目录（不含根），返回与文件树节点一致的路径分隔符 */
  function parentDirChain(filePath: string): string[] {
    const root = projectPath.value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    const norm = filePath.replace(/\\/g, "/");
    const slashIdx = norm.lastIndexOf("/");
    const dir = slashIdx >= 0 ? norm.slice(0, slashIdx) : "";
    const chain: string[] = [];
    let cur = dir;
    while (cur) {
      const curLower = cur.toLowerCase();
      if (curLower === root) break;
      chain.unshift(cur);
      const next = cur.includes("/") ? cur.slice(0, cur.lastIndexOf("/")) : "";
      if (!next) break;
      cur = next;
    }
    // 文件树 path 用反斜杠（Windows），转回原始分隔符
    return chain.map((d) => (d.includes("/") ? d.replace(/\//g, "\\") : d));
  }

  /** 在文件树滚动容器内定位到节点（文件树当前仅在 files 面板渲染） */
  function scrollTreeNodeIntoView(filePath: string) {
    if (typeof document === "undefined") return;
    const container = document.querySelector(".file-tree") as HTMLElement | null;
    if (!container) return;
    const items = container.querySelectorAll(".file-item");
    let found: HTMLElement | null = null;
    for (const el of Array.from(items)) {
      if (el.getAttribute("data-path") === filePath) {
        found = el as HTMLElement;
        break;
      }
    }
    if (!found) return;
    const cRect = container.getBoundingClientRect();
    const nRect = found.getBoundingClientRect();
    if (nRect.top < cRect.top || nRect.bottom > cRect.bottom) {
      found.scrollIntoView({ block: "nearest" });
    }
  }

  function onEditorChange() {
    if (activeFileReadOnly.value) return;
    fileDirty.value = true;
    const tab = findOpenTab(activeFilePath.value);
    if (tab) tab.dirty = true;
    schedulePersistEditorWorkspace();
  }

  function activeFileRelativePath(): string {
    if (!activeFilePath.value || !projectPath.value) return "";
    const root = projectPath.value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    const full = activeFilePath.value.replace(/\\/g, "/").toLowerCase();
    if (!full.startsWith(root)) return "";
    return full.slice(root.length).replace(/^\//, "");
  }

  async function syncEditorAfterAgentFileChange(relPath: string, diff: FileDiff) {
    await refreshTree();
    const fullPath = resolveFullPathFromRel(relPath);
    if (diff.deleted) {
      removeOpenTabForPath(fullPath);
      return;
    }
    const tab = findOpenTab(fullPath);
    if (tab) {
      tab.content = diff.after;
      tab.dirty = false;
    }
    if (normalizePathKey(activeFilePath.value) === normalizePathKey(fullPath)) {
      fileContent.value = diff.after;
      fileDirty.value = false;
    }
  }

  function removeOpenTabForPath(path: string) {
    const idx = openTabs.value.findIndex((tab) => tab.path === path);
    if (idx >= 0) openTabs.value.splice(idx, 1);
    if (activeFilePath.value === path) {
      const nextTab = openTabs.value[idx] || openTabs.value[idx - 1];
      if (nextTab) {
        activeFilePath.value = nextTab.path;
        fileContent.value = nextTab.content;
        fileDirty.value = nextTab.dirty;
      } else {
        activeFilePath.value = "";
        fileContent.value = "";
        fileDirty.value = false;
        syncEditorPanelForOpenFiles();
      }
    }
  }

  const activeFileDiff = computed(() => getFileDiff(activeFilePath.value));
  const activeFileReadOnly = computed(() => readOnlyFileKeys.value.has(normalizePathKey(activeFilePath.value)));

  let suppressWorkspacePersist = false;
  let persistWorkspaceTimer = 0;

  function cancelScheduledPersistEditorWorkspace() {
    if (persistWorkspaceTimer) {
      window.clearTimeout(persistWorkspaceTimer);
      persistWorkspaceTimer = 0;
    }
  }

  function prepareEditorWorkspaceProjectSwitch() {
    suppressWorkspacePersist = true;
    cancelScheduledPersistEditorWorkspace();
  }

  function finishEditorWorkspaceProjectSwitch() {
    suppressWorkspacePersist = false;
  }

  function persistEditorWorkspace() {
    if (suppressWorkspacePersist) return;
    const root = projectPath.value.trim();
    if (!root || !projectOpened.value) return;
    syncActiveTabToCache();
    const tabs: PersistedEditorTab[] = openTabs.value.map((tab) => {
      const base: PersistedEditorTab = { path: tab.path, kind: tab.kind };
      if (tab.kind === "file") {
        if (tab.dirty) {
          base.dirty = true;
          base.content = tab.content;
        }
      } else if (tab.kind === "scratch") {
        base.dirty = tab.dirty;
        base.content = tab.content;
      } else {
        base.content = tab.content;
        const diff = getFileDiff(tab.path);
        if (diff) base.diff = diff;
        if (readOnlyFileKeys.value.has(normalizePathKey(tab.path))) {
          base.readOnly = true;
        }
      }
      return base;
    });
    const active = activeFilePath.value.trim();
    const activePath = tabs.some((tab) => tab.path === active) ? active : (tabs[0]?.path ?? "");
    writeEditorWorkspace(root, { tabs, activePath });
  }

  function schedulePersistEditorWorkspace() {
    if (suppressWorkspacePersist) return;
    cancelScheduledPersistEditorWorkspace();
    persistWorkspaceTimer = window.setTimeout(() => {
      persistWorkspaceTimer = 0;
      persistEditorWorkspace();
    }, 250);
  }

  async function restoreEditorWorkspace() {
    const root = projectPath.value.trim();
    if (!root || !projectOpened.value) return;

    const saved = readEditorWorkspace(root);
    if (!saved?.tabs.length) return;

    navBackStack.value = [];
    navForwardStack.value = [];

    const restored: OpenTab[] = [];
    const nextDiffs: Record<string, FileDiff> = {};
    const nextReadOnly = new Set<string>();

    for (const item of saved.tabs) {
      const path = item.path.trim();
      if (!path) continue;

      const kind: EditorTabKind = (item.kind as EditorTabKind) || "file";

      if (kind === "scratch" || isScratchPath(path)) {
        const id = Number(path.slice(UNTITLED_SCHEME.length));
        if (Number.isFinite(id) && id > scratchSeq) scratchSeq = id;
        restored.push({
          path,
          content: item.content ?? "",
          dirty: Boolean(item.dirty),
          kind: "scratch",
        });
        continue;
      }

      if (kind === "file") {
        if (item.dirty && item.content !== undefined) {
          restored.push({ path, content: item.content, dirty: true, kind: "file" });
          continue;
        }
        const result = await readFile(path);
        if (result.ok) {
          restored.push({ path, content: result.content, dirty: false, kind: "file" });
        }
      } else {
        restored.push({ path, content: item.content ?? "", dirty: false, kind });
        if (item.diff) {
          nextDiffs[normalizePathKey(path)] = item.diff;
        }
        if (item.readOnly) {
          nextReadOnly.add(normalizePathKey(path));
        }
      }
    }
    if (!restored.length) return;

    openTabs.value = restored;
    if (Object.keys(nextDiffs).length) {
      fileDiffs.value = { ...fileDiffs.value, ...nextDiffs };
    }
    if (nextReadOnly.size) {
      readOnlyFileKeys.value = new Set([...readOnlyFileKeys.value, ...nextReadOnly]);
    }

    const activeKey = normalizePathKey(saved.activePath.trim());
    const active = restored.find((tab) => normalizePathKey(tab.path) === activeKey) ?? restored[0];
    activeFilePath.value = active.path;
    fileContent.value = active.content;
    fileDirty.value = active.dirty;
    selectedTreePath.value = active.kind === "file" ? active.path : "";
    fileLoadError.value = "";
    showDiffMode.value = active.kind !== "file" && active.kind !== "scratch" && Boolean(nextDiffs[normalizePathKey(active.path)]);
  }

  async function reloadExpandedDirChildren() {
    for (const dirPath of expandedDirs.value) {
      const node = findNode(fileTree.value, dirPath);
      if (node?.isDirectory && !node.loaded) {
        try {
          node.children = await loadDirChildren(dirPath);
          node.loaded = true;
        } catch {
          // ignore restore failures for missing dirs
        }
      }
    }
  }

  watch(
    () => ({
      opened: projectOpened.value,
      root: projectPath.value.trim(),
      tabs: openTabs.value.map((tab) => `${tab.path}\0${tab.kind}\0${tab.dirty ? 1 : 0}`).join("\n"),
      active: activeFilePath.value,
    }),
    () => {
      if (suppressWorkspacePersist) return;
      if (projectOpened.value && projectPath.value.trim()) {
        schedulePersistEditorWorkspace();
      }
    },
  );

  return {
    fileTree,
    expandedDirs,
    openTabs,
    activeFilePath,
    selectedTreePath,
    fileContent,
    fileDirty,
    fileLoadError,
    fileDiffs,
    readOnlyFileKeys,
    showDiffMode,
    renamingPath,
    activeFileDiff,
    activeFileReadOnly,
    refreshTree,
    openFile,
    saveFile,
    reloadFile,
    closeTab,
    switchTab,
    switchReadOnlyTab,
    createNewFile,
    createNewFolder,
    openScratchTab,
    commitRename,
    cancelRename,
    deleteSelectedItem,
    showGitFileDiff,
    openGitLogFile,
    openDiffPreview,
    toggleDiffMode,
    toggleDir,
    findNode,
    findNodeByKey,
    normalizePathKey,
    joinProjectPath,
    resolveFullPathFromRel,
    storeFileDiff,
    getFileDiff,
    setFileDiff,
    findOpenTab,
    syncActiveTabToCache,
    ensureCanLeaveCurrentTab,
    ensureCanLeaveAllOpenTabs,
    syncEditorPanelForOpenFiles,
    parentDirForCreate,
    selectTreeItem,
    revealInTree,
    onEditorChange,
    activeFileRelativePath,
    syncEditorAfterAgentFileChange,
    closeOtherTabs,
    closeRightTabs,
    closeAllTabs,
    navigateBack,
    navigateForward,
    canGoBack,
    canGoForward,
    reorderTabs,
    persistEditorWorkspace,
    restoreEditorWorkspace,
    reloadExpandedDirChildren,
    prepareEditorWorkspaceProjectSwitch,
    finishEditorWorkspaceProjectSwitch,
  };
}
