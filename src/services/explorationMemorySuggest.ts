export type MemorySectionId = "术语" | "导航" | "偏好";

export type ExplorationMemoryCandidate = {
  id: string;
  section: MemorySectionId;
  line: string;
  checked: boolean;
};

type ToolLike = {
  name?: string;
  ok?: boolean;
  args?: Record<string, unknown>;
};

export function uniqueReadPathsFromTools(tools: ToolLike[] | undefined): string[] {
  if (!tools?.length) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (tool.name !== "read_file" || tool.ok === false) continue;
    const rel = String(tool.args?.path ?? "")
      .trim()
      .replace(/\\/g, "/");
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    paths.push(rel);
  }
  return paths;
}

export function shouldOfferExplorationMemory(params: {
  tools?: ToolLike[];
  writtenFiles?: string[];
  agentAborted?: boolean;
  chatMode?: string;
}): boolean {
  if (params.agentAborted && params.chatMode !== "explore") return false;
  if (params.chatMode === "ask") return false;
  const reads = uniqueReadPathsFromTools(params.tools);
  const written = params.writtenFiles?.filter(Boolean) ?? [];
  if (params.chatMode === "explore") return reads.length >= 3;
  return reads.length >= 3 || written.length >= 1;
}

export function buildExplorationMemoryCandidates(params: {
  tools?: ToolLike[];
  writtenFiles?: string[];
}): ExplorationMemoryCandidate[] {
  const reads = uniqueReadPathsFromTools(params.tools);
  const written = [...new Set((params.writtenFiles ?? []).map((p) => p.replace(/\\/g, "/")))];
  const candidates: ExplorationMemoryCandidate[] = [];

  for (const rel of written.slice(0, 3)) {
    candidates.push({
      id: `written:${rel}`,
      section: "导航",
      line: `相关源码：\`${rel}\``,
      checked: true,
    });
  }

  const readOnly = reads.filter((rel) => !written.includes(rel));
  for (const rel of readOnly.slice(-3)) {
    candidates.push({
      id: `read:${rel}`,
      section: "导航",
      line: `探索涉及：\`${rel}\``,
      checked: written.length === 0,
    });
  }

  const seenLines = new Set<string>();
  return candidates
    .filter((item) => {
      if (seenLines.has(item.line)) return false;
      seenLines.add(item.line);
      return true;
    })
    .slice(0, 5);
}

export function groupCheckedCandidatesBySection(
  candidates: ExplorationMemoryCandidate[],
): Partial<Record<MemorySectionId, string[]>> {
  const grouped: Partial<Record<MemorySectionId, string[]>> = {};
  for (const item of candidates) {
    if (!item.checked) continue;
    const list = grouped[item.section] ?? [];
    list.push(item.line);
    grouped[item.section] = list;
  }
  return grouped;
}
