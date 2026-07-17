import type { CodeMapDocument, CodeMapLayoutPosition } from "../../shared/codeMapTypes";

/** Bump when default layout algorithm changes — stale layout.json is ignored. */
export const CODE_MAP_LAYOUT_ALGO = 2;

const NODE_W = 200;
const NODE_H = 72;
const H_GAP = 28;
const V_GAP = 40;
/** Max siblings per row under one parent (keeps graph tall, not ultra-wide). */
const MAX_COLS = 4;

type Size = { w: number; h: number };

function buildChildMap(doc: CodeMapDocument): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const edge of doc.edges) {
    if (edge.kind !== "contains" && edge.kind !== "routes_to") continue;
    const list = children.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    children.set(edge.source, list);
  }
  for (const [, list] of children) list.sort();
  return children;
}

/**
 * Compact top-down tree layout.
 * Wide sibling fan-out wraps into a grid (≤ MAX_COLS), so the map grows
 * downward instead of becoming a single ultra-wide row.
 */
export function computeTreeLayout(doc: CodeMapDocument): Record<string, CodeMapLayoutPosition> {
  const children = buildChildMap(doc);
  const root =
    doc.nodes.find((n) => n.kind === "root")?.id ??
    doc.nodes[0]?.id ??
    "";

  const positions: Record<string, CodeMapLayoutPosition> = {};
  const sizeCache = new Map<string, Size>();

  function subtreeSize(id: string, stack: Set<string>): Size {
    const cached = sizeCache.get(id);
    if (cached) return cached;
    if (stack.has(id)) return { w: NODE_W, h: NODE_H };
    stack.add(id);
    const kids = (children.get(id) ?? []).filter((c) => !stack.has(c));
    if (kids.length === 0) {
      const leaf = { w: NODE_W, h: NODE_H };
      sizeCache.set(id, leaf);
      stack.delete(id);
      return leaf;
    }
    const cols = Math.min(MAX_COLS, kids.length);
    const rows = Math.ceil(kids.length / cols);
    const kidSizes = kids.map((k) => subtreeSize(k, stack));
    let gridW = 0;
    let gridH = 0;
    for (let r = 0; r < rows; r += 1) {
      let rowW = 0;
      let rowH = 0;
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        if (idx >= kids.length) break;
        rowW += kidSizes[idx].w + (c > 0 ? H_GAP : 0);
        rowH = Math.max(rowH, kidSizes[idx].h);
      }
      gridW = Math.max(gridW, rowW);
      gridH += rowH + (r > 0 ? V_GAP : 0);
    }
    const size = { w: Math.max(NODE_W, gridW), h: NODE_H + V_GAP + gridH };
    sizeCache.set(id, size);
    stack.delete(id);
    return size;
  }

  function place(id: string, left: number, top: number, stack: Set<string>): void {
    if (stack.has(id) || positions[id]) return;
    stack.add(id);
    const kids = (children.get(id) ?? []).filter((c) => !stack.has(c) && !positions[c]);
    const selfSize = subtreeSize(id, new Set());
    // Center node box within its subtree width
    positions[id] = {
      x: left + Math.max(0, (selfSize.w - NODE_W) / 2),
      y: top,
    };

    if (kids.length === 0) {
      stack.delete(id);
      return;
    }

    const cols = Math.min(MAX_COLS, kids.length);
    const rows = Math.ceil(kids.length / cols);
    const kidSizes = kids.map((k) => subtreeSize(k, new Set()));

    const rowWidths: number[] = [];
    const rowHeights: number[] = [];
    for (let r = 0; r < rows; r += 1) {
      let rowW = 0;
      let rowH = 0;
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        if (idx >= kids.length) break;
        rowW += kidSizes[idx].w + (c > 0 ? H_GAP : 0);
        rowH = Math.max(rowH, kidSizes[idx].h);
      }
      rowWidths.push(rowW);
      rowHeights.push(rowH);
    }

    let rowTop = top + NODE_H + V_GAP;
    for (let r = 0; r < rows; r += 1) {
      let cursor = left + Math.max(0, (selfSize.w - rowWidths[r]) / 2);
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        if (idx >= kids.length) break;
        place(kids[idx], cursor, rowTop, stack);
        cursor += kidSizes[idx].w + H_GAP;
      }
      rowTop += rowHeights[r] + V_GAP;
    }
    stack.delete(id);
  }

  if (root) {
    place(root, 0, 0, new Set());
  }

  const orphans = doc.nodes.filter((n) => !positions[n.id]).map((n) => n.id);
  if (orphans.length) {
    let maxY = 0;
    for (const pos of Object.values(positions)) maxY = Math.max(maxY, pos.y);
    const cols = Math.min(MAX_COLS, orphans.length);
    orphans.forEach((id, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      positions[id] = {
        x: c * (NODE_W + H_GAP),
        y: maxY + NODE_H + V_GAP * 2 + r * (NODE_H + V_GAP),
      };
    });
  }

  return positions;
}

export function mergeLayoutPositions(
  computed: Record<string, CodeMapLayoutPosition>,
  saved?: Record<string, CodeMapLayoutPosition> | null,
  savedAlgoVersion?: number | null,
): Record<string, CodeMapLayoutPosition> {
  if (!saved || savedAlgoVersion !== CODE_MAP_LAYOUT_ALGO) {
    return { ...computed };
  }
  const merged = { ...computed };
  for (const [id, pos] of Object.entries(saved)) {
    if (merged[id]) merged[id] = pos;
  }
  return merged;
}

/** Visible nodes after collapsing ancestors. */
export function visibleNodeIds(
  doc: CodeMapDocument,
  collapsedIds: Set<string>,
): Set<string> {
  const children = buildChildMap(doc);
  const hidden = new Set<string>();
  function hideDescendants(id: string) {
    for (const child of children.get(id) ?? []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      hideDescendants(child);
    }
  }
  for (const id of collapsedIds) hideDescendants(id);

  const visible = new Set<string>();
  for (const node of doc.nodes) {
    if (!hidden.has(node.id)) visible.add(node.id);
  }
  return visible;
}
