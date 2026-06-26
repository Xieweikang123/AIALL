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
import type {
  ArchitectReviewHistoryEntry,
  ArchitectReviewStoreIndex,
  ReviewHistoryFileContent,
} from "../../shared/projectArchitectReviewHistory";
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
      const payload = await readJsonResponse<ArchitectReviewPayload>(response);
      // #region agent log
      fetch('http://127.0.0.1:7681/ingest/c6f6b2fb-2f39-4dd4-897b-699ca68db244',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'be2226'},body:JSON.stringify({sessionId:'be2226',location:'vibeProjectArchitectReviewClient.ts:saveProjectArchitectReview',message:'saved via middleware',data:{ok:payload.ok,fromReview:options?.fromReview??true,status:response.status,bodyLen:body.length},timestamp:Date.now(),hypothesisId:'B,E'})}).catch(()=>{});
      // #endregion
      return payload;
    }
    if (response.status === 404 || response.status === 405) {
      // #region agent log
      fetch('http://127.0.0.1:7681/ingest/c6f6b2fb-2f39-4dd4-897b-699ca68db244',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'be2226'},body:JSON.stringify({sessionId:'be2226',location:'vibeProjectArchitectReviewClient.ts:saveProjectArchitectReview',message:'disk fallback 404/405',data:{fromReview:options?.fromReview??true,status:response.status,bodyLen:body.length},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      return writeReviewToDisk(trimmed, body, options);
    }
    return await readJsonResponse<ArchitectReviewPayload>(response);
  } catch (error) {
    const message = formatFetchError(error, "保存架构评审报告失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      // #region agent log
      fetch('http://127.0.0.1:7681/ingest/c6f6b2fb-2f39-4dd4-897b-699ca68db244',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'be2226'},body:JSON.stringify({sessionId:'be2226',location:'vibeProjectArchitectReviewClient.ts:saveProjectArchitectReview',message:'disk fallback catch',data:{fromReview:options?.fromReview??true,error:message,bodyLen:body.length},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
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
      return await readJsonResponse<ReviewHistoryPayload>(response);
    }
    return { ok: false, error: "获取评审历史失败" };
  } catch (error) {
    return {
      ok: false,
      error: formatFetchError(error, "获取评审历史失败"),
    };
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
      return await readJsonResponse<ReviewHistoryDetailPayload>(response);
    }
    return { ok: false, error: "获取评审记录详情失败" };
  } catch (error) {
    return {
      ok: false,
      error: formatFetchError(error, "获取评审记录详情失败"),
    };
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
      return await readJsonResponse<ReviewHistoryPayload>(response);
    }
    return { ok: false, error: "删除评审记录失败" };
  } catch (error) {
    return {
      ok: false,
      error: formatFetchError(error, "删除评审记录失败"),
    };
  }
}
