import fs from "node:fs";
import path from "node:path";
import {
  buildArchitectReviewMetaForWrite,
  normalizeArchitectReviewBody,
  parseArchitectReviewFrontmatter,
  parseArchitectReviewVerdictFromBody,
  PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
  PROJECT_ARCHITECT_REVIEW_REL_PATH,
  serializeArchitectReviewFrontmatter,
  type ArchitectReviewMeta,
  type ArchitectReviewWriteMetaOptions,
} from "../shared/projectArchitectReviewFormat";
import type { ArchitectReviewContextBundle } from "../shared/projectArchitectReview";
import { resolveProjectPath } from "./vibeFs";
import { buildProjectContext } from "./vibeProjectContext";
import { gitChangedFilesSince, gitHead, gitLog } from "./vibeGit";
import { readProjectKnowledge, truncateKnowledgeForPrompt } from "./vibeProjectKnowledge";

export {
  PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
  PROJECT_ARCHITECT_REVIEW_REL_PATH,
  type ArchitectReviewMeta,
};

const REVIEW_CACHE_TTL_MS = 30_000;
const reviewCache = new Map<string, { builtAt: number; result: ArchitectReviewReadResult }>();

const RECENT_COMMIT_COUNT = 12;
const KNOWLEDGE_EXCERPT_MAX_CHARS = 4_000;
const CHANGED_FILES_MAX = 80;

export type ArchitectReviewReadResult =
  | {
      ok: true;
      content: string;
      body: string;
      meta: ArchitectReviewMeta;
      truncated: boolean;
      path: string;
      maxChars: number;
    }
  | { ok: false; error: string };

export type ArchitectReviewWriteResult =
  | { ok: true; path: string; size: number; truncated: boolean; meta: ArchitectReviewMeta }
  | { ok: false; error: string };

export type ArchitectReviewWriteOptions = ArchitectReviewWriteMetaOptions;

export type ArchitectReviewContextResult =
  | { ok: true; context: ArchitectReviewContextBundle }
  | { ok: false; error: string };

export function resolveArchitectReviewAbsolutePath(projectRoot: string): string | null {
  const resolved = resolveProjectPath(projectRoot, PROJECT_ARCHITECT_REVIEW_REL_PATH);
  if (!resolved.ok) return null;
  return resolved.path;
}

export function invalidateArchitectReviewCache(projectPath?: string): void {
  if (!projectPath) {
    reviewCache.clear();
    return;
  }
  reviewCache.delete(path.resolve(projectPath));
}

export async function readArchitectReview(projectRoot: string): Promise<ArchitectReviewReadResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const cached = reviewCache.get(resolvedRoot);
  if (cached && Date.now() - cached.builtAt < REVIEW_CACHE_TTL_MS) {
    return cached.result;
  }

  const absPath = resolveArchitectReviewAbsolutePath(resolvedRoot);
  if (!absPath) {
    return { ok: false, error: "无效的项目路径" };
  }

  let raw = "";
  try {
    raw = await fs.promises.readFile(absPath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const result: ArchitectReviewReadResult = {
        ok: true,
        content: "",
        body: "",
        meta: {},
        truncated: false,
        path: PROJECT_ARCHITECT_REVIEW_REL_PATH,
        maxChars: PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
      };
      reviewCache.set(resolvedRoot, { builtAt: Date.now(), result });
      return result;
    }
    return { ok: false, error: error instanceof Error ? error.message : "读取架构审视报告失败" };
  }

  const { meta, body } = parseArchitectReviewFrontmatter(raw);
  const normalized = normalizeArchitectReviewBody(body);
  const content = serializeArchitectReviewFrontmatter(meta, normalized.content);
  const result: ArchitectReviewReadResult = {
    ok: true,
    content,
    body: normalized.content,
    meta,
    truncated: normalized.truncated,
    path: PROJECT_ARCHITECT_REVIEW_REL_PATH,
    maxChars: PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
  };
  reviewCache.set(resolvedRoot, { builtAt: Date.now(), result });
  return result;
}

export async function writeArchitectReview(
  projectRoot: string,
  body: string,
  options: ArchitectReviewWriteOptions = {},
): Promise<ArchitectReviewWriteResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const absPath = resolveArchitectReviewAbsolutePath(resolvedRoot);
  if (!absPath) {
    return { ok: false, error: "无效的项目路径" };
  }

  const current = await readArchitectReview(resolvedRoot);
  const priorMeta = current.ok ? current.meta : {};
  const normalized = normalizeArchitectReviewBody(body);
  const verdict = options.verdict ?? parseArchitectReviewVerdictFromBody(normalized.content) ?? priorMeta.verdict;
  const meta = buildArchitectReviewMetaForWrite(priorMeta, { ...options, verdict });

  const fileContent = serializeArchitectReviewFrontmatter(meta, normalized.content);
  const dir = path.dirname(absPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(absPath, fileContent, "utf-8");

  invalidateArchitectReviewCache(resolvedRoot);

  return {
    ok: true,
    path: PROJECT_ARCHITECT_REVIEW_REL_PATH,
    size: Buffer.byteLength(fileContent, "utf-8"),
    truncated: normalized.truncated,
    meta,
  };
}

async function resolveCurrentGitHead(projectRoot: string): Promise<string | undefined> {
  const head = await gitHead(projectRoot);
  return head.ok ? head.hash?.trim() || undefined : undefined;
}

export async function buildArchitectReviewContext(
  projectRoot: string,
): Promise<ArchitectReviewContextResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const stat = await fs.promises.stat(resolvedRoot).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { ok: false, error: "路径不存在或不是目录" };
  }

  const existing = await readArchitectReview(resolvedRoot);
  const lastGitHead = existing.ok ? existing.meta.gitHead?.trim() : undefined;
  const lastReviewedAt = existing.ok ? existing.meta.lastReviewedAt : undefined;

  const currentHead = await resolveCurrentGitHead(resolvedRoot);
  const log = await gitLog(resolvedRoot, RECENT_COMMIT_COUNT);
  const recentCommits = log.ok
    ? log.entries.map((e) => ({
        hash: e.hash,
        shortHash: e.shortHash,
        date: e.date,
        message: e.message,
        fileCount: e.files.length,
      }))
    : [];

  let sinceGitRef = lastGitHead;
  if (!sinceGitRef && recentCommits.length > 0) {
    sinceGitRef = recentCommits[recentCommits.length - 1]?.hash;
  }

  let changedFiles: string[] = [];
  if (sinceGitRef) {
    const changed = await gitChangedFilesSince(resolvedRoot, sinceGitRef, { includeWorkingTree: true });
    if (changed.ok) {
      changedFiles = changed.files.slice(0, CHANGED_FILES_MAX);
    }
  }

  let knowledgeExcerpt: string | undefined;
  const knowledge = await readProjectKnowledge(resolvedRoot);
  if (knowledge.ok && knowledge.body.trim()) {
    knowledgeExcerpt = truncateKnowledgeForPrompt(knowledge.body, KNOWLEDGE_EXCERPT_MAX_CHARS);
  }

  // Warm project context cache for subsequent agent run.
  await buildProjectContext(resolvedRoot).catch(() => null);

  const context: ArchitectReviewContextBundle = {
    projectPath: resolvedRoot,
    currentGitHead: currentHead,
    sinceGitRef,
    recentCommits,
    changedFiles,
    knowledgeExcerpt: knowledgeExcerpt || undefined,
    lastReviewedAt,
  };

  return { ok: true, context };
}
