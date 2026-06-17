import { computed, ref, type Ref } from "vue";
import { type TreeNode } from "../components/FileTreeNode.vue";
import CodeMonacoEditor from "../components/CodeMonacoEditor.vue";
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
};

export interface UseEditorPanelParams {
  projectPath: Ref<string>;
  projectOpened: Ref<boolean>;
  aiConfig: Ref<{ endpoint: string; apiKey: string; model: string; providerName: string }>;
  configReady: Ref<boolean>;
  confirm: (msg: string, event?: MouseEvent) => Promise<boolean>;
  inputPrompt: { prompt: (msg: string, options?: { defaultValue?: string }) => Promise<string | null> };
  composerRef: Ref<{ setPlainText: (text: string) => void; focus: () => void } | null>;
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
}

export function useEditorPanel(params: UseEditorPanelParams) {
  const {
    projectPath,
    projectOpened,
    confirm,
    inputPrompt,
    composerRef,
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
  const selectedCode = ref("");
  const renamingPath = ref("");

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

  async function ensureCanLeaveCurrentTab(): Promise<boolean> {
    if (!fileDirty.value || !activeFilePath.value) return true;
    const name = fileName(activeFilePath.value);
    const choice = await confirm(`「${name}」未保存。确定保存？\n\n确定 = 保存后切换\n取消 = 留在当前文件`);
    if (choice) {
      await saveFile();
      return !fileDirty.value;
    }
    return false;
  }

  async function ensureCanLeaveAllOpenTabs(): Promise<boolean> {
    for (const tab of [...openTabs.value]) {
      if (!tab.dirty) continue;
      const name = fileName(tab.path);
      const save = await confirm(`「${name}」未保存。确定保存？\n\n确定 = 保存后切换\n取消 = 留在当前项目`);
      if (!save) return false;
      if (activeFilePath.value !== tab.path) {
        syncActiveTabToCache();
        activeFilePath.value = tab.path;
        fileContent.value = tab.content;
        fileDirty.value = tab.dirty;
      }
      await saveFile();
      if (fileDirty.value) return false;
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
    if (path.startsWith("git-index://")) return path.slice("git-index://".length);
    if (path.startsWith("git-history://")) {
      const rest = path.slice("git-history://".length);
      const slash = rest.indexOf("/");
      return slash >= 0 ? rest.slice(slash + 1) : rest;
    }
    return path;
  }

  function isVirtualSchemePath(path: string): boolean {
    return path.startsWith("git-index://") || path.startsWith("git-history://");
  }

  function gitWorkingTreePreviewPath(filePath: string, staged = false): string {
    if (!staged) return resolveFullPathFromRel(filePath);
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

  async function openDiffPreview(path: string, diff: FileDiff, options?: { readOnly?: boolean }) {
    if (!(await ensureCanLeaveCurrentTab())) return;
    syncActiveTabToCache();
    if (options?.readOnly) {
      const nextReadOnly = new Set(readOnlyFileKeys.value);
      nextReadOnly.add(normalizePathKey(path));
      readOnlyFileKeys.value = nextReadOnly;
    }
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
    } else {
      openTabs.value.push({ path, content: diff.after, dirty: false });
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
        const result = await fetchGitDiffContent(projectPath.value.trim(), filePath, staged, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok) {
          if (result.error !== "已取消") gitError.value = result.error || "获取 diff 失败";
          return;
        }
        diff = { before: result.before, after: result.after };
        gitDiffContentCache.value = { ...gitDiffContentCache.value, [cacheKey]: diff };
        evictOldestCacheEntry();
      }
      await openDiffPreview(previewPath, diff, { readOnly: staged });
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

    expandEditor();
    showDiffMode.value = false;
    fileLoadError.value = "";
    selectedTreePath.value = filePath;

    const cached = findOpenTab(filePath);
    if (cached && !options?.force) {
      activeFilePath.value = filePath;
      fileContent.value = cached.content;
      fileDirty.value = cached.dirty;
      return;
    }

    activeFilePath.value = filePath;
    fileDirty.value = false;

    if (isVirtualSchemePath(filePath)) {
      fileContent.value = cached?.content || "";
      fileLoadError.value = cached ? "" : "预览文件不可直接读取";
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
    } else {
      openTabs.value.push({ path: filePath, content: result.content, dirty: false });
    }
  }

  async function reloadFile() {
    if (!activeFilePath.value) return;
    if (activeFileReadOnly.value) return;
    await openFile(activeFilePath.value, { force: true, skipUnsavedCheck: true });
  }

  async function saveFile(): Promise<boolean> {
    if (!activeFilePath.value) return false;
    if (activeFileReadOnly.value) return false;
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
      const name = fileName(path);
      const save = await confirm(`「${name}」未保存。确定保存？\n\n确定 = 保存后关闭\n取消 = 留在当前文件`);
      if (save) {
        if (activeFilePath.value !== path) {
          syncActiveTabToCache();
          activeFilePath.value = path;
          fileContent.value = tab.content;
          fileDirty.value = tab.dirty;
        }
        await saveFile();
        if (fileDirty.value) return;
      } else {
        return;
      }
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
      selectedTreePath.value = showDiffMode.value ? "" : nextTab.path;
      return;
    }

    activeFilePath.value = "";
    fileContent.value = "";
    fileDirty.value = false;
    fileLoadError.value = "";
    showDiffMode.value = false;
    syncEditorPanelForOpenFiles();
  }

  function updateOpenTabPath(from: string, to: string) {
    const tab = findOpenTab(from);
    if (tab) tab.path = to;
  }

  function parentDirForCreate(): string {
    const sel = selectedTreePath.value || activeFilePath.value || projectPath.value;
    const node = findNode(fileTree.value, sel);
    if (node?.isDirectory) return sel;
    const norm = sel.replace(/\\/g, "/");
    const idx = norm.lastIndexOf("/");
    return idx > 0 ? norm.slice(0, idx) : projectPath.value;
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
    renamingPath.value = "";
    const from = path;
    const parent = from.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    const to = joinProjectPath(parent, newName);
    const result = await renameItem(from, to);
    if (!result.ok) {
      treeError.value = result.error || "重命名失败";
      return;
    }
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

  function onEditorChange() {
    if (activeFileReadOnly.value) return;
    fileDirty.value = true;
    const tab = findOpenTab(activeFilePath.value);
    if (tab) tab.dirty = true;
  }

  function onEditorSelect(text: string) {
    selectedCode.value = text.trim();
  }

  function askAiWithCode() {
    if (!selectedCode.value) return;
    const raw = activeFilePath.value || "";
    const filePath = displayFilePath(raw) || "未知文件";
    composerRef.value?.setPlainText(
      `请帮我分析以下代码（${filePath}）：\n\n\`\`\`\n${selectedCode.value}\n\`\`\``,
    );
    selectedCode.value = "";
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
    selectedCode,
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
    onEditorChange,
    onEditorSelect,
    askAiWithCode,
    activeFileRelativePath,
    syncEditorAfterAgentFileChange,
  };
}
