import {
  PROJECT_KNOWLEDGE_MARKER,
  PROJECT_KNOWLEDGE_TITLE,
  PROJECT_REPORT_MARKER,
} from "../../server/agentExplorePrompt";

export type ProjectReportSection = {
  id: string;
  title: string;
  level: number;
};

export type ProjectReportDisplay = {
  isProjectReport: boolean;
  marker: string;
  sections: ProjectReportSection[];
};

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const SKIP_TITLES = new Set([PROJECT_KNOWLEDGE_TITLE, "项目理解报告"]);
const UNEXPLORED_SECTION_RE = /未探索|待验证/;
const SUPPLEMENT_HEADING_RE = /^##\s+补充(?:：|:)/m;

export function isProjectReport(content: string): boolean {
  return (
    content.includes(PROJECT_KNOWLEDGE_MARKER)
    || content.includes(PROJECT_REPORT_MARKER)
  );
}

export function slugifyReportHeading(title: string, index: number): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return `report-${index}-${base || "section"}`;
}

export function parseProjectReportDisplay(content: string): ProjectReportDisplay {
  if (!isProjectReport(content)) {
    return { isProjectReport: false, marker: "", sections: [] };
  }
  const marker = content.includes(PROJECT_KNOWLEDGE_MARKER)
    ? PROJECT_KNOWLEDGE_MARKER
    : PROJECT_REPORT_MARKER;
  const sections: ProjectReportSection[] = [];
  const lines = content.split("\n");
  let index = 0;
  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (!match) continue;
    const level = match[1]!.length;
    if (level > 2) continue;
    const title = match[2]!.trim();
    if (!title || SKIP_TITLES.has(title)) continue;
    sections.push({
      id: slugifyReportHeading(title, index),
      title,
      level,
    });
    index += 1;
  }
  return {
    isProjectReport: true,
    marker,
    sections,
  };
}

export const PROJECT_KNOWLEDGE_REL_PATH = ".aiall/project-knowledge.md";

export type ProjectKnowledgeMetaLite = {
  updatedAt?: string;
  lastExploredAt?: string;
  exploreRounds?: number;
  gitHead?: string;
};

export type KnowledgeSectionBlock = {
  title: string;
  content: string;
  status: "ok" | "unexplored" | "pending";
};

const SECTION_H2_RE = /^##\s+(.+?)(?:\r?\n|$)/;

