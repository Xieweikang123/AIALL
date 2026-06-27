import { backendUrl } from "./backendBase";
import {
  buildArchitectReviewMetaForWrite,
  normalizeArchitectReviewBody,
  parseArchitectReviewFrontmatter,
  PROJECT_ARCHITECT_REVIEW_HISTORY_DIR,
  PROJECT_ARCHITECT_REVIEW_MAX_CHARS,
  PROJECT_ARCHITECT_REVIEW_REL_PATH,
  PROJECT_ARCHITECT_REVIEW_STORE_FILE,
  serializeArchitectReviewFrontmatter,
  type ArchitectReviewMeta,
  type ArchitectReviewWriteMetaOptions,
} from "../../shared/projectArchitectReviewFormat";
import type { ArchitectReviewContextBundle } from "../../shared/projectArchitectReview";
import {
  appendToStoreIndex,
  buildReviewHistoryEntry,
  createEmptyStoreIndex,
  removeFromStoreIndex,
  type ArchitectReviewHistoryEntry,
  type ArchitectReviewStoreIndex,
  type ReviewHistoryFileContent,
} from "../../shared/projectArchitectReviewHistory";
import {
  deleteItem,
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

const REVIEW_STORE_REL_PATH = `${PROJECT_ARCHITECT_REVIEW_HISTORY_DIR}/${PROJECT_ARCHITECT_REVIEW_STORE_FILE}`;

function isReviewHistoryListPayload(data: unknown): data is ReviewHistoryPayload {
  if (!data || typeof data !== "object") return false;
  const record = data as ReviewHistoryPayload;
  return record.ok === true && Array.isArray(record.reviews);
}

function parseReviewStoreIndex(raw: string, projectPath: string): ArchitectReviewStoreIndex {
  try {
    const parsed = JSON.parse(raw) as ArchitectReviewStoreIndex;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.reviews)) {
      return parsed;
    }
  } catch {
    /* use empty index */
  }
  return createEmptyStoreIndex(projectPath);
}

async function readReviewHistoryFromDisk(projectPath: string): Promise<ReviewHistoryPayload> {
  const read = await readFile(REVIEW_STORE_REL_PATH, projectPath);
  if (!read.ok) {
    if (isMissingFileError(read.error)) {
      const index = createEmptyStoreIndex(projectPath);
      return { ok: true, index, reviews: [] };
    }
    return { ok: false, error: read.error || "读取评审历史失败" };
  }
  const index = parseReviewStoreIndex(read.content, projectPath);
  return { ok: true, index, reviews: index.reviews };
}

