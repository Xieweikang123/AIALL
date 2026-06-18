export const SKILL_PROPOSAL_PREFIX = "【skill_proposal】";

export type SkillProposalPayload = {
  slug: string;
  kind: "fact" | "heuristic" | "preference";
  title: string;
  content: string;
};

export type PendingSkillProposal = SkillProposalPayload & {
  id: string;
  applied?: boolean;
};

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
    const kind = parsed.kind;
    const title = String(parsed.title ?? "").trim();
    const content = String(parsed.content ?? "").trim();
    if (!slug || !title || !content) return null;
    if (kind !== "fact" && kind !== "heuristic" && kind !== "preference") return null;
    if (content.length > 2000) return null;
    return { slug, kind, title, content };
  } catch {
    return null;
  }
}
