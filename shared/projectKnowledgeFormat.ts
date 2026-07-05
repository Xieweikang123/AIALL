/** Relative to project root; listed in .gitignore by default. */
export const PROJECT_KNOWLEDGE_REL_PATH = ".aiall/project-knowledge.md";

export const PROJECT_KNOWLEDGE_MARKER = "<!-- project-knowledge -->";
/** @deprecated Use PROJECT_KNOWLEDGE_MARKER; kept for parsing legacy archives. */
export const PROJECT_REPORT_MARKER = "<!-- project-report -->";
export const PROJECT_KNOWLEDGE_TITLE = "项目知识库";

/** Max chars stored on disk (soft cap for manual edits). */
export const PROJECT_KNOWLEDGE_MAX_CHARS = 120_000;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export type ProjectKnowledgeUpdateLogEntry = {
  timestamp: string;
  charCount: number;
  exploreRounds: number;
  gitHead?: string;
};

export type ProjectKnowledgeMeta = {
  updatedAt?: string;
  lastExploredAt?: string;
  exploreRounds?: number;
  gitHead?: string;
  updateHistory?: ProjectKnowledgeUpdateLogEntry[];
};

export type ProjectKnowledgeWriteMetaOptions = {
  gitHead?: string;
  fromExplore?: boolean;
  exploreRounds?: number;
  charCount?: number;
};

export function parseProjectKnowledgeFrontmatter(raw: string): {
  meta: ProjectKnowledgeMeta;
  body: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) {
    return { meta: {}, body: normalized.trim() };
  }

  const metaBlock = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const meta: ProjectKnowledgeMeta = {};

  const updatedAt = metaBlock.match(/^updatedAt:\s*(.+)\s*$/m)?.[1]?.trim();
  const lastExploredAt = metaBlock.match(/^lastExploredAt:\s*(.+)\s*$/m)?.[1]?.trim();
  const exploreRoundsRaw = metaBlock.match(/^exploreRounds:\s*(\d+)\s*$/m)?.[1];
  const gitHead = metaBlock.match(/^gitHead:\s*(.+)\s*$/m)?.[1]?.trim();
  
  const updateHistoryStart = metaBlock.match(/^updateHistory:\s*$/m);
  if (updateHistoryStart) {
    const afterLabel = metaBlock.slice(updateHistoryStart.index! + updateHistoryStart[0].length);
    const entries: ProjectKnowledgeUpdateLogEntry[] = [];
    const entryRegex = /- timestamp:\s*(.+)\s*\n\s+charCount:\s*(\d+)\s*\n\s+exploreRounds:\s*(\d+)(?:\s*\n\s+gitHead:\s*(.+))?/g;
    let entryMatch;
    while ((entryMatch = entryRegex.exec(afterLabel)) !== null) {
      entries.push({
        timestamp: entryMatch[1]?.trim() ?? "",
        charCount: Number(entryMatch[2]) || 0,
        exploreRounds: Number(entryMatch[3]) || 0,
        gitHead: entryMatch[4]?.trim(),
      });
    }
    if (entries.length > 0) meta.updateHistory = entries;
  }

  if (updatedAt) meta.updatedAt = updatedAt;
  if (lastExploredAt) meta.lastExploredAt = lastExploredAt;
  if (exploreRoundsRaw) meta.exploreRounds = Number(exploreRoundsRaw);
  if (gitHead) meta.gitHead = gitHead;

  return { meta, body };
}

export function serializeProjectKnowledgeFrontmatter(
  meta: ProjectKnowledgeMeta,
  body: string,
): string {
  const lines = ["---"];
  if (meta.updatedAt) lines.push(`updatedAt: ${meta.updatedAt}`);
  if (meta.lastExploredAt) lines.push(`lastExploredAt: ${meta.lastExploredAt}`);
  if (meta.exploreRounds != null) lines.push(`exploreRounds: ${meta.exploreRounds}`);
  if (meta.gitHead) lines.push(`gitHead: ${meta.gitHead}`);
  if (meta.updateHistory && meta.updateHistory.length > 0) {
    lines.push("updateHistory:");
    for (const entry of meta.updateHistory) {
      lines.push(`  - timestamp: ${entry.timestamp}`);
      lines.push(`    charCount: ${entry.charCount}`);
      lines.push(`    exploreRounds: ${entry.exploreRounds}`);
      if (entry.gitHead) lines.push(`    gitHead: ${entry.gitHead}`);
    }
  }
  lines.push("---", "", body.trim());
  return `${lines.join("\n")}\n`;
}

export function stripKnowledgeFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (match?.[1] ?? normalized).trim();
}

export function normalizeProjectKnowledgeBody(raw: string): { content: string; truncated: boolean } {
  const trimmed = raw.replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= PROJECT_KNOWLEDGE_MAX_CHARS) {
    return { content: trimmed, truncated: false };
  }
  return {
    content: `${trimmed.slice(0, PROJECT_KNOWLEDGE_MAX_CHARS)}\n\n…（已截断）`,
    truncated: true,
  };
}

export function buildProjectKnowledgeMetaForWrite(
  priorMeta: ProjectKnowledgeMeta,
  options: ProjectKnowledgeWriteMetaOptions = {},
): ProjectKnowledgeMeta {
  const now = new Date().toISOString();
  const newExploreRounds = options.fromExplore
    ? (options.exploreRounds ?? (priorMeta.exploreRounds ?? 0) + 1)
    : priorMeta.exploreRounds;
  
  const updateHistory = priorMeta.updateHistory ? [...priorMeta.updateHistory] : [];
  
  if (options.fromExplore && options.charCount != null) {
    updateHistory.push({
      timestamp: now,
      charCount: options.charCount,
      exploreRounds: newExploreRounds ?? 0,
      gitHead: options.gitHead ?? priorMeta.gitHead,
    });
    
    if (updateHistory.length > 50) {
      updateHistory.splice(0, updateHistory.length - 50);
    }
  }

  return {
    updatedAt: now,
    lastExploredAt: options.fromExplore ? now : priorMeta.lastExploredAt,
    exploreRounds: newExploreRounds,
    gitHead: options.gitHead ?? priorMeta.gitHead,
    updateHistory,
  };
}
