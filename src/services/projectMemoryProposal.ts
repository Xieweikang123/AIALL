export const MEMORY_PROPOSAL_PREFIX = "【memory_proposal】";

export type MemoryProposalPayload = {
  section: "术语" | "导航" | "偏好";
  content: string;
};

export type PendingMemoryProposal = MemoryProposalPayload & {
  id: string;
  applied?: boolean;
};

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
    if (section !== "术语" && section !== "导航" && section !== "偏好") return null;
    if (!content || content.length > 240) return null;
    return { section, content };
  } catch {
    return null;
  }
}
