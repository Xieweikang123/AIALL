/** Relative to project root; listed in .gitignore by default. */
export const PROJECT_ARCHITECT_REVIEW_REL_PATH = ".aiall/project-architect-review.md";

/** History directory relative to project root. */
export const PROJECT_ARCHITECT_REVIEW_HISTORY_DIR = ".aiall/review-history";

/** History index file name. */
export const PROJECT_ARCHITECT_REVIEW_STORE_FILE = "review-store.json";

/** Max chars stored on disk (soft cap). */
export const PROJECT_ARCHITECT_REVIEW_MAX_CHARS = 120_000;

/** Max history entries to keep. */
export const PROJECT_ARCHITECT_REVIEW_HISTORY_MAX = 50;

export type ArchitectReviewVerdict = "on_track" | "caution" | "off_track";

export type ArchitectReviewMeta = {
  updatedAt?: string;
  lastReviewedAt?: string;
  gitHead?: string;
  verdict?: ArchitectReviewVerdict;
};

export type ArchitectReviewWriteMetaOptions = {
  gitHead?: string;
  verdict?: ArchitectReviewVerdict;
  fromReview?: boolean;
  commitCount?: number;
  changedFileCount?: number;
};

/** Single history entry in the review store index. */
export type ArchitectReviewHistoryEntry = {
  id: string;
  gitHead?: string;
  verdict?: ArchitectReviewVerdict;
  commitCount?: number;
  changedFileCount?: number;
  createdAt: string;
  file: string;
};

/** Review store index structure. */
export type ArchitectReviewStoreIndex = {
  version: number;
  projectPath: string;
  activeReviewId: string;
  reviews: ArchitectReviewHistoryEntry[];
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseArchitectReviewFrontmatter(raw: string): {
  meta: ArchitectReviewMeta;
  body: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) {
    return { meta: {}, body: normalized.trim() };
  }

  const metaBlock = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const meta: ArchitectReviewMeta = {};

  const updatedAt = metaBlock.match(/^updatedAt:\s*(.+)\s*$/m)?.[1]?.trim();
  const lastReviewedAt = metaBlock.match(/^lastReviewedAt:\s*(.+)\s*$/m)?.[1]?.trim();
  const gitHead = metaBlock.match(/^gitHead:\s*(.+)\s*$/m)?.[1]?.trim();
  const verdictRaw = metaBlock.match(/^verdict:\s*(.+)\s*$/m)?.[1]?.trim();

  if (updatedAt) meta.updatedAt = updatedAt;
  if (lastReviewedAt) meta.lastReviewedAt = lastReviewedAt;
  if (gitHead) meta.gitHead = gitHead;
  if (verdictRaw === "on_track" || verdictRaw === "caution" || verdictRaw === "off_track") {
    meta.verdict = verdictRaw;
  }

  return { meta, body };
}

export function serializeArchitectReviewFrontmatter(
  meta: ArchitectReviewMeta,
  body: string,
): string {
  const lines = ["---"];
  if (meta.updatedAt) lines.push(`updatedAt: ${meta.updatedAt}`);
  if (meta.lastReviewedAt) lines.push(`lastReviewedAt: ${meta.lastReviewedAt}`);
  if (meta.gitHead) lines.push(`gitHead: ${meta.gitHead}`);
  if (meta.verdict) lines.push(`verdict: ${meta.verdict}`);
  lines.push("---", "", body.trim());
  return `${lines.join("\n")}\n`;
}

export function stripArchitectReviewFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (match?.[1] ?? normalized).trim();
}

const VERDICT_SECTION_RE = /##\s+总体判断[\s\S]*?(?=\n##\s|$)/i;

export function parseArchitectReviewVerdictFromBody(body: string): ArchitectReviewVerdict | null {
  const sectionMatch = body.match(VERDICT_SECTION_RE);
  const section = sectionMatch?.[0] ?? body;
  if (/明显跑偏/.test(section)) return "off_track";
  if (/需关注/.test(section)) return "caution";
  if (/方向正确/.test(section)) return "on_track";
  return null;
}

export function normalizeArchitectReviewBody(raw: string): { content: string; truncated: boolean } {
  const trimmed = raw.replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= PROJECT_ARCHITECT_REVIEW_MAX_CHARS) {
    return { content: trimmed, truncated: false };
  }
  return {
    content: `${trimmed.slice(0, PROJECT_ARCHITECT_REVIEW_MAX_CHARS)}\n\n…（已截断）`,
    truncated: true,
  };
}

export function buildArchitectReviewMetaForWrite(
  priorMeta: ArchitectReviewMeta,
  options: ArchitectReviewWriteMetaOptions = {},
): ArchitectReviewMeta {
  const now = new Date().toISOString();
  return {
    updatedAt: now,
    lastReviewedAt: options.fromReview ? now : priorMeta.lastReviewedAt,
    gitHead: options.gitHead ?? priorMeta.gitHead,
    verdict: options.verdict ?? priorMeta.verdict,
  };
}

/** Generate a review ID from timestamp. */
export function generateReviewId(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `review-${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

/** Sanitize ID for use as filename. */
export function sanitizeReviewFilePart(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Get the JSON filename for a review history entry. */
export function reviewHistoryFileName(reviewId: string): string {
  return `${sanitizeReviewFilePart(reviewId)}.json`;
}
