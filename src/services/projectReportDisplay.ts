import {
  PROJECT_KNOWLEDGE_MARKER,
  PROJECT_KNOWLEDGE_TITLE,
  PROJECT_REPORT_MARKER,
} from "../../shared/projectKnowledgeFormat";import {
  PROJECT_KNOWLEDGE_REL_PATH,
  stripKnowledgeFrontmatter,
  type ProjectKnowledgeMeta,
} from "../../shared/projectKnowledgeFormat";

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
/** Title suffix flags for gap sections. */
export const TITLE_UNEXPLORED_SUFFIX_RE = /[（(]未探索[）)]\s*$/;
export const TITLE_PENDING_SUFFIX_RE = /[（(]待验证[）)]\s*$/;
/** Standalone body placeholders — not inline prose mentions. */
const BODY_UNEXPLORED_PLACEHOLDER_RE = /^(?:内容)?未探索[。.；;]?\s*$/;
const BODY_PENDING_PLACEHOLDER_RE = /^待验证[。.；;]?\s*$/;
const SECTION_NUMBER_PREFIX_RE = /^([零〇一二三四五六七八九十百千]+)[、．.\s]+/;
const SUPPLEMENT_HEADING_RE = /^##\s+补充(?:：|:)/m;

export function stripSectionTitleGapSuffix(title: string): string {
  return title.replace(/[（(](?:未探索|待验证)[）)]/g, "").trim();
}

function stripSectionNumberPrefix(title: string): string {
  return title.replace(SECTION_NUMBER_PREFIX_RE, "").trim();
}

export function extractSectionNumberPrefix(title: string): string {
  const m = title.match(SECTION_NUMBER_PREFIX_RE);
  return m ? `${m[1]}、` : "";
}

function isGapBodyPlaceholder(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return true;
  return BODY_UNEXPLORED_PLACEHOLDER_RE.test(trimmed)
    || BODY_PENDING_PLACEHOLDER_RE.test(trimmed);
}

export function resolveSectionGapStatus(
  title: string,
  content: string,
): KnowledgeSectionBlock["status"] {
  const body = content.trim();
  if (body && !isGapBodyPlaceholder(body)) return "ok";

  const trimmedTitle = title.trim();
  if (TITLE_UNEXPLORED_SUFFIX_RE.test(trimmedTitle)) return "unexplored";
  if (TITLE_PENDING_SUFFIX_RE.test(trimmedTitle)) return "pending";
  if (!body) return "unexplored";
  if (BODY_UNEXPLORED_PLACEHOLDER_RE.test(body)) return "unexplored";
  if (BODY_PENDING_PLACEHOLDER_RE.test(body)) return "pending";
  return "ok";
}

function formatKnowledgeSectionBlock(block: KnowledgeSectionBlock): string {
  const prefix = extractSectionNumberPrefix(block.title);
  const base = stripSectionTitleGapSuffix(stripSectionNumberPrefix(block.title));
  const heading = prefix ? `${prefix}${base}` : base;
  const status = resolveSectionGapStatus(block.title, block.content);

  if (status === "ok") {
    const body = block.content.trim();
    return body ? `## ${heading}\n\n${body}` : `## ${heading}`;
  }

  const suffix = status === "pending" ? "（待验证）" : "（未探索）";
  if (isGapBodyPlaceholder(block.content)) {
    return `## ${heading}${suffix}`;
  }
  return `## ${heading}${suffix}\n\n${block.content.trim()}`;
}

/** Normalize gap markers to title suffixes; strip suffixes from covered sections. */
export function canonicalizeKnowledgeGapMarkers(body: string): string {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const { preamble, sections } = splitKnowledgeSectionBlocks(normalized);
  const { parts } = splitRawKnowledgeParts(normalized);
  const supplementParts = parts.filter(isSupplementPart);
  const mainFormatted = sections.map(formatKnowledgeSectionBlock);
  const assembled = [preamble, ...mainFormatted, ...supplementParts].filter(Boolean).join("\n\n");
  return `${assembled.trim()}\n`;
}

function resolveReplacementSectionTitle(existingTitle: string, incomingTitle: string): string {
  const prefix = extractSectionNumberPrefix(existingTitle);
  const base = stripSectionTitleGapSuffix(
    stripSectionNumberPrefix(incomingTitle.trim() || existingTitle),
  );
  return prefix ? `${prefix}${base}` : base;
}

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
    const level = match[1]?.length ?? 0;
    if (level > 2) continue;
    const title = match[2]?.trim() ?? "";
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

export { PROJECT_KNOWLEDGE_REL_PATH, stripKnowledgeFrontmatter };

export type ProjectKnowledgeMetaLite = ProjectKnowledgeMeta;

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
    const status = resolveSectionGapStatus(title, content);
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

