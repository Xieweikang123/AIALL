import fs from "node:fs";
import path from "node:path";
import {
  buildArchitectReviewMetaForWrite,
  normalizeArchitectReviewBody,
  parseArchitectReviewFrontmatter,
  parseArchitectReviewVerdictFromBody,
  PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
  PROJECT_ARCHITECT_REVIEW_REL_PATH,
  PROJECT_ARCHITECT_REVIEW_HISTORY_DIR,
  PROJECT_ARCHITECT_REVIEW_STORE_FILE,
  serializeArchitectReviewFrontmatter,
  type ArchitectReviewMeta,
  type ArchitectReviewWriteMetaOptions,
} from "../shared/projectArchitectReviewFormat";
import {
  createEmptyStoreIndex,
  buildReviewHistoryEntry,
  appendToStoreIndex,
  removeFromStoreIndex,
  type ArchitectReviewHistoryEntry,
  type ArchitectReviewStoreIndex,
  type ReviewHistoryFileContent,
} from "../shared/projectArchitectReviewHistory";
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
const historyDetailCache = new Map<string, { builtAt: number; review: ReviewHistoryFileContent }>();

function historyDetailCacheKey(projectRoot: string, reviewId: string): string {
  return `${path.resolve(projectRoot)}\0${reviewId}`;
}

export function invalidateReviewHistoryDetailCache(projectPath?: string, reviewId?: string): void {
  if (!projectPath) {
    historyDetailCache.clear();
    return;
  }
  const prefix = `${path.resolve(projectPath)}\0`;
  if (reviewId) {
    historyDetailCache.delete(historyDetailCacheKey(projectPath, reviewId));
    return;
  }
  for (const key of historyDetailCache.keys()) {
    if (key.startsWith(prefix)) historyDetailCache.delete(key);
  }
}

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
    return { ok: false, error: error instanceof Error ? error.message : "读取架构评审报告失败" };
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

// --- Review History Functions ---

function resolveHistoryDir(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_ARCHITECT_REVIEW_HISTORY_DIR);
}

function resolveStoreIndexPath(projectRoot: string): string {
  return path.join(resolveHistoryDir(projectRoot), PROJECT_ARCHITECT_REVIEW_STORE_FILE);
}

async function ensureHistoryDir(projectRoot: string): Promise<void> {
  const dir = resolveHistoryDir(projectRoot);
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function readReviewStoreIndex(projectRoot: string): Promise<ArchitectReviewStoreIndex> {
  const indexPath = resolveStoreIndexPath(projectRoot);
  try {
    const raw = await fs.promises.readFile(indexPath, "utf-8");
    const parsed = JSON.parse(raw) as ArchitectReviewStoreIndex;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.reviews)) {
      return parsed;
    }
    return createEmptyStoreIndex(projectRoot);
  } catch {
    return createEmptyStoreIndex(projectRoot);
  }
}

async function writeReviewStoreIndex(
  projectRoot: string,
  index: ArchitectReviewStoreIndex,
): Promise<void> {
  await ensureHistoryDir(projectRoot);
  const indexPath = resolveStoreIndexPath(projectRoot);
  await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

async function writeReviewHistoryFile(
  projectRoot: string,
  content: ReviewHistoryFileContent,
): Promise<void> {
  await ensureHistoryDir(projectRoot);
  const filePath = path.join(resolveHistoryDir(projectRoot), content.id.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");
  await fs.promises.writeFile(filePath, JSON.stringify(content, null, 2), "utf-8");
}

async function readReviewHistoryFile(
  projectRoot: string,
  reviewId: string,
): Promise<ReviewHistoryFileContent | null> {
  const filePath = path.join(resolveHistoryDir(projectRoot), reviewId.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as ReviewHistoryFileContent;
  } catch {
    return null;
  }
}

async function deleteReviewHistoryFile(
  projectRoot: string,
  reviewId: string,
): Promise<void> {
  const filePath = path.join(resolveHistoryDir(projectRoot), reviewId.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");
  await fs.promises.unlink(filePath).catch(() => {});
}

export type ReviewHistoryResult =
  | { ok: true; index: ArchitectReviewStoreIndex; reviews: ArchitectReviewHistoryEntry[] }
  | { ok: false; error: string };

export async function listReviewHistory(projectRoot: string): Promise<ReviewHistoryResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const index = await readReviewStoreIndex(resolvedRoot);
  return { ok: true, index, reviews: index.reviews };
}

export type ReviewHistoryDetailResult =
  | { ok: true; review: ReviewHistoryFileContent }
  | { ok: false; error: string };

export async function getReviewHistoryDetail(
  projectRoot: string,
  reviewId: string,
): Promise<ReviewHistoryDetailResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const cacheKey = historyDetailCacheKey(resolvedRoot, reviewId);
  const cached = historyDetailCache.get(cacheKey);
  if (cached && Date.now() - cached.builtAt < REVIEW_CACHE_TTL_MS) {
    return { ok: true, review: cached.review };
  }

  const review = await readReviewHistoryFile(resolvedRoot, reviewId);
  if (!review) {
    return { ok: false, error: "未找到该评审记录" };
  }
  historyDetailCache.set(cacheKey, { builtAt: Date.now(), review });
  return { ok: true, review };
}

export type SaveReviewHistoryResult =
  | { ok: true; entry: ArchitectReviewHistoryEntry; index: ArchitectReviewStoreIndex }
  | { ok: false; error: string };

export async function saveReviewToHistory(
  projectRoot: string,
  body: string,
  options: {
    gitHead?: string;
    verdict?: ArchitectReviewMeta["verdict"];
    commitCount?: number;
    changedFileCount?: number;
  } = {},
): Promise<SaveReviewHistoryResult> {
  try {
    const resolvedRoot = path.resolve(projectRoot);
    const gitHead = options.gitHead?.trim() || (await resolveCurrentGitHead(resolvedRoot));
    const index = await readReviewStoreIndex(resolvedRoot);
    const { entry, fileContent } = buildReviewHistoryEntry({
      projectPath: resolvedRoot,
      body,
      gitHead,
      verdict: options.verdict,
      commitCount: options.commitCount,
      changedFileCount: options.changedFileCount,
    });

    await writeReviewHistoryFile(resolvedRoot, fileContent);
    const newIndex = appendToStoreIndex(index, entry);
    await writeReviewStoreIndex(resolvedRoot, newIndex);
    historyDetailCache.set(historyDetailCacheKey(resolvedRoot, entry.id), {
      builtAt: Date.now(),
      review: fileContent,
    });

    return { ok: true, entry, index: newIndex };
  } catch (err) {
    const errMsg = err instanceof Error ? err.stack || err.message : String(err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteReviewFromHistory(
  projectRoot: string,
  reviewId: string,
): Promise<ReviewHistoryResult> {
  const resolvedRoot = path.resolve(projectRoot);
  const index = await readReviewStoreIndex(resolvedRoot);
  await deleteReviewHistoryFile(resolvedRoot, reviewId);
  invalidateReviewHistoryDetailCache(resolvedRoot, reviewId);
  const newIndex = removeFromStoreIndex(index, reviewId);
  await writeReviewStoreIndex(resolvedRoot, newIndex);
  return { ok: true, index: newIndex, reviews: newIndex.reviews };
}
