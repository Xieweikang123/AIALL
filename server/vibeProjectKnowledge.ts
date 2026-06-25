import fs from "node:fs";
import path from "node:path";
import { PROJECT_KNOWLEDGE_MARKER, PROJECT_KNOWLEDGE_TITLE } from "./agentExplorePrompt";
import { resolveProjectPath } from "./vibeFs";

/** Relative to project root; listed in .gitignore by default. */
export const PROJECT_KNOWLEDGE_REL_PATH = ".aiall/project-knowledge.md";

/** Max chars for Ask/Build prompt injection. */
export const PROJECT_KNOWLEDGE_PROMPT_MAX_CHARS = 8_000;

/** Max chars stored on disk (soft cap for manual edits). */
export const PROJECT_KNOWLEDGE_MAX_CHARS = 120_000;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export type ProjectKnowledgeMeta = {
  updatedAt?: string;
  lastExploredAt?: string;
  exploreRounds?: number;
  gitHead?: string;
};

export type ProjectKnowledgeReadResult =
  | {
      ok: true;
      content: string;
      body: string;
      meta: ProjectKnowledgeMeta;
      truncated: boolean;
      path: string;
      maxChars: number;
      promptMaxChars: number;
    }
  | { ok: false; error: string };

export type ProjectKnowledgeWriteResult =
  | { ok: true; path: string; size: number; truncated: boolean; meta: ProjectKnowledgeMeta }
  | { ok: false; error: string };

export type ProjectKnowledgeWriteOptions = {
  gitHead?: string;
  fromExplore?: boolean;
  exploreRounds?: number;
};

const knowledgeCache = new Map<string, { builtAt: number; result: ProjectKnowledgeReadResult }>();
const KNOWLEDGE_CACHE_TTL_MS = 30_000;

export function resolveProjectKnowledgeAbsolutePath(projectRoot: string): string | null {
  const resolved = resolveProjectPath(projectRoot, PROJECT_KNOWLEDGE_REL_PATH);
  if (!resolved.ok) return null;
  return resolved.path;
}

export function parseProjectKnowledgeFrontmatter(raw: string): {
  meta: ProjectKnowledgeMeta;
  body: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) {
    return { meta: {}, body: normalized.trim() };
  }

  const metaBlock = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const meta: ProjectKnowledgeMeta = {};

  const updatedAt = metaBlock.match(/^updatedAt:\s*(.+)\s*$/m)?.[1]?.trim();
  const lastExploredAt = metaBlock.match(/^lastExploredAt:\s*(.+)\s*$/m)?.[1]?.trim();
  const exploreRoundsRaw = metaBlock.match(/^exploreRounds:\s*(\d+)\s*$/m)?.[1];
  const gitHead = metaBlock.match(/^gitHead:\s*(.+)\s*$/m)?.[1]?.trim();

  if (updatedAt) meta.updatedAt = updatedAt;
  if (lastExploredAt) meta.lastExploredAt = lastExploredAt;
  if (exploreRoundsRaw) meta.exploreRounds = Number(exploreRoundsRaw);
  if (gitHead) meta.gitHead = gitHead;

  return { meta, body };
}

export function serializeProjectKnowledgeFrontmatter(
  meta: ProjectKnowledgeMeta,
  body: string,
): string {
  const lines = ["---"];
  if (meta.updatedAt) lines.push(`updatedAt: ${meta.updatedAt}`);
  if (meta.lastExploredAt) lines.push(`lastExploredAt: ${meta.lastExploredAt}`);
  if (meta.exploreRounds != null) lines.push(`exploreRounds: ${meta.exploreRounds}`);
  if (meta.gitHead) lines.push(`gitHead: ${meta.gitHead}`);
  lines.push("---", "", body.trim());
  return `${lines.join("\n")}\n`;
}

export function normalizeProjectKnowledgeBody(raw: string): { content: string; truncated: boolean } {
  const trimmed = raw.replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= PROJECT_KNOWLEDGE_MAX_CHARS) {
    return { content: trimmed, truncated: false };
  }
  return {
    content: `${trimmed.slice(0, PROJECT_KNOWLEDGE_MAX_CHARS)}\n\n…（已截断）`,
    truncated: true,
  };
}

export function isProjectKnowledgeBody(content: string): boolean {
  return (
    content.includes(PROJECT_KNOWLEDGE_MARKER)
    || content.includes("<!-- project-report -->")
    || content.includes(`# ${PROJECT_KNOWLEDGE_TITLE}`)
    || content.includes("# 项目理解报告")
  );
}

