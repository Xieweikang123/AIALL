import type { CodeMapDocument, CodeMapEdge, CodeMapNode } from "../../shared/codeMapTypes";

function escapeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, " ").slice(0, 48);
}

function nodeShape(node: CodeMapNode): string {
  const label = escapeLabel(node.label);
  switch (node.kind) {
    case "root":
      return `${node.id}(["${label}"])`;
    case "entry":
      return `${node.id}[["${label}"]]`;
    case "route":
      return `${node.id}("${label}")`;
    case "external":
      return `${node.id}>"${label}"]`;
    default:
      return `${node.id}["${label}"]`;
  }
}

function edgeArrow(kind: CodeMapEdge["kind"]): string {
  switch (kind) {
    case "depends":
      return "-.->";
    case "routes_to":
      return "==>";
    case "imports":
      return "-->";
    default:
      return "-->";
  }
}

/** Sanitize Mermaid node ids (alphanumeric / underscore). */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function codeMapToMermaid(doc: CodeMapDocument): string {
  const idMap = new Map<string, string>();
  for (const node of doc.nodes) {
    idMap.set(node.id, safeId(node.id));
  }

  const lines: string[] = ["flowchart TB"];
  for (const node of doc.nodes) {
    const sid = idMap.get(node.id)!;
    const shaped = nodeShape({ ...node, id: sid });
    lines.push(`  ${shaped}`);
  }
  for (const edge of doc.edges) {
    const s = idMap.get(edge.source);
    const t = idMap.get(edge.target);
    if (!s || !t) continue;
    lines.push(`  ${s} ${edgeArrow(edge.kind)} ${t}`);
  }
  return `${lines.join("\n")}\n`;
}

export function downloadTextFile(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Render document via Mermaid and download SVG. */
export async function exportCodeMapSvg(doc: CodeMapDocument, filename = "code-map.svg"): Promise<void> {
  const mermaidMod = await import("mermaid");
  const mermaid = mermaidMod.default ?? mermaidMod;
  await mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
  });
  const id = `code-map-export-${Date.now()}`;
  const { svg } = await mermaid.render(id, codeMapToMermaid(doc));
  downloadTextFile(filename, svg, "image/svg+xml");
}
