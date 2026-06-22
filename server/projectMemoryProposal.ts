import {
  isProjectMemorySection,
  type ProjectMemorySection,
} from "../src/services/projectMemorySections";

export const MEMORY_PROPOSAL_PREFIX = "【memory_proposal】";

/** Priority levels for memory proposals */
export type MemoryProposalPriority = "high" | "medium" | "low";

export type MemoryProposalPayload = {
  section: ProjectMemorySection;
  content: string;
  priority?: MemoryProposalPriority;
  tags?: string[];
};

/** Maximum content length for memory proposals (increased from 240 to 500) */
export const MEMORY_PROPOSAL_MAX_CONTENT_LENGTH = 500;

/**
 * Build a memory proposal tool result message.
 */
export function buildMemoryProposalToolResult(payload: MemoryProposalPayload): string {
  const body = JSON.stringify(payload);
  return `${MEMORY_PROPOSAL_PREFIX}${body}\n已向用户提议写入项目记忆（## ${payload.section}），待用户确认后才会落盘。`;
}

/**
 * Parse a memory proposal tool result.
 * Returns null if invalid or too long.
 */
export function parseMemoryProposalToolResult(result: string): MemoryProposalPayload | null {
  const trimmed = result.trim();
  const prefixIdx = trimmed.indexOf(MEMORY_PROPOSAL_PREFIX);
  if (prefixIdx < 0) return null;
  const jsonStart = prefixIdx + MEMORY_PROPOSAL_PREFIX.length;
  const jsonEnd = trimmed.indexOf("\n", jsonStart);
  const jsonText = (jsonEnd >= 0 ? trimmed.slice(jsonStart, jsonEnd) : trimmed.slice(jsonStart)).trim();
  try {
    const parsed = JSON.parse(jsonText) as {
      section?: string;
      content?: string;
      priority?: string;
      tags?: string[];
    };
    const section = String(parsed.section ?? "").trim();
    const content = String(parsed.content ?? "").trim();
    if (!isProjectMemorySection(section) || !content) return null;
    if (content.length > MEMORY_PROPOSAL_MAX_CONTENT_LENGTH) return null;

    // Validate priority
    let priority: MemoryProposalPriority | undefined;
    if (parsed.priority && ["high", "medium", "low"].includes(parsed.priority)) {
      priority = parsed.priority as MemoryProposalPriority;
    }

    // Validate tags (max 5 tags, each max 20 chars)
    let tags: string[] | undefined;
    if (Array.isArray(parsed.tags)) {
      tags = parsed.tags
        .map(t => String(t).trim())
        .filter(t => t.length > 0 && t.length <= 20)
        .slice(0, 5);
      if (tags.length === 0) tags = undefined;
    }

    return { section, content, priority, tags };
  } catch {
    return null;
  }
}

/**
 * Validate memory proposal content quality.
 * Returns validation result with suggestions.
 */
export function validateMemoryProposal(payload: MemoryProposalPayload): {
  valid: boolean;
  suggestions: string[];
} {
  const suggestions: string[] = [];
  const { content } = payload;

  // Check for empty or too short content
  if (content.length < 10) {
    suggestions.push("内容过短，建议添加更多描述");
  }

  // Check for pure path without description
  const purePathPattern = /^`?[a-z/._-]+\.[a-z]+`?$/i;
  if (purePathPattern.test(content)) {
    suggestions.push("纯路径内容建议添加描述说明");
  }

  // Check for Chinese content (higher quality)
  if (!/[\u4e00-\u9fff]/.test(content)) {
    suggestions.push("建议使用中文描述以提高可读性");
  }

  // Check for actionable keywords
  if (!/(?:应|需|禁止|优先|常用|约定|必须|建议|不要|避免)/.test(content)) {
    suggestions.push("建议添加行动指导（如"应"、"禁止"、"优先"等）");
  }

  return {
    valid: suggestions.length === 0,
    suggestions,
  };
}