/** Section titles still marked as gap (unexplored or pending). */
export function findGapSectionTitles(content: string): string[] {
  const titles: string[] = [];
  for (const part of content.split(/\n(?=## )/)) {
    const title = part.match(/^##\s+(.+?)(?:\r?\n|$)/)?.[1]?.trim();
    if (!title || title.startsWith("补充")) continue;
    const body = part.replace(SECTION_H2_RE, "").trim();
    if (resolveSectionGapStatus(title, body) === "ok") continue;
    titles.push(stripTitleNumberPrefix(title));
  }
  return titles;
}

/** @deprecated Use findGapSectionTitles */
export function findUnexploredSectionTitles(content: string): string[] {
  return findGapSectionTitles(content);
}

// A full report must lead with the canonical marker line, immediately followed
// by the H1 title. Anything else (an incremental section, a supplement that
// merely quotes the title in prose, legacy `# 项目理解报告`) is treated as a
// partial update and merged, never a wholesale replacement. Anchor the marker
// to start-of-text so a body that merely *mentions* the marker string cannot
// trip the detector.
export function isFullKnowledgeReport(content: string): boolean {
  const trimmed = content.replace(/\r\n/g, "\n").trimStart();
  if (!trimmed.startsWith(PROJECT_KNOWLEDGE_MARKER)) return false;
  const afterMarker = trimmed.slice(PROJECT_KNOWLEDGE_MARKER.length).replace(/^[\s>]+/, "");
  return new RegExp(`^#\\s+${escapeRegExp(PROJECT_KNOWLEDGE_TITLE)}(\\s|$)`).test(afterMarker);
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
  const unexplored = findGapSectionTitles(body);
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
  const first = parts[0];
  if (!first) return null;
  const title = first.match(SECTION_H2_RE)?.[1]?.trim();
  if (!title || title.startsWith("补充")) return null;
  return { title, raw: first.trim() };
}

const CHINESE_NUM_MAP: Record<string, number> = {
  "零": 0, "〇": 0,
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
  "十一": 11, "十二": 12, "十三": 13, "十四": 14, "十五": 15,
  "十六": 16, "十七": 17, "十八": 18, "十九": 19, "二十": 20,
  "二十一": 21, "二十二": 22, "二十三": 23, "二十四": 24, "二十五": 25,
};

function extractSectionNumber(title: string): number | null {
  const m = title.match(/^([零〇一二三四五六七八九十百千]+)[、．.]/);
  if (!m) return null;
  const num = CHINESE_NUM_MAP[m[1]];
  return num ?? null;
}

function findSectionInsertionIndex(existingSections: string[], newTitle: string): number {
  const newNum = extractSectionNumber(newTitle);
  if (newNum == null) return existingSections.length;
  for (let i = 0; i < existingSections.length; i++) {
    const existingTitle = existingSections[i]?.match(SECTION_H2_RE)?.[1]?.trim() ?? "";
    const existingNum = extractSectionNumber(existingTitle);
    if (existingNum != null && existingNum > newNum) return i;
  }
  return existingSections.length;
}

function stripTitleNumberPrefix(title: string): string {
  return stripSectionTitleGapSuffix(stripSectionNumberPrefix(title));
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
  const incomingTitle = incoming.match(SECTION_H2_RE)?.[1]?.trim() ?? targetTitle;
  const bodyOnly = incoming.replace(SECTION_H2_RE, "").trim();

  const { preamble, sections } = splitKnowledgeSectionBlocks(normalized);
  if (!sections.length) {
    const cleanTitle = stripSectionTitleGapSuffix(stripSectionNumberPrefix(incomingTitle));
    const replacement = `## ${cleanTitle}\n\n${bodyOnly}`.trim();
    return preamble ? `${preamble}\n\n${replacement}` : replacement;
  }

  const targetBase = stripTitleNumberPrefix(targetTitle);
  let replaced = false;
  const nextSections = sections.map((section) => {
    const sectionBase = stripTitleNumberPrefix(section.title);
    if (sectionBase !== targetBase) {
      return `## ${section.title}\n\n${section.content}`.trim();
    }
    replaced = true;
    const cleanTitle = resolveReplacementSectionTitle(section.title, incomingTitle);
    return `## ${cleanTitle}\n\n${bodyOnly}`.trim();
  });

  if (!replaced) {
    const cleanTitle = stripSectionTitleGapSuffix(stripSectionNumberPrefix(incomingTitle));
    const replacement = `## ${cleanTitle}\n\n${bodyOnly}`.trim();
    const insertionIdx = findSectionInsertionIndex(nextSections, targetTitle);
    nextSections.splice(insertionIdx, 0, replacement);
  }

  nextSections.sort((a, b) => {
    const aTitle = a.match(SECTION_H2_RE)?.[1]?.trim() ?? "";
    const bTitle = b.match(SECTION_H2_RE)?.[1]?.trim() ?? "";
    const aNum = extractSectionNumber(aTitle);
    const bNum = extractSectionNumber(bTitle);
    if (aNum != null && bNum != null) return aNum - bNum;
    if (aNum != null) return -1;
    if (bNum != null) return 1;
    return 0;
  });

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
  return canonicalizeKnowledgeGapMarkers(result);
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
  return { topic: (match[1] ?? "").trim(), body: (match[2] ?? "").trim() };
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

  const sectionParts = incoming.split(/\n(?=## )/).filter((p) => /^##\s+/.test(p));
  if (sectionParts.length > 1) {
    return mergeSectionUpdatesIntoKnowledge(existing, incoming);
  }

  return mergeIncrementalFollowUp(existing, incoming);
}

export function resolveKnowledgeBodyForSave(
  existingBody: string,
  newOutput: string,
  options?: { intent?: "section_fill" | "continue" | "followup" | "initial" },
): string {
  const incoming = extractReportBodyForArchive(newOutput) || newOutput.trim();
  if (!incoming) return existingBody.trim();
  if (!existingBody.trim()) return canonicalizeKnowledgeGapMarkers(incoming);

  const merged = options?.intent === "section_fill"
    ? mergeSectionUpdatesIntoKnowledge(existingBody, incoming)
    : mergeKnowledgeExploreOutput(existingBody, incoming);
  return canonicalizeKnowledgeGapMarkers(merged.trim());
}

export function extractReportBodyForArchive(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (isProjectReport(trimmed)) return trimmed;
  return trimmed;
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
    const level = match[1]?.length ?? 0;
    if (level > 2) continue;
    const title = match[2]?.trim() ?? "";
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
