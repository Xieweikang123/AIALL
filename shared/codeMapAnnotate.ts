import type { CodeMapDocument, CodeMapNode } from "./codeMapTypes";

export type CodeMapAnnotationMap = Record<string, string>;

const SYSTEM_PROMPT = `你是代码库架构标注助手。根据给定的模块节点列表（id/kind/label/path），为每个节点写一句极短中文摘要（≤40字），说明该模块职责。
只输出 JSON 对象：键为节点 id，值为摘要字符串。不要输出 markdown 代码围栏或其它文字。
若信息不足可写「待确认」类短句，禁止编造不存在的框架细节。`;

export function buildCodeMapAnnotateUserMessage(doc: CodeMapDocument): string {
  const payload = doc.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    path: n.path ?? null,
  }));
  return `项目：${doc.projectRoot}\n节点：\n${JSON.stringify(payload, null, 2)}`;
}

export function buildCodeMapAnnotateMessages(doc: CodeMapDocument): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildCodeMapAnnotateUserMessage(doc) },
  ];
}

export function parseCodeMapAnnotations(raw: string): CodeMapAnnotationMap | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let text = trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out: CodeMapAnnotationMap = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const summary = value.replace(/\s+/g, " ").trim().slice(0, 40);
      if (summary) out[key] = summary;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function applyAnnotationsToDocument(
  doc: CodeMapDocument,
  annotations: CodeMapAnnotationMap,
): CodeMapDocument {
  const nodes: CodeMapNode[] = doc.nodes.map((n) => {
    const summary = annotations[n.id];
    return summary ? { ...n, summary } : n;
  });
  return { ...doc, nodes };
}

export function buildExplainNodePrompt(node: CodeMapNode): string {
  const path = node.path ? `\n路径：\`${node.path}\`` : "";
  const summary = node.summary ? `\n已有标注：${node.summary}` : "";
  return `请结合当前项目源码，解释架构图中这个节点的职责与上下游关系：\n类型：${node.kind}\n名称：${node.label}${path}${summary}\n请先定位相关文件再回答，勿凭猜测编造调用链。`;
}
