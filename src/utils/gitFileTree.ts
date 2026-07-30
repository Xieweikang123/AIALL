export interface GitFileTreeEntry {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitFileTreeNode {
  name: string;
  /** 目录为段路径（如 `src/components`），文件为完整相对路径 */
  path: string;
  isDirectory: boolean;
  file?: GitFileTreeEntry;
  children?: GitFileTreeNode[];
}

export function buildGitFileTree(files: GitFileTreeEntry[]): GitFileTreeNode[] {
  const root: GitFileTreeNode[] = [];
  const dirMap = new Map<string, GitFileTreeNode>();

  for (const file of files) {
    const normalized = file.path.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (!parts.length) continue;

    let currentLevel = root;
    let prefix = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        currentLevel.push({
          name: part,
          path: normalized,
          isDirectory: false,
          file,
        });
        continue;
      }

      prefix = prefix ? `${prefix}/${part}` : part;
      let dirNode = dirMap.get(prefix);
      if (!dirNode) {
        dirNode = {
          name: part,
          path: prefix,
          isDirectory: true,
          children: [],
        };
        dirMap.set(prefix, dirNode);
        currentLevel.push(dirNode);
      }
      currentLevel = dirNode.children!;
    }
  }

  sortGitFileTreeNodes(root);
  return root;
}

export function collectGitFolderPaths(nodes: GitFileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (!node.isDirectory) continue;
    paths.push(node.path);
    if (node.children?.length) {
      paths.push(...collectGitFolderPaths(node.children));
    }
  }
  return paths;
}

/** Collect every file path under a directory node (non-recursive helper over flat lists). */
export function gitPathsUnderDir(files: { path: string }[], dirPath: string): string[] {
  const normalized = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return [];
  const prefix = `${normalized}/`;
  return files
    .map((f) => f.path.replace(/\\/g, "/"))
    .filter((p) => p === normalized || p.startsWith(prefix));
}

/** Flatten all file paths from a tree (directories excluded). */
export function collectGitFilePaths(nodes: GitFileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.isDirectory) {
      if (node.children?.length) paths.push(...collectGitFilePaths(node.children));
    } else {
      paths.push(node.path);
    }
  }
  return paths;
}

function sortGitFileTreeNodes(nodes: GitFileTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const node of nodes) {
    if (node.children?.length) sortGitFileTreeNodes(node.children);
  }
}
