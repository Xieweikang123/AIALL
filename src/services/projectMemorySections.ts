export const PROJECT_MEMORY_SECTIONS = ["术语", "导航", "偏好"] as const;
export type ProjectMemorySection = (typeof PROJECT_MEMORY_SECTIONS)[number];

export const PROJECT_MEMORY_SECTION_TEMPLATE = `# 项目记忆

与 AGENTS.md 互补：AGENTS.md 存稳定术语；此处存探索结论与用户偏好。AI 每次对话会自动读取。

## 术语

（本项目特有、AGENTS.md 未覆盖的用户说法 → 模块/文件）

## 导航

（常用入口、目录约定、探索涉及的源码路径）

## 偏好

（编码风格、语言、工作流习惯）
`;

export function isProjectMemorySection(value: string): value is ProjectMemorySection {
  return (PROJECT_MEMORY_SECTIONS as readonly string[]).includes(value);
}

const TIMESTAMP_RE = /^\[([\d-]+)\]\s*/;

/** Add today's date prefix to a bullet line if it doesn't already have one. */
export function stampBullet(line: string, date?: Date): string {
  const bullet = normalizeBullet(line);
  if (!bullet) return "";
  if (TIMESTAMP_RE.test(bullet.replace(/^- /, ""))) return bullet;
  const d = date ?? new Date();
  const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `- [${ts}] ${bullet.replace(/^- /, "")}`;
}

/** Extract date from a stamped bullet, or null. */
function bulletDate(bullet: string): Date | null {
  const inner = bullet.replace(/^- /, "");
  const m = inner.match(TIMESTAMP_RE);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Half-life in days for memory decay. */
const MEMORY_DECAY_HALF_LIFE_DAYS = 30;

function timeDecayScore(bullet: string, now: Date): number {
  const d = bulletDate(bullet);
  if (!d) return 0.5;
  const ageDays = Math.max(0, (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  return Math.pow(0.5, ageDays / MEMORY_DECAY_HALF_LIFE_DAYS);
}

/** Score a memory line against a task context (keyword overlap). */
function relevanceScore(bullet: string, keywords: Set<string>): number {
  if (keywords.size === 0) return 0;
  const text = bullet.replace(/^- /, "").replace(/`/g, "").toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return hits / keywords.size;
}

/** Hash a memory line to a stable key (same as memoryUsageTracker). */
function memoryLineKey(line: string): string {
  const stripped = line
    .replace(/^- /, "")
    .replace(/^\[[\d-]+\]\s*/, "")
    .trim()
    .toLowerCase();
  let hash = 0;
  for (let i = 0; i < stripped.length; i++) {
    hash = ((hash << 5) - hash + stripped.charCodeAt(i)) | 0;
  }
  return `m${(hash >>> 0).toString(36)}`;
}

/** Extract simple keywords from a task context string. */
export function extractTaskKeywords(text: string): Set<string> {
  const words = new Set<string>();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff/._-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  for (const t of tokens) words.add(t);
  return words;
}

/**
 * Assess content quality of a memory line (0-1).
 * Higher score means more descriptive and useful content.
 */
function assessContentQuality(line: string): number {
  const text = line.replace(/^- /, "").replace(/^\[[\d-]+\]\s*/, "");
  if (!text) return 0;

  let score = 0;

  // Pure path or file reference without description → low quality
  const purePathPattern = /^`?[a-z/._-]+\.[a-z]+`?$/i;
  if (purePathPattern.test(text)) return 0.1;

  // Path with description → medium quality
  const pathWithDescPattern = /^`?[a-z/._-]+\.[a-z]+`?\s*[:：]/i;
  if (pathWithDescPattern.test(text)) score += 0.3;

  // Contains Chinese description → higher quality
  if (/[\u4e00-\u9fff]/.test(text)) score += 0.25;

  // Contains actionable keywords (should/must/prohibit/priority/commonly)
  if (/(?:应|需|禁止|优先|常用|约定|必须|建议|不要|避免)/.test(text)) score += 0.25;

  // Contains specific paths or code references
  if (/(?:`[^`]+`|src\/|server\/|components\/)/.test(text)) score += 0.1;

  // Contains dates (temporal relevance)
  if (/\d{4}-\d{2}-\d{2}/.test(text)) score += 0.1;

  return Math.min(score, 1);
}

export type RankedMemoryLine = { line: string; score: number };

/**
 * Rank memory lines by combined relevance + time decay + usage frequency + content quality.
 * Returns lines sorted descending by score, capped to maxChars.
 */
export function rankMemoryEntries(
  content: string,
  taskKeywords: Set<string>,
  maxChars: number,
  usageCounts?: Map<string, number>,
): string {
  const now = new Date();
  const lines = content.split("\n");
  const ranked: RankedMemoryLine[] = [];

  for (const line of lines) {
    if (!line.startsWith("- ")) {
      ranked.push({ line, score: Infinity });
      continue;
    }
    const decay = timeDecayScore(line, now);
    const rel = relevanceScore(line, taskKeywords);
    const quality = assessContentQuality(line);
    const key = memoryLineKey(line);
    const usageBoost = usageCounts?.get(key) ?? 0;

    // Dynamic weight: quality matters more for low-usage items
    const usageWeight = Math.min(usageBoost, 10) * 0.025;
    const qualityWeight = usageBoost > 0 ? 0.15 : 0.25;

    ranked.push({
      line,
      score: decay * 0.3 + rel * 0.3 + quality * qualityWeight + usageWeight,
    });
  }

  ranked.sort((a, b) => b.score - a.score);

  let used = 0;
  const result: string[] = [];
  for (const r of ranked) {
    if (r.score === Infinity) {
      result.push(r.line);
      continue;
    }
    if (used + r.line.length + 1 > maxChars) continue;
    used += r.line.length + 1;
    result.push(r.line);
  }
  return result.join("\n");
}

function normalizeBullet(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("- ") ? trimmed : `- ${trimmed}`;
}

/** Strip leading `- ` and date prefix `[YYYY-MM-DD]` for dedup comparison. */
function bulletKey(bullet: string): string {
  return bullet
    .replace(/^- /, "")
    .replace(/^\[[\d-]+\]\s*/, "")
    .trim()
    .toLowerCase();
}

export function appendProjectMemorySection(
  existing: string,
  section: ProjectMemorySection,
  lines: string[],
): string {
  const newBullets = lines.map(normalizeBullet).filter(Boolean);
  if (!newBullets.length) return existing.replace(/\r\n/g, "\n").trim();

  let normalized = existing.replace(/\r\n/g, "\n").trim();
  if (!normalized) normalized = PROJECT_MEMORY_SECTION_TEMPLATE.trim();

  const header = `## ${section}`;
  const sectionRe = new RegExp(`^## ${section}\\s*$`, "m");

  if (!sectionRe.test(normalized)) {
    return `${normalized}\n\n${header}\n\n${newBullets.join("\n")}`;
  }

  const parts = normalized.split(/\n(?=## )/);
  const rebuilt: string[] = [];
  for (const part of parts) {
    const trimmed = part.trimEnd();
    if (sectionRe.test(trimmed)) {
      const existingKeys = new Set(
        trimmed
          .split("\n")
          .slice(1)
          .map(normalizeBullet)
          .filter(Boolean)
          .map(bulletKey),
      );
      const deduped = newBullets.filter((b) => !existingKeys.has(bulletKey(b)));
      rebuilt.push(`${trimmed}\n${deduped.join("\n")}`);
    } else {
      rebuilt.push(part);
    }
  }
  return rebuilt.join("\n\n").trim();
}
