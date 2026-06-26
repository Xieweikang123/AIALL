import { backendUrl } from "./backendBase";
import {
  buildProjectKnowledgeMetaForWrite,
  normalizeProjectKnowledgeBody,
  parseProjectKnowledgeFrontmatter,
  PROJECT_KNOWLEDGE_MAX_CHARS,
  PROJECT_KNOWLEDGE_REL_PATH,
  serializeProjectKnowledgeFrontmatter,
  type ProjectKnowledgeMeta,
  type ProjectKnowledgeWriteMetaOptions,
} from "../../shared/projectKnowledgeFormat";
import {
  formatFetchError,
  readFile,
  readJsonResponse,
  writeFile,
} from "./vibeCodingClient";

export type { ProjectKnowledgeMeta };
export { PROJECT_KNOWLEDGE_REL_PATH, PROJECT_KNOWLEDGE_MAX_CHARS };

export type ProjectKnowledgePayload = {
  ok: boolean;
  content?: string;
  body?: string;
  meta?: ProjectKnowledgeMeta;
  truncated?: boolean;
  path?: string;
  maxChars?: number;
  promptMaxChars?: number;
  size?: number;
  error?: string;
};

function isMissingFileError(message?: string): boolean {
  return Boolean(message && /不存在|not found|ENOENT/i.test(message));
}

async function readKnowledgeFromDisk(projectPath: string): Promise<ProjectKnowledgePayload> {
  const read = await readFile(PROJECT_KNOWLEDGE_REL_PATH, projectPath);
  if (!read.ok) {
    if (isMissingFileError(read.error)) {
      return {
        ok: true,
        content: "",
        body: "",
        meta: {},
        truncated: false,
        path: PROJECT_KNOWLEDGE_REL_PATH,
        maxChars: PROJECT_KNOWLEDGE_MAX_CHARS,
      };
    }
    return { ok: false, error: read.error || "读取项目知识库失败" };
  }

  const { meta, body } = parseProjectKnowledgeFrontmatter(read.content);
  const normalized = normalizeProjectKnowledgeBody(body);
  return {
    ok: true,
    content: read.content,
    body: normalized.content,
    meta,
    truncated: normalized.truncated,
    path: PROJECT_KNOWLEDGE_REL_PATH,
    maxChars: PROJECT_KNOWLEDGE_MAX_CHARS,
  };
}

async function writeKnowledgeToDisk(
  projectPath: string,
  body: string,
  options: ProjectKnowledgeWriteMetaOptions = {},
): Promise<ProjectKnowledgePayload> {
  const existing = await readKnowledgeFromDisk(projectPath);
  const priorMeta = existing.ok ? (existing.meta ?? {}) : {};
  const normalized = normalizeProjectKnowledgeBody(body);
  const meta = buildProjectKnowledgeMetaForWrite(priorMeta, {
    ...options,
    charCount: normalized.content.length,
  });
  const content = serializeProjectKnowledgeFrontmatter(meta, normalized.content);
  const write = await writeFile(PROJECT_KNOWLEDGE_REL_PATH, content, projectPath);
  if (!write.ok) {
    return { ok: false, error: write.error || "保存项目知识库失败" };
  }
  return {
    ok: true,
    path: PROJECT_KNOWLEDGE_REL_PATH,
    size: write.size,
    truncated: normalized.truncated,
    content,
    body: normalized.content,
    meta,
    maxChars: PROJECT_KNOWLEDGE_MAX_CHARS,
  };
}

export async function fetchProjectKnowledge(projectPath: string): Promise<ProjectKnowledgePayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const url = backendUrl(
      `/backend/vibe/project-knowledge?projectPath=${encodeURIComponent(trimmed)}`,
    );
    const response = await fetch(url);
    if (response.ok) {
      return await readJsonResponse<ProjectKnowledgePayload>(response);
    }
    if (response.status === 404 || response.status === 405) {
      return readKnowledgeFromDisk(trimmed);
    }
    return await readJsonResponse<ProjectKnowledgePayload>(response);
  } catch (error) {
    const message = formatFetchError(error, "读取项目知识库失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return readKnowledgeFromDisk(trimmed);
    }
    return { ok: false, error: message };
  }
}

export async function saveProjectKnowledge(
  projectPath: string,
  body: string,
  options?: ProjectKnowledgeWriteMetaOptions,
): Promise<ProjectKnowledgePayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const response = await fetch(backendUrl("/backend/vibe/project-knowledge"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: trimmed,
        body,
        fromExplore: options?.fromExplore,
        gitHead: options?.gitHead,
        exploreRounds: options?.exploreRounds,
      }),
    });
    if (response.ok) {
      return await readJsonResponse<ProjectKnowledgePayload>(response);
    }
    if (response.status === 404 || response.status === 405) {
      return writeKnowledgeToDisk(trimmed, body, options);
    }
    return await readJsonResponse<ProjectKnowledgePayload>(response);
  } catch (error) {
    const message = formatFetchError(error, "保存项目知识库失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return writeKnowledgeToDisk(trimmed, body, options);
    }
    return { ok: false, error: message };
  }
}
