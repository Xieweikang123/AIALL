import {
  isProjectMemorySection,
  type ProjectMemorySection,
} from "../src/services/projectMemorySections";

export const MEMORY_PROPOSAL_PREFIX = "【memory_proposal】";

export type MemoryProposalPayload = {
  section: ProjectMemorySection;
  content: string;
};

export function buildMemoryProposalToolResult(payload: MemoryProposalPayload): string {
  const body = JSON.stringify(payload);
  return `${MEMORY_PROPOSAL_PREFIX}${body}\n已向用户提议写入项目记忆（## ${payload.section}），待用户确认后才会落盘。`;
}

export function parseMemoryProposalToolResult(result: string): MemoryProposalPayload | null {
  const trimmed = result.trim();
  const prefixIdx = trimmed.indexOf(MEMORY_PROPOSAL_PREFIX);
  if (prefixIdx < 0) return null;
  const jsonStart = prefixIdx + MEMORY_PROPOSAL_PREFIX.length;
  const jsonEnd = trimmed.indexOf("\n", jsonStart);
  const jsonText = (jsonEnd >= 0 ? trimmed.slice(jsonStart, jsonEnd) : trimmed.slice(jsonStart)).trim();
  try {
    const parsed = JSON.parse(jsonText) as { section?: string; content?: string };
    const section = String(parsed.section ?? "").trim();
    const content = String(parsed.content ?? "").trim();
    if (!isProjectMemorySection(section) || !content) return null;
    if (content.length > 240) return null;
    return { section, content };
  } catch {
    return null;
  }
}