/** Split body into preamble (marker + h1) and ## sections. */
export function splitKnowledgeSectionBlocks(body: string): {
  preamble: string;
  sections: KnowledgeSectionBlock[];
} {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { preamble: "", sections: [] };

  const parts = normalized.split(/\n(?=## )/);
  const preamble = parts[0]?.match(/^## /) ? "" : (parts[0]?.trim() ?? "");
  const sectionParts = parts[0]?.match(/^## /) ? parts : parts.slice(1);

  const sections: KnowledgeSectionBlock[] = [];
  for (const part of sectionParts) {
    const title = part.match(SECTION_H2_RE)?.[1]?.trim();
    if (!title || title.startsWith("补充")) continue;
    const content = part.replace(SECTION_H2_RE, "").trim();
    const status: KnowledgeSectionBlock["status"] = /未探索/.test(part)
      ? "unexplored"
      : /待验证/.test(part)
        ? "pending"
        : "ok";
    sections.push({ title, content, status });
  }

  return { preamble, sections };
}

export type KnowledgeOverviewStats = {
  charCount: number;
  lineCount: number;
  sectionCount: number;
  coveredSections: number;
  unexploredSections: number;
  pendingSections: number;
  supplementCount: number;
  /** 0–100 when structured sections exist; otherwise null. */
  coveragePercent: number | null;
};

/** Human-readable character count for knowledge base UI. */
export function formatKnowledgeSize(charCount: number): string {
  if (charCount >= 10_000) return `${(charCount / 10_000).toFixed(1)} 万字`;
  if (charCount >= 1000) return `${(charCount / 1000).toFixed(1)}k 字`;
  return `${charCount} 字`;
}

export function computeKnowledgeOverview(body: string): KnowledgeOverviewStats {
  const trimmed = body.replace(/\r\n/g, "\n").trim();
  const charCount = trimmed.length;
  const lineCount = trimmed ? trimmed.split("\n").length : 0;
  const { sections } = splitKnowledgeSectionBlocks(trimmed);

  let coveredSections = 0;
  let unexploredSections = 0;
  let pendingSections = 0;
  for (const section of sections) {
    if (section.status === "ok") coveredSections += 1;
    else if (section.status === "unexplored") unexploredSections += 1;
    else pendingSections += 1;
  }

  const supplementCount = (trimmed.match(/^##\s+补充/mg) ?? []).length;
  const sectionCount = sections.length;
  const coveragePercent =
    sectionCount > 0 ? Math.round((coveredSections / sectionCount) * 100) : null;

  return {
    charCount,
    lineCount,
    sectionCount,
    coveredSections,
    unexploredSections,
    pendingSections,
    supplementCount,
    coveragePercent,
  };
}

function sectionStatusLabel(status: KnowledgeSectionBlock["status"]): string {
  if (status === "unexplored") return "未探索";
  if (status === "pending") return "待验证";
  return "已覆盖";
}

/** Section titles whose body mentions 未探索 or 待验证. */
export function findUnexploredSectionTitles(content: string): string[] {
  const titles: string[] = [];
  for (const part of content.split(/\n(?=## )/)) {
    if (!UNEXPLORED_SECTION_RE.test(part)) continue;
    const title = part.match(/^##\s+(.+?)(?:\r?\n|$)/)?.[1]?.trim();
    if (!title || title.startsWith("补充：")) continue;
    titles.push(title);
  }
  return titles;
}

export function isFullKnowledgeReport(content: string): boolean {
  const trimmed = content.trim();
  return isProjectReport(trimmed) && trimmed.includes(`# ${PROJECT_KNOWLEDGE_TITLE}`);
}

/** True when explore output is an incremental supplement, not a full knowledge base. */
export function isKnowledgeSupplementOutput(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (isFullKnowledgeReport(trimmed)) return false;
  if (SUPPLEMENT_HEADING_RE.test(trimmed)) return true;
  return !isProjectReport(trimmed);
}

/** Compact manifest for Explore system prompt (no full body). */
export function buildKnowledgeExploreManifest(
  body: string,
  meta: ProjectKnowledgeMetaLite,
  options?: { changedPaths?: string[] },
): string {
  const { sections } = splitKnowledgeSectionBlocks(body);
  const lines = [
    "【已有项目知识库·索引】（正文不在上下文中，需要时用 read_file 读取）",
    `路径：${PROJECT_KNOWLEDGE_REL_PATH}`,
  ];
  if (meta.exploreRounds != null) lines.push(`探索轮次：${meta.exploreRounds}`);
  if (meta.lastExploredAt) lines.push(`上次探索：${meta.lastExploredAt}`);
  if (meta.gitHead) lines.push(`基于提交：${meta.gitHead.slice(0, 12)}`);
  if (sections.length) {
    lines.push("", "章节状态：");
    for (const s of sections) {
      lines.push(`- ${s.title}（${sectionStatusLabel(s.status)}）`);
    }
  }
  const unexplored = findUnexploredSectionTitles(body);
  if (unexplored.length) {
    lines.push("", `待补全：${unexplored.join("、")}`);
  }
  if (options?.changedPaths?.length) {
    const shown = options.changedPaths.slice(0, 24);
    lines.push("", `自上次探索以来变更文件（优先核对）：${shown.join("、")}${options.changedPaths.length > shown.length ? "…" : ""}`);
  }
  lines.push(
    "",
    `更新知识库前请先 read_file ${PROJECT_KNOWLEDGE_REL_PATH}（大文件用 offset/limit 分段）；勿重复 read 已在上下文中完整出现的项目扫描摘要。`,
  );
  return lines.join("\n");
}

export function buildKnowledgeRebuildHint(): string {
  return [
    "【重新构建】磁盘上已有旧版知识库。",
    `可选 read_file ${PROJECT_KNOWLEDGE_REL_PATH} 作参考；本次须输出全新完整知识库正文（含 project-knowledge 标记），覆盖旧内容。`,
  ].join("\n");
}

/** Extract primary ## section from incremental explore output. */
export function extractPrimarySectionUpdate(content: string): { title: string; raw: string } | null {
  const trimmed = content.trim();
  if (!trimmed || isFullKnowledgeReport(trimmed)) return null;
  if (isKnowledgeSupplementOutput(trimmed)) return null;

  const parts = trimmed.split(/\n(?=## )/).filter((p) => /^##\s+/.test(p));
  if (parts.length !== 1) return null;
  const title = parts[0]!.match(SECTION_H2_RE)?.[1]?.trim();
  if (!title || title.startsWith("补充")) return null;
  return { title, raw: parts[0]!.trim() };
}

/** Replace one ## section in the knowledge base body. */
export function replaceKnowledgeSection(
  fullBody: string,
  sectionTitle: string,
  newSectionMarkdown: string,
): string {
  const normalized = fullBody.replace(/\r\n/g, "\n").trim();
  const targetTitle = sectionTitle.trim();
  const incoming = newSectionMarkdown.trim();
  const bodyOnly = incoming.replace(SECTION_H2_RE, "").trim();
  const replacement = `## ${targetTitle}\n\n${bodyOnly}`.trim();

  const { preamble, sections } = splitKnowledgeSectionBlocks(normalized);
  if (!sections.length) {
    return preamble ? `${preamble}\n\n${replacement}` : replacement;
  }

  let replaced = false;
  const nextSections = sections.map((section) => {
    if (section.title !== targetTitle) {
      return `## ${section.title}\n\n${section.content}`.trim();
    }
    replaced = true;
    return replacement;
  });

  if (!replaced) {
    nextSections.push(replacement);
  }

  const { parts } = splitRawKnowledgeParts(normalized);
  const supplementParts = parts.filter(isSupplementPart);

  const assembled = [preamble, ...nextSections, ...supplementParts].filter(Boolean).join("\n\n");
  return `${assembled.trim()}\n`;
}

export function mergeSectionUpdatesIntoKnowledge(existingBody: string, newOutput: string): string {
  const normalized = newOutput.replace(/\r\n/g, "\n").trim();
  const parts = normalized.split(/\n(?=## )/).filter((p) => /^##\s+/.test(p));
  if (!parts.length) return existingBody;

  let result = existingBody.trim();
  for (const part of parts) {
    const title = part.match(SECTION_H2_RE)?.[1]?.trim();
    if (!title || title.startsWith("补充")) continue;
    result = replaceKnowledgeSection(result, title, part.trim());
  }
  return result.trim();
}

function tokenizeForSectionMatch(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = lower.match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9._/-]{1,}/gi) ?? [];
  return [...new Set(tokens.filter((t) => t.length >= 2))];
}

function scoreSectionRelevance(section: KnowledgeSectionBlock, incoming: string): number {
  const incomingLower = incoming.toLowerCase();
  const sectionText = `${section.title}\n${section.content}`.toLowerCase();
  let score = 0;
  const titleLower = section.title.toLowerCase();
  if (incomingLower.includes(titleLower)) score += 4;
  for (const token of tokenizeForSectionMatch(section.title)) {
    if (incomingLower.includes(token)) score += 2;
  }
  for (const token of tokenizeForSectionMatch(incoming)) {
    if (sectionText.includes(token)) score += 1;
  }
  if (/[`./\\]|[a-z0-9_/-]+\.[a-z]{2,4}/i.test(incoming) && /目录|结构|路径|文件/.test(section.title)) {
    score += 3;
  }
  return score;
}

function findBestMatchingSection(
  sections: KnowledgeSectionBlock[],
  incoming: string,
): { section: KnowledgeSectionBlock; score: number } | null {
  let best: KnowledgeSectionBlock | null = null;
  let bestScore = 0;
  for (const section of sections) {
    const score = scoreSectionRelevance(section, incoming);
    if (score > bestScore) {
      bestScore = score;
      best = section;
    }
  }
  if (!best || bestScore < 2) return null;
  return { section: best, score: bestScore };
}

function splitRawKnowledgeParts(body: string): { preamble: string; parts: string[] } {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { preamble: "", parts: [] };
  const chunks = normalized.split(/\n(?=## )/);
  const preamble = chunks[0]?.match(/^## /) ? "" : (chunks[0]?.trim() ?? "");
  const parts = (chunks[0]?.match(/^## /) ? chunks : chunks.slice(1))
    .map((p) => p.trim())
    .filter(Boolean);
  return { preamble, parts };
}

function isSupplementPart(part: string): boolean {
  const title = part.match(SECTION_H2_RE)?.[1]?.trim();
  return Boolean(title?.startsWith("补充"));
}

function partSectionTitle(part: string): string {
  return part.match(SECTION_H2_RE)?.[1]?.trim() ?? "";
}

function appendParagraphToSection(existingBody: string, sectionTitle: string, paragraph: string): string {
  const { sections } = splitKnowledgeSectionBlocks(existingBody);
  const section = sections.find((s) => s.title === sectionTitle);
  if (!section) return existingBody;
  const merged = `${section.content}\n\n${paragraph.trim()}`.trim();
  return replaceKnowledgeSection(
    existingBody,
    sectionTitle,
    `## ${sectionTitle}\n\n${merged}`,
  );
}

function insertPartAfterSection(existingBody: string, afterTitle: string | null, part: string): string {
  const trimmedPart = part.trim();
  if (!trimmedPart) return existingBody.trim();

  const { preamble, parts } = splitRawKnowledgeParts(existingBody);
  if (!parts.length) {
    return preamble ? `${preamble}\n\n${trimmedPart}` : trimmedPart;
  }

  const mainParts: string[] = [];
  const supplementParts: string[] = [];
  for (const p of parts) {
    if (isSupplementPart(p)) supplementParts.push(p);
    else mainParts.push(p);
  }

  if (!afterTitle) {
    const assembled = [preamble, ...mainParts, trimmedPart, ...supplementParts].filter(Boolean);
    return `${assembled.join("\n\n").trim()}\n`;
  }

  const nextMain: string[] = [];
  let inserted = false;
  for (const p of mainParts) {
    nextMain.push(p);
    if (!inserted && partSectionTitle(p) === afterTitle) {
      nextMain.push(trimmedPart);
      inserted = true;
    }
  }
  if (!inserted) {
    mainParts.push(trimmedPart);
  }

  const assembled = [preamble, ...(inserted ? nextMain : mainParts), ...supplementParts].filter(Boolean);
  return `${assembled.join("\n\n").trim()}\n`;
}

function parseSupplementSection(content: string): { topic: string; body: string } | null {
  const trimmed = content.trim();
  const match = trimmed.match(/^##\s+补充(?:：|:)\s*(.+?)(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return null;
  return { topic: match[1]!.trim(), body: match[2]!.trim() };
}

function mergeFollowUpIntoBestSection(existingBody: string, incoming: string): string | null {
  const { sections } = splitKnowledgeSectionBlocks(existingBody);
  if (!sections.length) return null;

  const supplement = parseSupplementSection(incoming);
  const matchText = supplement ? `${supplement.topic}\n${supplement.body}` : incoming;
  const best = findBestMatchingSection(sections, matchText);
  if (!best) return null;

  const paragraph = supplement?.body || incoming.trim();
  if (!paragraph) return null;
  return appendParagraphToSection(existingBody, best.section.title, paragraph);
}

function mergeIncrementalFollowUp(existingBody: string, incoming: string): string {
  const mergedIntoSection = mergeFollowUpIntoBestSection(existingBody, incoming);
  if (mergedIntoSection) return mergedIntoSection;

  const { sections } = splitKnowledgeSectionBlocks(existingBody);
  const supplement = parseSupplementSection(incoming);
  const matchText = supplement ? `${supplement.topic}\n${supplement.body}` : incoming;
  const best = findBestMatchingSection(sections, matchText);

  if (isKnowledgeSupplementOutput(incoming)) {
    if (existingBody.includes(incoming.trim())) return existingBody;
    return insertPartAfterSection(existingBody, best?.section.title ?? null, incoming.trim());
  }

  const wrapped = incoming.trim().match(/^##\s+/m)
    ? incoming.trim()
    : `## 补充\n\n${incoming.trim()}`;
  return insertPartAfterSection(existingBody, best?.section.title ?? null, wrapped);
}

/** Merge incremental explore output into existing knowledge base body. */
export function mergeKnowledgeExploreOutput(existingBody: string, newOutput: string): string {
  const existing = existingBody.trim();
  const incoming = newOutput.trim();
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (isFullKnowledgeReport(incoming)) return incoming;

  const sectionUpdate = extractPrimarySectionUpdate(incoming);
  if (sectionUpdate) {
    return mergeSectionUpdatesIntoKnowledge(existing, incoming);
  }

  if (isKnowledgeSupplementOutput(incoming) || incoming.length < existing.length * 0.6) {
    return mergeIncrementalFollowUp(existing, incoming);
  }

  return incoming;
}

export function resolveKnowledgeBodyForSave(
  existingBody: string,
  newOutput: string,
  options?: { intent?: "section_fill" | "continue" | "followup" | "initial" },
): string {
  const incoming = extractReportBodyForArchive(newOutput) || newOutput.trim();
  if (!incoming) return existingBody.trim();
  if (!existingBody.trim()) return incoming;
  if (options?.intent === "section_fill") {
    return mergeSectionUpdatesIntoKnowledge(existingBody, incoming);
  }
  return mergeKnowledgeExploreOutput(existingBody, incoming);
}

export function extractReportBodyForArchive(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (isProjectReport(trimmed)) return trimmed;
  return trimmed;
}

export function stripKnowledgeFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (match?.[1] ?? normalized).trim();
}

/** TOC for knowledge panel: report sections, or fallback to any h1/h2 headings. */
export function parseKnowledgeTocSections(content: string): ProjectReportSection[] {
  const report = parseProjectReportDisplay(content);
  if (report.sections.length > 0) return report.sections;

  const sections: ProjectReportSection[] = [];
  let index = 0;
  for (const line of content.split("\n")) {
    const match = line.match(HEADING_RE);
    if (!match) continue;
    const level = match[1]!.length;
    if (level > 2) continue;
    const title = match[2]!.trim();
    if (!title || SKIP_TITLES.has(title)) continue;
    sections.push({
      id: slugifyReportHeading(title, index),
      title,
      level,
    });
    index += 1;
  }
  return sections;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Plain heading text for TOC ↔ rendered HTML matching (strips tags and markdown backticks). */
export function normalizeHeadingMatchText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headingTitlesMatch(htmlInner: string, sectionTitle: string): boolean {
  return normalizeHeadingMatchText(htmlInner) === normalizeHeadingMatchText(sectionTitle);
}

/** Attach stable ids to rendered h1/h2 so TOC scroll targets match. */
export function injectReportHeadingIds(
  html: string,
  sections: ProjectReportSection[],
): string {
  if (!sections.length) return html;
  let sectionIndex = 0;
  return html.replace(
    /<h([12])(?![^>]*\bid=)([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, level, attrs, inner) => {
      const plain = normalizeHeadingMatchText(inner);
      if (!plain || SKIP_TITLES.has(plain)) return match;
      if (sectionIndex >= sections.length) return match;

      let targetIdx = sectionIndex;
      if (!headingTitlesMatch(inner, sections[targetIdx]!.title)) {
        const found = sections.findIndex(
          (section, index) => index >= sectionIndex && headingTitlesMatch(inner, section.title),
        );
        if (found === -1) return match;
        targetIdx = found;
      }

      const section = sections[targetIdx]!;
      sectionIndex = targetIdx + 1;
      return `<h${level} id="${section.id}"${attrs}>${inner}</h${level}>`;
    },
  );
}

/** Highlight plain-text segments in HTML (skips tag boundaries). */
export function highlightHtmlText(html: string, query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return html;
  const re = new RegExp(escapeRegExp(trimmed), "gi");
  return html
    .split(/(<[^>]+>)/g)
    .map((part) =>
      part.startsWith("<")
        ? part
        : part.replace(re, (m) => `<mark class="knowledge-search-hit">${m}</mark>`),
    )
    .join("");
}

export const KNOWLEDGE_FILE_PATH_IN_CODE_RE =
  /^(?:[\w@.-]+\/)*[\w.-]+\.(?:vue|ts|tsx|js|jsx|scss|css|json|md|html|py|rs|go|toml)$/i;

export function isKnowledgeMarkdownFilePath(text: string): boolean {
  if (!text || text.includes("://") || text.startsWith(".")) return false;
  return KNOWLEDGE_FILE_PATH_IN_CODE_RE.test(text);
}
