import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PROJECT_SKILLS,
  emptySkillsIndex,
  serializeSkillMarkdown,
  parseSkillMarkdown,
  PROJECT_EXPLORATION_DIR,
  PROJECT_SKILLS_DIR,
  PROJECT_SKILLS_INDEX_REL,
  SKILLS_PROMPT_MAX_CHARS,
  slugifySkillName,
  summarizeSkillForPrompt,
  type ExplorationIndexEntry,
  type ProjectSkillsIndex,
  type SkillFrontmatter,
  type SkillIndexEntry,
  type SkillKind,
} from "../src/services/projectSkills";
import { extractTaskKeywords } from "../src/services/projectMemorySections";
import { resolveProjectPath } from "./vibeFs";

export {
  PROJECT_SKILLS_DIR,
  PROJECT_EXPLORATION_DIR,
  PROJECT_SKILLS_INDEX_REL,
  SKILLS_PROMPT_MAX_CHARS,
};

export type ProjectSkillsListResult =
  | { ok: true; index: ProjectSkillsIndex; skills: SkillIndexEntry[] }
  | { ok: false; error: string };

export type ProjectSkillReadResult =
  | { ok: true; slug: string; path: string; frontmatter: SkillFrontmatter; body: string; raw: string }
  | { ok: false; error: string };

const skillsCache = new Map<string, { builtAt: number; promptBlock: string }>();
const SKILLS_CACHE_TTL_MS = 30_000;

function skillsRoot(projectRoot: string): string | null {
  const resolved = resolveProjectPath(projectRoot, PROJECT_SKILLS_DIR);
  return resolved.ok ? resolved.path : null;
}

function explorationRoot(projectRoot: string): string | null {
  const resolved = resolveProjectPath(projectRoot, PROJECT_EXPLORATION_DIR);
  return resolved.ok ? resolved.path : null;
}

function indexAbsPath(projectRoot: string): string | null {
  const resolved = resolveProjectPath(projectRoot, PROJECT_SKILLS_INDEX_REL);
  return resolved.ok ? resolved.path : null;
}

export function invalidateProjectSkillsCache(projectPath?: string): void {
  if (!projectPath) {
    skillsCache.clear();
    return;
  }
  skillsCache.delete(path.resolve(projectPath));
}

async function readIndexFile(projectRoot: string): Promise<ProjectSkillsIndex> {
  const abs = indexAbsPath(projectRoot);
  if (!abs) return emptySkillsIndex();
  try {
    const raw = await fs.promises.readFile(abs, "utf-8");
    const parsed = JSON.parse(raw) as ProjectSkillsIndex;
    if (parsed?.version === 1 && Array.isArray(parsed.skills)) return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  return emptySkillsIndex();
}

async function writeIndexFile(projectRoot: string, index: ProjectSkillsIndex): Promise<void> {
  const abs = indexAbsPath(projectRoot);
  const root = skillsRoot(projectRoot);
  if (!abs || !root) throw new Error("无效的项目路径");
  await fs.promises.mkdir(root, { recursive: true });
  index.updatedAt = new Date().toISOString();
  await fs.promises.writeFile(abs, JSON.stringify(index, null, 2), "utf-8");
}

async function writeSkillFile(projectRoot: string, slug: string, content: string): Promise<string> {
  const root = skillsRoot(projectRoot);
  if (!root) throw new Error("无效的项目路径");
  await fs.promises.mkdir(root, { recursive: true });
  const rel = `${PROJECT_SKILLS_DIR}/${slug}.md`;
  const resolved = resolveProjectPath(projectRoot, rel);
  if (!resolved.ok) throw new Error(resolved.error);
  await fs.promises.writeFile(resolved.path, content, "utf-8");
  return rel.replace(/\\/g, "/");
}

export async function ensureDefaultProjectSkills(projectRoot: string): Promise<ProjectSkillsIndex> {
  const root = skillsRoot(projectRoot);
  if (!root) return emptySkillsIndex();

  await fs.promises.mkdir(root, { recursive: true });
  let index = await readIndexFile(projectRoot);
  const existingSlugs = new Set(index.skills.map((s) => s.slug));

  for (const skill of DEFAULT_PROJECT_SKILLS) {
    if (existingSlugs.has(skill.slug)) continue;
    const relPath = await writeSkillFile(
      projectRoot,
      skill.slug,
      serializeSkillMarkdown({ ...skill.frontmatter, updatedAt: new Date().toISOString() }, skill.body),
    );
    const entry: SkillIndexEntry = {
      slug: skill.slug,
      kind: skill.frontmatter.kind,
      title: skill.frontmatter.title,
      path: relPath,
      updatedAt: new Date().toISOString(),
    };
    index.skills.push(entry);
    existingSlugs.add(skill.slug);
  }

  if (index.skills.length) {
    await writeIndexFile(projectRoot, index);
  }
  return index;
}

export async function listProjectSkills(projectRoot: string): Promise<ProjectSkillsListResult> {
  try {
    const index = await ensureDefaultProjectSkills(projectRoot);
    return { ok: true, index, skills: index.skills };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "读取 skills 失败" };
  }
}