async function readReviewHistoryDetailFromDisk(
  projectPath: string,
  reviewId: string,
): Promise<ReviewHistoryDetailPayload> {
  const filePath = `${PROJECT_ARCHITECT_REVIEW_HISTORY_DIR}/${reviewId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
  const read = await readFile(filePath, projectPath);
  if (!read.ok) {
    return { ok: false, error: read.error || "未找到该评审记录" };
  }
  try {
    const review = JSON.parse(read.content) as ReviewHistoryFileContent;
    return { ok: true, review };
  } catch {
    return { ok: false, error: "评审记录格式无效" };
  }
}

async function appendReviewHistoryOnDisk(
  projectPath: string,
  body: string,
  options: ArchitectReviewWriteMetaOptions = {},
): Promise<{ ok: boolean; entry?: ArchitectReviewHistoryEntry; index?: ArchitectReviewStoreIndex; error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "评审内容为空" };

  const storeRead = await readFile(REVIEW_STORE_REL_PATH, projectPath);
  const index = storeRead.ok
    ? parseReviewStoreIndex(storeRead.content, projectPath)
    : createEmptyStoreIndex(projectPath);

  const { entry, fileContent } = buildReviewHistoryEntry({
    projectPath,
    body: trimmed,
    gitHead: options.gitHead,
    verdict: options.verdict,
    commitCount: options.commitCount,
    changedFileCount: options.changedFileCount,
  });

  const historyWrite = await writeFile(
    `${PROJECT_ARCHITECT_REVIEW_HISTORY_DIR}/${entry.file}`,
    JSON.stringify(fileContent, null, 2),
    projectPath,
  );
  if (!historyWrite.ok) {
    return { ok: false, error: historyWrite.error || "保存评审历史失败" };
  }

  const newIndex = appendToStoreIndex(index, entry);
  const storeWrite = await writeFile(REVIEW_STORE_REL_PATH, JSON.stringify(newIndex, null, 2), projectPath);
  if (!storeWrite.ok) {
    return { ok: false, error: storeWrite.error || "更新评审历史索引失败" };
  }

  return { ok: true, entry, index: newIndex };
}

function reviewHistoryFilePath(reviewId: string): string {
  return `${PROJECT_ARCHITECT_REVIEW_HISTORY_DIR}/${reviewId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

async function deleteReviewHistoryFromDisk(
  projectPath: string,
  reviewId: string,
): Promise<ReviewHistoryPayload> {
  const storeRead = await readFile(REVIEW_STORE_REL_PATH, projectPath);
  if (!storeRead.ok && !isMissingFileError(storeRead.error)) {
    return { ok: false, error: storeRead.error || "读取评审历史失败" };
  }

  const index = storeRead.ok
    ? parseReviewStoreIndex(storeRead.content, projectPath)
    : createEmptyStoreIndex(projectPath);

  if (!index.reviews.some((entry) => entry.id === reviewId)) {
    return { ok: false, error: "未找到该评审记录" };
  }

  const newIndex = removeFromStoreIndex(index, reviewId);
  const storeWrite = await writeFile(REVIEW_STORE_REL_PATH, JSON.stringify(newIndex, null, 2), projectPath);
  if (!storeWrite.ok) {
    return { ok: false, error: storeWrite.error || "更新评审历史索引失败" };
  }

  await deleteItem(reviewHistoryFilePath(reviewId), projectPath);

  return { ok: true, index: newIndex, reviews: newIndex.reviews };
}

/**
 * Archive current review into history; falls back to disk when backend lacks /history support.
 * @param priorHistoryCount - The history count already known to the caller (from cached state).
 *   Avoids an extra "before" fetch by letting the caller supply the baseline. If omitted the
 *   server-auto-archive detection is skipped and the function always falls back to disk.
 */
export async function archiveReviewToHistory(
  projectPath: string,
  body: string,
  options: ArchitectReviewWriteMetaOptions = {},
  priorHistoryCount?: number,
): Promise<{ ok: boolean; entry?: ArchitectReviewHistoryEntry; reviews?: ArchitectReviewHistoryEntry[]; error?: string }> {
  const trimmedPath = projectPath.trim();
  const trimmedBody = body.trim();
  if (!trimmedPath) return { ok: false, error: "缺少 projectPath" };
  if (!trimmedBody) return { ok: false, error: "评审内容为空" };

  const saveResult = await saveProjectArchitectReview(trimmedPath, trimmedBody, {
    ...options,
    fromReview: true,
  });
  if (!saveResult.ok) {
    return { ok: false, error: saveResult.error || "归档评审失败" };
  }

  const after = await fetchReviewHistory(trimmedPath);
  const afterReviews = after.reviews ?? [];
  // Server auto-archived when the count grew relative to the caller's known baseline.
  if (after.ok && priorHistoryCount !== undefined && afterReviews.length > priorHistoryCount) {
    return { ok: true, entry: afterReviews[0], reviews: afterReviews };
  }

  // Disk fallback: append the entry directly via the file API.
  const diskResult = await appendReviewHistoryOnDisk(trimmedPath, trimmedBody, options);
  if (!diskResult.ok) {
    return { ok: false, error: diskResult.error || "归档评审失败" };
  }
  const finalHistory = await fetchReviewHistory(trimmedPath);
  return { ok: true, entry: diskResult.entry, reviews: finalHistory.reviews };
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
    return { ok: false, error: read.error || "读取架构评审报告失败" };
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
    return { ok: false, error: write.error || "保存架构评审报告失败" };
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
    const message = formatFetchError(error, "读取架构评审报告失败");
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
        commitCount: options?.commitCount,
        changedFileCount: options?.changedFileCount,
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
    const message = formatFetchError(error, "保存架构评审报告失败");
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
      error: formatFetchError(error, "获取评审上下文失败"),
    };
  }
}

