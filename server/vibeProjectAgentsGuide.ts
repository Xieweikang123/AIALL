import fs from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "./vibeFs";

/** Project-root agent guide (terminology, structure, session paths). */
export const AGENTS_MD_REL_PATH = "AGENTS.md";

/** Keep injected guide compact — high-signal sections only. */
export const AGENTS_GUIDE_MAX_CHARS = 4_000;

/** Section headings omitted from runtime agent prompt (developer / orchestration meta). */
const RUNTIME_SECTION_BLOCKLIST: RegExp[] = [
  /Agent\s*编排/i,
  /^开发约定$/,
  /调试准则/,
];

export type ProjectAgentsGuideReadResult =
  | { ok: true; content: string; truncated: boolean; path: string; maxChars: number }
  | { ok: false; error: string };

const guideCache = new Map<string, { builtAt: number; result: ProjectAgentsGuideReadResult }>();
const GUIDE_CACHE_TTL_MS = 30_000;

export function isBlockedAgentsGuideSection(title: string): boolean {
  const t = title.trim();
  return RUNTIME_SECTION_BLOCKLIST.some((re) => re.test(t));
}

/** Extract agent-runtime sections from AGENTS.md (terminology preamble + non-blocklisted ## sections). */
export function extractAgentsGuideForPrompt(markdown: string): { content: string; truncated: boolean } {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { content: "", truncated: false };

  const parts = normalized.split(/\n(?=## )/);
  const sections: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    if (i === 0) {
      sections.push(part);
      continue;
    }
    const titleLine = part.match(/^## (.+)$/m)?.[1] ?? "";
    if (isBlockedAgentsGuideSection(titleLine)) continue;
    sections.push(part);
  }

  let content = sections.join("\n\n").trim();
  if (content.length <= AGENTS_GUIDE_MAX_CHARS) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, AGENTS_GUIDE_MAX_CHARS)}\n\n…（已截断）`,
    truncated: true,
  };
}

export function formatAgentsGuideForPrompt(content: string, truncated = false): string {
  const body = content.trim();
  if (!body) return "";

  const lines = [
    "",
    "项目 Agent 指南（AGENTS.md 中的术语与结构约定；用户消息与之冲突时以用户最新消息为准）：",
    "```markdown",
    body,
    "```",
  ];
  if (truncated) {
    lines.push("", `（指南已截断，完整内容见 ${AGENTS_MD_REL_PATH}）`);
  }
  return lines.join("\n");
}

export function invalidateProjectAgentsGuideCache(projectPath?: string): void {
  if (!projectPath) {
    guideCache.clear();
    return;
  }
  guideCache.delete(path.resolve(projectPath));
}

export async function readProjectAgentsGuide(projectRoot: string): Promise<ProjectAgentsGuideReadResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const cached = guideCache.get(resolvedRoot);
  if (cached && Date.now() - cached.builtAt < GUIDE_CACHE_TTL_MS) {
    return cached.result;
  }

  const resolved = resolveProjectPath(resolvedRoot, AGENTS_MD_REL_PATH);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(resolved.path, "utf-8");
  } catch {
    const empty: ProjectAgentsGuideReadResult = {
      ok: true,
      content: "",
      truncated: false,
      path: AGENTS_MD_REL_PATH,
      maxChars: AGENTS_GUIDE_MAX_CHARS,
    };
    guideCache.set(resolvedRoot, { builtAt: Date.now(), result: empty });
    return empty;
  }

  const { content, truncated } = extractAgentsGuideForPrompt(raw);
  const result: ProjectAgentsGuideReadResult = {
    ok: true,
    content,
    truncated,
    path: AGENTS_MD_REL_PATH,
    maxChars: AGENTS_GUIDE_MAX_CHARS,
  };
  guideCache.set(resolvedRoot, { builtAt: Date.now(), result });
  return result;
}