export async function readProjectSkill(projectRoot: string, slug: string): Promise<ProjectSkillReadResult> {
  const safeSlug = slugifySkillName(slug);
  if (!safeSlug) return { ok: false, error: "无效的 skill 名称" };

  const rel = `${PROJECT_SKILLS_DIR}/${safeSlug}.md`;
  const resolved = resolveProjectPath(projectRoot, rel);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  let raw: string;
  try {
    raw = await fs.promises.readFile(resolved.path, "utf-8");
  } catch {
    return { ok: false, error: `skill 不存在：${safeSlug}` };
  }

  const parsed = parseSkillMarkdown(raw);
  if (!parsed) return { ok: false, error: "skill 文件 frontmatter 无效" };

  return {
    ok: true,
    slug: safeSlug,
    path: rel,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    raw,
  };
}

export function formatSkillsForPrompt(
  skills: SkillIndexEntry[],
  bodies: Map<string, string>,
  injectKinds: SkillKind[] = ["fact", "heuristic"],
  taskContext?: string,
): { content: string; truncated: boolean } {
  const keywords = taskContext ? extractTaskKeywords(taskContext) : new Set<string>();
  const lines: string[] = [];
  let used = 0;
  let truncated = false;

  let bestRelevantSlug = "";
  let bestScore = 0;
  if (keywords.size > 0) {
    for (const entry of skills) {
      if (!injectKinds.includes(entry.kind)) continue;
      const body = bodies.get(entry.slug) ?? "";
      const text = `${entry.title} ${body}`.toLowerCase();
      let hits = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) hits++;
      }
      if (hits > bestScore) {
        bestScore = hits;
        bestRelevantSlug = entry.slug;
      }
    }
  }

  for (const entry of skills) {
    if (!injectKinds.includes(entry.kind)) continue;
    const body = bodies.get(entry.slug) ?? "";

    if (entry.slug === bestRelevantSlug && bestScore > 0) {
      const fullBlock = `### ${entry.title} [${entry.kind}]（完整）\n${body}`;
      if (used + fullBlock.length + 1 > SKILLS_PROMPT_MAX_CHARS) {
        truncated = true;
        break;
      }
      used += fullBlock.length + 1;
      lines.push(fullBlock);
    } else {
      const line = summarizeSkillForPrompt(entry.title, entry.kind, body);
      if (used + line.length > SKILLS_PROMPT_MAX_CHARS) {
        truncated = true;
        break;
      }
      lines.push(line);
      used += line.length + 1;
    }
  }

  if (!lines.length) return { content: "", truncated: false };

  return {
    content: [
      "",
      "项目 Skills（skill 目录中的可复用约定；冲突时以用户最新消息为准）：",
      "```markdown",
      lines.join("\n"),
      "```",
      "按需 read_skill(slug) 读取完整内容；list_skills 列出全部。",
    ].join("\n"),
    truncated,
  };
}

export async function buildProjectSkillsPromptBlock(
  projectRoot: string,
  taskContext?: string,
): Promise<string> {
  const resolvedRoot = path.resolve(projectRoot);
  const cached = skillsCache.get(resolvedRoot);
  if (cached && Date.now() - cached.builtAt < SKILLS_CACHE_TTL_MS) {
    return cached.promptBlock;
  }

  const listed = await listProjectSkills(projectRoot);
  if (!listed.ok || !listed.skills.length) {
    skillsCache.set(resolvedRoot, { builtAt: Date.now(), promptBlock: "" });
    return "";
  }

  const bodies = new Map<string, string>();
  for (const entry of listed.skills) {
    const read = await readProjectSkill(projectRoot, entry.slug);
    if (read.ok) bodies.set(entry.slug, read.body);
  }

  const { content } = formatSkillsForPrompt(listed.skills, bodies, ["fact", "heuristic"], taskContext);
  skillsCache.set(resolvedRoot, { builtAt: Date.now(), promptBlock: content });
  return content;
}

const EXPLORATION_ARCHIVE_PROMPT_MAX_CHARS = 1_500;
const MAX_RELEVANT_ARCHIVES = 3;

