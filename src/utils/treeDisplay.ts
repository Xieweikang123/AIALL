/**
 * 文件树 / Git 树的显示层公共逻辑（纯函数，与具体组件无关）。
 *
 * 两个面板（文件面板 `FileTreeNode.vue`、Git 更改面板 `GitFileTreeNode.vue`）
 * 共用同一套：
 * - 层级缩进（含深层递减，避免 Java 包名这类深层路径把文件名挤出可视区）
 * - 单子目录链合并（`java → com → vpp` 压成一行 `java/com/vpp`，展开仍按真实层级）
 *
 * 设计约定：合并只影响**显示名**与**缩进**；节点的 `path` 一律保留原始值，
 * 右键 / 选中 / 重命名 / 展开 / 拖拽 / DOM 定位全部沿用 path，因此不需要改动上层逻辑。
 */

/** 可折叠节点的最小结构约束（文件树节点与 Git 树节点均满足）。 */
export interface CollapsibleTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: unknown[];
}

/** 显示层节点：用于渲染一行。 */
export interface TreeDisplayNode<T extends CollapsibleTreeNode = CollapsibleTreeNode> {
  /** 显示名：目录为合并后的路径段（如 `java/com/vpp`），文件为文件名 */
  name: string;
  /** 原始节点 path（合并链的起点），上层逻辑一律以此为准 */
  path: string;
  isDirectory: boolean;
  /** 合并链上的每一段原始目录 path，按层级顺序（单段时只有自身） */
  chainPaths: string[];
  /** 链尾原始节点：目录节点的子节点从这里取（文件为自身） */
  tail: T;
}

const INDENT_BASE_PX = 14;
const INDENT_DEEP_PX = 9;
const INDENT_DEEP_FROM = 4;
const INDENT_BASE_OFFSET_PX = 8;

/** 层级缩进像素：浅层 14px 保持层次感，超过 4 层后每级收窄到 9px。 */
export function treeIndentPx(depth: number): number {
  const d = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
  const shallow = Math.min(d, INDENT_DEEP_FROM);
  const deep = d - shallow;
  return INDENT_BASE_OFFSET_PX + shallow * INDENT_BASE_PX + deep * INDENT_DEEP_PX;
}

/** 缩进像素转 CSS 长度值。 */
export function treeIndentCss(depth: number): string {
  return `${treeIndentPx(depth)}px`;
}

/**
 * 合并「单子目录链」为一行显示节点。
 *
 * 只合并**恰好一个子节点且该子节点仍是目录**的中间层（如 `java/com/vpp/auxiliary`）；
 * 一旦某层还有文件、或出现多个子节点，就在该层停止，保证不影响原有结构。
 * 不修改传入的树。
 */
export function collapseTreeNode<T extends CollapsibleTreeNode>(node: T): TreeDisplayNode<T> {
  if (!node.isDirectory) {
    return { name: node.name, path: node.path, isDirectory: false, chainPaths: [node.path], tail: node };
  }

  const chainPaths = [node.path];
  const segments = [node.name];
  let tail = node;

  for (;;) {
    const children = tail.children;
    if (!children || children.length !== 1) break;
    const only = children[0] as T | undefined;
    if (!only || !only.isDirectory) break;
    segments.push(only.name);
    chainPaths.push(only.path);
    tail = only;
  }

  return { name: segments.join("/"), path: node.path, isDirectory: true, chainPaths, tail };
}

/** 批量合并（对每个根节点分别合并各自链）。 */
export function collapseTreeNodes<T extends CollapsibleTreeNode>(nodes: T[]): TreeDisplayNode<T>[] {
  return nodes.map((node) => collapseTreeNode(node));
}

/**
 * 合并后的行是否处于展开态：以**链尾**（最深层节点）是否展开为准。
 *
 * 只有链尾展开时才渲染其子节点；链上中间层仅表示"曾展开到过这里"，
 * 不作为展开判据，否则合并行点击会误收起。
 */
export function isChainExpanded<T extends CollapsibleTreeNode>(
  display: TreeDisplayNode<T>,
  expandedDirs: Set<string>,
): boolean {
  return expandedDirs.has(display.tail.path);
}

/**
 * 取目录节点向下的「单子目录链」中**下一个尚未加载**的目录，没有则返回 null。
 *
 * 文件树是懒加载的：未展开过的目录 `children` 为空，此时单子目录链会被截断在
 * 该节点，合并显示无法继续。调用方循环调用本函数并逐层加载，
 * 即可顺着"仅有一个目录子节点"的链预加载到出现分叉/文件为止，
 * 使 `java → com → vpp …` 打开即合并成一行。
 *
 * Git 树是一次性全量构建的，`children` 已填充，本函数天然返回 null。
 *
 * @param root 起始目录（其 children 应已加载）
 * @param isLoaded 判断某目录的 children 是否已加载（文件树为 `node.loaded === true`）
 */
export function nextUnloadedSingleChainDir<T extends CollapsibleTreeNode>(
  root: T,
  isLoaded: (node: T) => boolean,
): T | null {
  let current: T = root;
  while (isLoaded(current)) {
    const children = (current.children ?? []) as T[];
    const only = children.length === 1 ? children[0] : undefined;
    if (!only || !only.isDirectory) return null;
    if (!isLoaded(only)) return only;
    current = only;
  }
  return null;
}
