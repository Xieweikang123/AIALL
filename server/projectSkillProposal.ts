import {
  isSkillKind,
  type SkillFrontmatter,
  type SkillKind,
} from "../src/services/projectSkills";

export const SKILL_PROPOSAL_PREFIX = "【skill_proposal】";

export type SkillProposalPayload = {
  slug: string;
  kind: SkillKind;
  title: string;
  content: string;
};

export function buildSkillProposalToolResult(payload: SkillProposalPayload): string {
  const body = JSON.stringify(payload);
  return `${SKILL_PROPOSAL_PREFIX}${body}\n已向用户提议写入/更新 skill「${payload.slug}」（kind: ${payload.kind}），待用户确认后才会落盘。`;
}

export function parseSkillProposalToolResult(result: string): SkillProposalPayload | null {
  const trimmed = result.trim();
  const prefixIdx = trimmed.indexOf(SKILL_PROPOSAL_PREFIX);
  if (prefixIdx < 0) return null;
  const jsonStart = prefixIdx + SKILL_PROPOSAL_PREFIX.length;
  const jsonEnd = trimmed.indexOf("\n", jsonStart);
  const jsonText = (jsonEnd >= 0 ? trimmed.slice(jsonStart, jsonEnd) : trimmed.slice(jsonStart)).trim();
  try {
    const parsed = JSON.parse(jsonText) as SkillProposalPayload;
    const slug = String(parsed.slug ?? "").trim();
    const kind = String(parsed.kind ?? "").trim();
    const title = String(parsed.title ?? "").trim();
    const content = String(parsed.content ?? "").trim();
    if (!slug || !title || !content || !isSkillKind(kind)) return null;
    if (content.length > 2000) return null;
    return { slug, kind, title, content };
  } catch {
    return null;
  }
}
