export const SKILL_KINDS = ["fact", "heuristic", "preference"] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

export type SkillFrontmatter = {
  kind: SkillKind;
  title: string;
  updatedAt?: string;
};

export type SkillIndexEntry = {
  slug: string;
  kind: SkillKind;
  title: string;
  path: string;
  updatedAt: string;
};

export type ExplorationIndexEntry = {
  id: string;
  path: string;
  createdAt: string;
  readCount: number;
  writtenCount: number;
};

export type ProjectSkillsIndex = {
  version: 1;
  updatedAt: string;
  skills: SkillIndexEntry[];
  exploration: ExplorationIndexEntry[];
};

export const PROJECT_SKILLS_DIR = ".aiall/skills";
export const PROJECT_EXPLORATION_DIR = ".aiall/exploration";
export const PROJECT_SKILLS_INDEX_REL = ".aiall/skills/index.json";

export const SKILLS_PROMPT_MAX_CHARS = 2_000;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function isSkillKind(value: string): value is SkillKind {
  return (SKILL_KINDS as readonly string[]).includes(value);
}

export function slugifySkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function parseSkillMarkdown(raw: string): { frontmatter: SkillFrontmatter; body: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) return null;

  const metaBlock = match[1];
  const body = match[2].trim();
  const kindMatch = metaBlock.match(/^kind:\s*(\w+)\s*$/m);
  const titleMatch = metaBlock.match(/^title:\s*(.+)\s*$/m);
  const updatedMatch = metaBlock.match(/^updatedAt:\s*(.+)\s*$/m);
  const kind = String(kindMatch?.[1] ?? "").trim();
  const title = String(titleMatch?.[1] ?? "").trim();
  if (!isSkillKind(kind) || !title) return null;

  return {
    frontmatter: {
      kind,
      title,
      updatedAt: updatedMatch?.[1]?.trim(),
    },
    body,
  };
}

export function serializeSkillMarkdown(frontmatter: SkillFrontmatter, body: string): string {
  const updatedAt = frontmatter.updatedAt ?? new Date().toISOString();
  const lines = ["---", `kind: ${frontmatter.kind}`, `title: ${frontmatter.title}`, `updatedAt: ${updatedAt}`, "---", "", body.trim(), ""];
  return lines.join("\n");
}

/** Generic built-in heuristics — no project-specific paths. */
export const DEFAULT_PROJECT_SKILLS: Array<{ slug: string; frontmatter: SkillFrontmatter; body: string }> = [
  {
    slug: "ui-screenshot-locate",
    frontmatter: { kind: "heuristic", title: "附图 UI 定位顺序" },
    body: [
      "1. 从截图摘录可见原文（占位符、按钮 title、列表元信息格式）。",
      "2. grep 原文 ≥4 字片段或 kebab-case class；search_files 仅匹配文件名，中文文案用 grep。",
      "3. read_file 核对 template 与截图一致；不一致则换下一个 grep 命中，勿猜组件文件名。",
      "4. patch 的 old_string 必须来自 read_file 返回原文。",
    ].join("\n"),
  },
  {
    slug: "patch-from-read",
    frontmatter: { kind: "heuristic", title: "局部修改前须已读" },
    body: "patch_file 的 old_string 必须来自对该文件的 read_file 片段；禁止凭记忆构造 CSS/DOM。read 内容与截图不符时换文件，勿在同一错误路径反复 patch。",
  },
];

export function emptySkillsIndex(): ProjectSkillsIndex {
  const now = new Date().toISOString();
  return { version: 1, updatedAt: now, skills: [], exploration: [] };
}

export function summarizeSkillForPrompt(title: string, kind: SkillKind, body: string, maxBody = 280): string {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, maxBody);
  return `- [${kind}] ${title}：${snippet}${body.length > maxBody ? "…" : ""}`;
}
