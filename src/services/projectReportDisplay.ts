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
