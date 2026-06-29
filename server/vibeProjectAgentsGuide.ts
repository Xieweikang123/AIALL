import fs from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "./vibeFs";

/** Project-root agent guide (terminology, structure, session paths). */
export const AGENTS_MD_REL_PATH = "AGENTS.md";

export const SPEC_FILENAMES = ["CLAUDE.md", ".cursorrules", "AGENTS.md"] as const;

/** Keep injected guide compact — high-signal sections only. */
export const AGENTS_GUIDE_MAX_CHARS = 4_000;

/** Section headings omitted from runtime agent prompt (developer / orchestration meta). */
const RUNTIME_SECTION_BLOCKLIST: RegExp[] = [
  /Agent\s*编排/i,
  /^开发约定$/,
  /调试准则/,
];

export interface ProjectAgentGuideFileResult {
  filename: string;
  content: string;
  truncated: boolean;
}

export type ProjectAgentsGuideReadResult =
  | {
      ok: true;
      files: ProjectAgentGuideFileResult[];
      content: string; // Merged content for backward compatibility
      truncated: boolean; // True if any file was truncated
      path: string; // List of read files, e.g. "CLAUDE.md, .cursorrules, AGENTS.md"
      maxChars: number;
    }
  | { ok: false; error: string };

const guideCache = new Map<string, { builtAt: number; result: ProjectAgentsGuideReadResult }>();
const GUIDE_CACHE_TTL_MS = 30_000;

export function isBlockedAgentsGuideSection(title: string): boolean {
  const t = title.trim();
  return RUNTIME_SECTION_BLOCKLIST.some((re) => re.test(t));
}

/** Extract agent-runtime sections from the markdown file. */
export function extractAgentsGuideForPrompt(markdown: string, filename?: string): { content: string; truncated: boolean } {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { content: "", truncated: false };

  const isAgentsMd = filename === undefined || filename === "AGENTS.md";
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
    if (isAgentsMd && isBlockedAgentsGuideSection(titleLine)) continue;
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

export function formatAgentsGuideForPrompt(
  contentOrFiles: string | ProjectAgentGuideFileResult[],
  truncated = false
): string {
  if (Array.isArray(contentOrFiles)) {
    const activeFiles = contentOrFiles.filter((f) => f.content.trim());
    if (activeFiles.length === 0) return "";

    const lines: string[] = [];
    for (const file of activeFiles) {
      lines.push(
        "",
        `项目规范与指南（${file.filename} 中的约定；用户最新消息与之冲突时以用户为准）：`,
        "```markdown",
        file.content.trim(),
        "```"
      );
      if (file.truncated) {
        lines.push(`（该文件已截断，完整内容见项目根目录的 ${file.filename}）`);
      }
    }
    return lines.join("\n");
  }

  const body = contentOrFiles.trim();
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

  const files: ProjectAgentGuideFileResult[] = [];
  const readPaths: string[] = [];
  let anyTruncated = false;

  for (const filename of SPEC_FILENAMES) {
    const resolved = resolveProjectPath(resolvedRoot, filename);
    if (!resolved.ok) {
      continue;
    }

    try {
      const stats = await fs.promises.stat(resolved.path);
      if (!stats.isFile()) {
        continue;
      }

      const raw = await fs.promises.readFile(resolved.path, "utf-8");
      const { content, truncated } = extractAgentsGuideForPrompt(raw, filename);
      files.push({
        filename,
        content,
        truncated,
      });
      readPaths.push(filename);
      if (truncated) {
        anyTruncated = true;
      }
    } catch {
      // File doesn't exist or is not readable, skip silently
    }
  }

  // Create merged content for backward compatibility
  const mergedContent = files.map((f) => f.content).join("\n\n").trim();

  const result: ProjectAgentsGuideReadResult = {
    ok: true,
    files,
    content: mergedContent,
    truncated: anyTruncated,
    path: readPaths.join(", ") || AGENTS_MD_REL_PATH,
    maxChars: AGENTS_GUIDE_MAX_CHARS,
  };

  guideCache.set(resolvedRoot, { builtAt: Date.now(), result });
  return result;
}