export function truncateKnowledgeForPrompt(body: string, maxChars = PROJECT_KNOWLEDGE_PROMPT_MAX_CHARS): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;

  const sections = trimmed.split(/\n(?=## )/);
  const summary = sections.find((s) => /##\s*一句话摘要/.test(s));
  const structure = sections.find((s) => /##\s*目录结构/.test(s));
  const modules = sections.find((s) => /##\s*核心模块/.test(s));

  const parts = [summary, structure, modules].filter(Boolean) as string[];
  const compact = parts.join("\n\n").trim();
  if (compact && compact.length <= maxChars) return compact;
  return `${trimmed.slice(0, maxChars)}\n\n…（知识库已截断）`;
}

export async function formatProjectKnowledgeForPrompt(
  body: string,
  truncated = false,
): Promise<string> {
  const filtered = truncateKnowledgeForPrompt(body);
  if (!filtered.trim()) return "";

  const lines = [
    "",
    "项目知识库（只读探索生成的项目理解，请优先参考；与当前任务冲突时以用户最新消息与代码为准）：",
    "```markdown",
    filtered,
    "```",
  ];
  if (truncated) {
    lines.push("", `（项目知识库已截断，完整内容见 ${PROJECT_KNOWLEDGE_REL_PATH}）`);
  }
  return lines.join("\n");
}

export function invalidateProjectKnowledgeCache(projectPath?: string): void {
  if (!projectPath) {
    knowledgeCache.clear();
    return;
  }
  knowledgeCache.delete(path.resolve(projectPath));
}

export async function readProjectKnowledge(projectRoot: string): Promise<ProjectKnowledgeReadResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const cached = knowledgeCache.get(resolvedRoot);
  if (cached && Date.now() - cached.builtAt < KNOWLEDGE_CACHE_TTL_MS) {
    return cached.result;
  }

  const absPath = resolveProjectKnowledgeAbsolutePath(resolvedRoot);
  if (!absPath) {
    return { ok: false, error: "无效的项目路径" };
  }

  let raw = "";
  try {
    raw = await fs.promises.readFile(absPath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const result: ProjectKnowledgeReadResult = {
        ok: true,
        content: "",
        body: "",
        meta: {},
        truncated: false,
        path: PROJECT_KNOWLEDGE_REL_PATH,
        maxChars: PROJECT_KNOWLEDGE_MAX_CHARS,
        promptMaxChars: PROJECT_KNOWLEDGE_PROMPT_MAX_CHARS,
      };
      knowledgeCache.set(resolvedRoot, { builtAt: Date.now(), result });
      return result;
    }
    return { ok: false, error: error instanceof Error ? error.message : "读取项目知识库失败" };
  }

  const { meta, body } = parseProjectKnowledgeFrontmatter(raw);
  const normalized = normalizeProjectKnowledgeBody(body);
  const content = serializeProjectKnowledgeFrontmatter(meta, normalized.content);
  const result: ProjectKnowledgeReadResult = {
    ok: true,
    content,
    body: normalized.content,
    meta,
    truncated: normalized.truncated,
    path: PROJECT_KNOWLEDGE_REL_PATH,
    maxChars: PROJECT_KNOWLEDGE_MAX_CHARS,
    promptMaxChars: PROJECT_KNOWLEDGE_PROMPT_MAX_CHARS,
  };
  knowledgeCache.set(resolvedRoot, { builtAt: Date.now(), result });
  return result;
}

export async function writeProjectKnowledge(
  projectRoot: string,
  body: string,
  options: ProjectKnowledgeWriteOptions = {},
): Promise<ProjectKnowledgeWriteResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const absPath = resolveProjectKnowledgeAbsolutePath(resolvedRoot);
  if (!absPath) {
    return { ok: false, error: "无效的项目路径" };
  }

  const current = await readProjectKnowledge(resolvedRoot);
  const priorMeta = current.ok ? current.meta : {};
  const now = new Date().toISOString();
  const normalized = normalizeProjectKnowledgeBody(body);

  const meta: ProjectKnowledgeMeta = {
    updatedAt: now,
    lastExploredAt: options.fromExplore ? now : priorMeta.lastExploredAt,
    exploreRounds: options.fromExplore
      ? (options.exploreRounds ?? (priorMeta.exploreRounds ?? 0) + 1)
      : priorMeta.exploreRounds,
    gitHead: options.gitHead ?? priorMeta.gitHead,
  };

  const fileContent = serializeProjectKnowledgeFrontmatter(meta, normalized.content);
  const dir = path.dirname(absPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(absPath, fileContent, "utf-8");

  invalidateProjectKnowledgeCache(resolvedRoot);

  return {
    ok: true,
    path: PROJECT_KNOWLEDGE_REL_PATH,
    size: Buffer.byteLength(fileContent, "utf-8"),
    truncated: normalized.truncated,
    meta,
  };
}
