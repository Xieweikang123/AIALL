import { backendUrl } from "./backendBase";
import {
  buildArchitectReviewMetaForWrite,
  normalizeArchitectReviewBody,
  parseArchitectReviewFrontmatter,
  PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
  PROJECT_ARCHITECT_REVIEW_REL_PATH,
  serializeArchitectReviewFrontmatter,
  type ArchitectReviewMeta,
  type ArchitectReviewWriteMetaOptions,
} from "../../shared/projectArchitectReviewFormat";
import type { ArchitectReviewContextBundle } from "../../shared/projectArchitectReview";
import {
  formatFetchError,
  readFile,
  readJsonResponse,
  writeFile,
} from "./vibeCodingClient";

export type { ArchitectReviewMeta };
export { PROJECT_ARCHITECT_REVIEW_REL_PATH, PROJECT_ARCHITECT_REVIEW_MAX_CHARS };

export type ArchitectReviewPayload = {
  ok: boolean;
  content?: string;
  body?: string;
  meta?: ArchitectReviewMeta;
  truncated?: boolean;
  path?: string;
  maxChars?: number;
  size?: number;
  error?: string;
};

export type ArchitectReviewContextPayload = {
  ok: boolean;
  context?: ArchitectReviewContextBundle;
  error?: string;
};

function isMissingFileError(message?: string): boolean {
  return Boolean(message && /不存在|not found|ENOENT/i.test(message));
}

async function readReviewFromDisk(projectPath: string): Promise<ArchitectReviewPayload> {
  const read = await readFile(PROJECT_ARCHITECT_REVIEW_REL_PATH, projectPath);
  if (!read.ok) {
    if (isMissingFileError(read.error)) {
      return {
        ok: true,
        content: "",
        body: "",
        meta: {},
        truncated: false,
        path: PROJECT_ARCHITECT_REVIEW_REL_PATH,
        maxChars: PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
      };
    }
    return { ok: false, error: read.error || "读取架构审视报告失败" };
  }

  const { meta, body } = parseArchitectReviewFrontmatter(read.content);
  const normalized = normalizeArchitectReviewBody(body);
  return {
    ok: true,
    content: read.content,
    body: normalized.content,
    meta,
    truncated: normalized.truncated,
    path: PROJECT_ARCHITECT_REVIEW_REL_PATH,
    maxChars: PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
  };
}

async function writeReviewToDisk(
  projectPath: string,
  body: string,
  options: ArchitectReviewWriteMetaOptions = {},
): Promise<ArchitectReviewPayload> {
  const existing = await readReviewFromDisk(projectPath);
  const priorMeta = existing.ok ? (existing.meta ?? {}) : {};
  const normalized = normalizeArchitectReviewBody(body);
  const meta = buildArchitectReviewMetaForWrite(priorMeta, options);
  const content = serializeArchitectReviewFrontmatter(meta, normalized.content);
  const write = await writeFile(PROJECT_ARCHITECT_REVIEW_REL_PATH, content, projectPath);
  if (!write.ok) {
    return { ok: false, error: write.error || "保存架构审视报告失败" };
  }
  return {
    ok: true,
    path: PROJECT_ARCHITECT_REVIEW_REL_PATH,
    size: write.size,
    truncated: normalized.truncated,
    content,
    body: normalized.content,
    meta,
    maxChars: PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
  };
}

export async function fetchProjectArchitectReview(projectPath: string): Promise<ArchitectReviewPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const url = backendUrl(
      `/backend/vibe/project-architect-review?projectPath=${encodeURIComponent(trimmed)}`,
    );
    const response = await fetch(url);
    if (response.ok) {
      return await readJsonResponse<ArchitectReviewPayload>(response);
    }
    if (response.status === 404 || response.status === 405) {
      return readReviewFromDisk(trimmed);
    }
    return await readJsonResponse<ArchitectReviewPayload>(response);
  } catch (error) {
    const message = formatFetchError(error, "读取架构审视报告失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return readReviewFromDisk(trimmed);
    }
    return { ok: false, error: message };
  }
}

export async function saveProjectArchitectReview(
  projectPath: string,
  body: string,
  options?: ArchitectReviewWriteMetaOptions,
): Promise<ArchitectReviewPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const response = await fetch(backendUrl("/backend/vibe/project-architect-review"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: trimmed,
        body,
        fromReview: options?.fromReview ?? true,
        gitHead: options?.gitHead,
        verdict: options?.verdict,
      }),
    });
    if (response.ok) {
      return await readJsonResponse<ArchitectReviewPayload>(response);
    }
    if (response.status === 404 || response.status === 405) {
      return writeReviewToDisk(trimmed, body, options);
    }
    return await readJsonResponse<ArchitectReviewPayload>(response);
  } catch (error) {
    const message = formatFetchError(error, "保存架构审视报告失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return writeReviewToDisk(trimmed, body, options);
    }
    return { ok: false, error: message };
  }
}

export async function fetchArchitectReviewContext(
  projectPath: string,
): Promise<ArchitectReviewContextPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const url = backendUrl(
      `/backend/vibe/project-architect-review/context?projectPath=${encodeURIComponent(trimmed)}`,
    );
    const response = await fetch(url);
    return await readJsonResponse<ArchitectReviewContextPayload>(response);
  } catch (error) {
    return {
      ok: false,
      error: formatFetchError(error, "获取审视上下文失败"),
    };
  }
}
