import { ref, computed, nextTick } from "vue";
import { debugLog } from "../utils/debugLog";
import { listDirectory, createItem, deleteItem, renameItem, type FileEntry } from "../services/vibeCodingClient";

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

export function useFileTree(projectPath: () => string) {
  const fileTree = ref<TreeNode[]>([]);
  const expandedDirs = ref<Set<string>>(new Set());
  const selectedTreePath = ref("");
  const renamingPath = ref("");
  const loadingTree = ref(false);
  const treeError = ref("");

  function findNode(nodes: TreeNode[], path: string): TreeNode | null {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children) {
        const found = findNode(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  function findParentNode(nodes: TreeNode[], path: string): TreeNode | null {
    for (const node of nodes) {
      if (node.children) {
        for (const child of node.children) {
          if (child.path === path) return node;
        }
        const found = findParentNode(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  function buildTree(entries: FileEntry[], basePath: string): TreeNode[] {
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return sorted.map((entry) => {
      const fullPath = `${basePath}\\${entry.name}`;
      const node: TreeNode = {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory,
      };

      if (entry.isDirectory && expandedDirs.value.has(fullPath)) {
        node.children = [];
      }

      return node;
    });
  }

  async function refreshTree() {
    const path = projectPath();
    if (!path) {
      fileTree.value = [];
      return;
    }

    loadingTree.value = true;
    treeError.value = "";

    try {
      const result = await listDirectory(path);
      if (result.ok) {
        fileTree.value = buildTree(result.items, path);
      } else {
        treeError.value = result.error || "无法读取目录";
      }
    } catch (e) {
      treeError.value = e instanceof Error ? e.message : "加载失败";
    } finally {
      loadingTree.value = false;
    }
  }

  async function loadDirectory(path: string) {
    try {
      const result = await listDirectory(path);
      if (result.ok) {
        const children = buildTree(result.items, path);
        const node = findNode(fileTree.value, path);
        if (node) {
          node.children = children;
        }
      }
    } catch (e) {
      debugLog("Failed to load directory:", e);
    }
  }

  function toggleDir(path: string) {
    if (expandedDirs.value.has(path)) {
      expandedDirs.value.delete(path);
    } else {
      expandedDirs.value.add(path);
      loadDirectory(path);
    }
  }

  function selectTreeItem(path: string) {
    selectedTreePath.value = path;
  }

  function showContextMenu(x: number, y: number, path: string) {
    // This would be handled by the parent component
  }

  async function createNewFile(name: string) {
    const path = projectPath();
    if (!path) return;

    const fullPath = `${path}\\${name}`;
    const result = await createItem(fullPath, false);
    if (result.ok) {
      await refreshTree();
    }
    return result;
  }

  async function createNewFolder(name: string) {
    const path = projectPath();
    if (!path) return;

    const fullPath = `${path}\\${name}`;
    const result = await createItem(fullPath, true);
    if (result.ok) {
      await refreshTree();
    }
    return result;
  }

  function startRename(path: string) {
    renamingPath.value = path;
  }

  function cancelRename() {
    renamingPath.value = "";
  }

  async function commitRename(oldPath: string, newName: string) {
    const dir = oldPath.substring(0, oldPath.lastIndexOf('\\'));
    const newPath = `${dir}\\${newName}`;
    const result = await renameItem(oldPath, newPath);
    if (result.ok) {
      renamingPath.value = "";
      await refreshTree();
    }
    return result;
  }

  async function deleteTreeNode(path: string, isDirectory: boolean) {
    const result = await deleteItem(path);
    if (result.ok) {
      await refreshTree();
    }
    return result;
  }

  function isExpanded(path: string): boolean {
    return expandedDirs.value.has(path);
  }

  function isRenaming(path: string): boolean {
    return renamingPath.value === path;
  }

  return {
    fileTree,
    expandedDirs,
    selectedTreePath,
    renamingPath,
    loadingTree,
    treeError,
    findNode,
    findParentNode,
    refreshTree,
    toggleDir,
    selectTreeItem,
    showContextMenu,
    createNewFile,
    createNewFolder,
    startRename,
    cancelRename,
    commitRename,
    deleteTreeNode,
    isExpanded,
    isRenaming,
  };
}