// --- Review History API ---

export type ReviewHistoryPayload = {
  ok: boolean;
  index?: ArchitectReviewStoreIndex;
  reviews?: ArchitectReviewHistoryEntry[];
  error?: string;
};

export type ReviewHistoryDetailPayload = {
  ok: boolean;
  review?: ReviewHistoryFileContent;
  error?: string;
};

export async function fetchReviewHistory(projectPath: string): Promise<ReviewHistoryPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const url = backendUrl(
      `/backend/vibe/project-architect-review/history?projectPath=${encodeURIComponent(trimmed)}`,
    );
    const response = await fetch(url);
    if (response.ok) {
      const payload = await readJsonResponse<ReviewHistoryPayload>(response);
      if (isReviewHistoryListPayload(payload)) {
        return payload;
      }
      return readReviewHistoryFromDisk(trimmed);
    }
    if (response.status === 404 || response.status === 405) {
      return readReviewHistoryFromDisk(trimmed);
    }
    return { ok: false, error: "获取评审历史失败" };
  } catch (error) {
    const message = formatFetchError(error, "获取评审历史失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return readReviewHistoryFromDisk(trimmed);
    }
    return { ok: false, error: message };
  }
}

export async function fetchReviewHistoryDetail(
  projectPath: string,
  reviewId: string,
): Promise<ReviewHistoryDetailPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  if (!reviewId) return { ok: false, error: "缺少 reviewId" };
  try {
    const url = backendUrl(
      `/backend/vibe/project-architect-review/history?projectPath=${encodeURIComponent(trimmed)}&reviewId=${encodeURIComponent(reviewId)}`,
    );
    const response = await fetch(url);
    if (response.ok) {
      const payload = await readJsonResponse<ReviewHistoryDetailPayload>(response);
      if (payload.ok && payload.review) {
        return payload;
      }
      return readReviewHistoryDetailFromDisk(trimmed, reviewId);
    }
    if (response.status === 404 || response.status === 405) {
      return readReviewHistoryDetailFromDisk(trimmed, reviewId);
    }
    return { ok: false, error: "获取评审记录详情失败" };
  } catch (error) {
    const message = formatFetchError(error, "获取评审记录详情失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return readReviewHistoryDetailFromDisk(trimmed, reviewId);
    }
    return { ok: false, error: message };
  }
}

export async function deleteReviewHistory(
  projectPath: string,
  reviewId: string,
): Promise<ReviewHistoryPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  if (!reviewId) return { ok: false, error: "缺少 reviewId" };
  try {
    const url = backendUrl(
      `/backend/vibe/project-architect-review/history?projectPath=${encodeURIComponent(trimmed)}&reviewId=${encodeURIComponent(reviewId)}`,
    );
    const response = await fetch(url, { method: "DELETE" });
    if (response.ok) {
      const payload = await readJsonResponse<ReviewHistoryPayload>(response);
      if (isReviewHistoryListPayload(payload)) {
        return payload;
      }
      return deleteReviewHistoryFromDisk(trimmed, reviewId);
    }
    if (response.status === 404 || response.status === 405) {
      return deleteReviewHistoryFromDisk(trimmed, reviewId);
    }
    let serverError = "删除评审记录失败";
    try {
      const errBody = await readJsonResponse<{ error?: string }>(response);
      if (errBody.error) serverError = errBody.error;
    } catch {
      /* ignore parse errors */
    }
    return { ok: false, error: serverError };
  } catch (error) {
    const message = formatFetchError(error, "删除评审记录失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return deleteReviewHistoryFromDisk(trimmed, reviewId);
    }
    return { ok: false, error: message };
  }
}