function scoreExplorationEntry(
  entry: ExplorationIndexEntry,
  keywords: Set<string>,
): number {
  if (keywords.size === 0) return 0;
  const id = entry.id.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (id.includes(kw)) score += 2;
  }
  const recencyMs = Date.now() - new Date(entry.createdAt).getTime();
  const recencyBoost = Math.max(0, 1 - recencyMs / (7 * 24 * 60 * 60 * 1000));
  score += recencyBoost;
  score += Math.min(entry.readCount, 5) * 0.1;
  return score;
}

export async function buildExplorationArchivePromptBlock(
  projectRoot: string,
  taskContext?: string,
): Promise<string> {
  if (!taskContext?.trim()) return "";
  const keywords = extractTaskKeywords(taskContext);
  if (keywords.size === 0) return "";

  const index = await readIndexFile(projectRoot);
  if (!index.exploration.length) return "";

  const scored = index.exploration
    .map((entry) => ({ entry, score: scoreExplorationEntry(entry, keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELEVANT_ARCHIVES);

  if (!scored.length) return "";

  const blocks: string[] = [];
  let used = 0;
  for (const { entry } of scored) {
    const resolved = resolveProjectPath(projectRoot, entry.path);
    if (!resolved.ok) continue;
    let content: string;
    try {
      content = await fs.promises.readFile(resolved.path, "utf-8");
    } catch {
      continue;
    }
    const snippet = content.replace(/^---[\s\S]*?---\n?/, "").trim().slice(0, 400);
    const block = `### ${entry.id}（读${entry.readCount}·写${entry.writtenCount}）\n${snippet}`;
    if (used + block.length + 2 > EXPLORATION_ARCHIVE_PROMPT_MAX_CHARS) break;
    used += block.length + 2;
    blocks.push(block);
  }

  if (!blocks.length) return "";

  return [
    "",
    "历史探索经验（与当前任务相关的过往快照，供参考）：",
    "```markdown",
    blocks.join("\n\n"),
    "```",
  ].join("\n");
}

export async function upsertProjectSkill(
  projectRoot: string,
  slug: string,
  frontmatter: SkillFrontmatter,
  body: string,
): Promise<{ ok: true; path: string; slug: string } | { ok: false; error: string }> {
  try {
    const safeSlug = slugifySkillName(slug || frontmatter.title);
    if (!safeSlug) return { ok: false, error: "无效的 skill slug" };

    const relPath = await writeSkillFile(
      projectRoot,
      safeSlug,
      serializeSkillMarkdown({ ...frontmatter, updatedAt: new Date().toISOString() }, body),
    );

    const index = await readIndexFile(projectRoot);
    const now = new Date().toISOString();
    const existing = index.skills.findIndex((s) => s.slug === safeSlug);
    const entry: SkillIndexEntry = {
      slug: safeSlug,
      kind: frontmatter.kind,
      title: frontmatter.title,
      path: relPath,
      updatedAt: now,
    };
    if (existing >= 0) index.skills[existing] = entry;
    else index.skills.push(entry);
    await writeIndexFile(projectRoot, index);
    invalidateProjectSkillsCache(projectRoot);

    return { ok: true, path: relPath, slug: safeSlug };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "写入 skill 失败" };
  }
}

export async function archiveExplorationNote(
  projectRoot: string,
  filename: string,
  content: string,
  meta: { readCount: number; writtenCount: number },
): Promise<{ ok: true; path: string; id: string } | { ok: false; error: string }> {
  try {
    const root = explorationRoot(projectRoot);
    if (!root) return { ok: false, error: "无效的项目路径" };
    await fs.promises.mkdir(root, { recursive: true });

    const safeName = filename.replace(/[^\w.-]/g, "-").slice(0, 80);
    const rel = `${PROJECT_EXPLORATION_DIR}/${safeName}`;
    const resolved = resolveProjectPath(projectRoot, rel);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    await fs.promises.writeFile(resolved.path, content, "utf-8");

    const index = await readIndexFile(projectRoot);
    const id = safeName.replace(/\.md$/i, "");
    const entry: ExplorationIndexEntry = {
      id,
      path: rel.replace(/\\/g, "/"),
      createdAt: new Date().toISOString(),
      readCount: meta.readCount,
      writtenCount: meta.writtenCount,
    };
    index.exploration = [entry, ...index.exploration.filter((e) => e.id !== id)].slice(0, 40);
    await writeIndexFile(projectRoot, index);
    invalidateProjectSkillsCache(projectRoot);

    return { ok: true, path: rel.replace(/\\/g, "/"), id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "归档探索快照失败" };
  }
}
