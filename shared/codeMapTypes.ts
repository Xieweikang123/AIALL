/** Code to Map — shared document contract (Node/Rust/UI). */

export const CODE_MAP_SCHEMA_VERSION = 1 as const;

export const CODE_MAP_DIR = ".aiall/code-map";
export const CODE_MAP_LATEST_REL = `${CODE_MAP_DIR}/latest.json`;
export const CODE_MAP_LAYOUT_REL = `${CODE_MAP_DIR}/layout.json`;

/** Hard caps for P0 graph size. */
export const CODE_MAP_MAX_NODES = 80;
export const CODE_MAP_MAX_EDGES = 120;

/** Agent system-context injection caps (must stay in sync with Rust `context.rs`). */
export const CODE_MAP_AGENT_CONTEXT_MAX_NODES = 24;
export const CODE_MAP_AGENT_CONTEXT_MAX_CHARS = 2_500;

export type CodeMapNodeKind = "root" | "module" | "entry" | "route" | "external";
export type CodeMapEdgeKind = "contains" | "imports" | "routes_to" | "depends";

export type CodeMapNode = {
  id: string;
  kind: CodeMapNodeKind;
  label: string;
  /** Project-relative path for openFile navigation. */
  path?: string;
  /** Optional AI annotation (≤40 chars preferred). */
  summary?: string;
  collapsed?: boolean;
};

export type CodeMapEdge = {
  id: string;
  source: string;
  target: string;
  kind: CodeMapEdgeKind;
};

export type CodeMapDocument = {
  schemaVersion: typeof CODE_MAP_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  gitHead?: string;
  nodes: CodeMapNode[];
  edges: CodeMapEdge[];
  focusHint?: string;
  /** Nodes omitted by size gate. */
  truncatedCount?: number;
};

export type CodeMapLayoutPosition = { x: number; y: number };

export type CodeMapLayoutFile = {
  schemaVersion: typeof CODE_MAP_SCHEMA_VERSION;
  /** Must match CODE_MAP_LAYOUT_ALGO in codeMapLayout.ts or positions are recomputed. */
  algoVersion?: number;
  positions: Record<string, CodeMapLayoutPosition>;
  collapsedIds?: string[];
  updatedAt: string;
};

export type CodeMapBuildResult = {
  ok: boolean;
  document?: CodeMapDocument;
  error?: string;
};

export function isCodeMapDocument(value: unknown): value is CodeMapDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as CodeMapDocument;
  return (
    doc.schemaVersion === CODE_MAP_SCHEMA_VERSION &&
    typeof doc.projectRoot === "string" &&
    typeof doc.generatedAt === "string" &&
    Array.isArray(doc.nodes) &&
    Array.isArray(doc.edges)
  );
}

export function isCodeMapLayoutFile(value: unknown): value is CodeMapLayoutFile {
  if (!value || typeof value !== "object") return false;
  const layout = value as CodeMapLayoutFile;
  return (
    layout.schemaVersion === CODE_MAP_SCHEMA_VERSION &&
    typeof layout.updatedAt === "string" &&
    !!layout.positions &&
    typeof layout.positions === "object"
  );
}

export function kindLabel(kind: CodeMapNodeKind): string {
  switch (kind) {
    case "root":
      return "项目根";
    case "module":
      return "模块";
    case "entry":
      return "入口";
    case "route":
      return "路由";
    case "external":
      return "外部";
    default:
      return kind;
  }
}

export function edgeKindLabel(kind: CodeMapEdgeKind): string {
  switch (kind) {
    case "contains":
      return "包含";
    case "imports":
      return "导入";
    case "routes_to":
      return "路由";
    case "depends":
      return "依赖";
    default:
      return kind;
  }
}
