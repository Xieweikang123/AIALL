import { backendUrl } from "./backendBase";
import {
  formatFetchError,
  readFile,
  readJsonResponse,
  writeFile,
} from "./vibeCodingClient";

export type ProjectKnowledgeMeta = {
  updatedAt?: string;
  lastExploredAt?: string;
  exploreRounds?: number;
  gitHead?: string;
};

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

export const PROJECT_KNOWLEDGE_REL_PATH = ".aiall/project-knowledge.md";
export const PROJECT_KNOWLEDGE_MAX_CHARS = 120_000;

function isMissingFileError(message?: string): boolean {
  return Boolean(message && /不存在|not found|ENOENT/i.test(message));
}

function parseFrontmatter(raw: string): { meta: ProjectKnowledgeMeta; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized.trim() };
  const metaBlock = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const meta: ProjectKnowledgeMeta = {};
  const updatedAt = metaBlock.match(/^updatedAt:\s*(.+)\s*$/m)?.[1]?.trim();
  const lastExploredAt = metaBlock.match(/^lastExploredAt:\s*(.+)\s*$/m)?.[1]?.trim();
  const exploreRoundsRaw = metaBlock.match(/^exploreRounds:\s*(\d+)\s*$/m)?.[1];
  const gitHead = metaBlock.match(/^gitHead:\s*(.+)\s*$/m)?.[1]?.trim();
  if (updatedAt) meta.updatedAt = updatedAt;
  if (lastExploredAt) meta.lastExploredAt = lastExploredAt;
  if (exploreRoundsRaw) meta.exploreRounds = Number(exploreRoundsRaw);
  if (gitHead) meta.gitHead = gitHead;
  return { meta, body };
}

async function fetchProjectKnowledgeViaFileApi(projectPath: string): Promise<ProjectKnowledgePayload> {
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

  const { meta, body } = parseFrontmatter(read.content);
  return {
    ok: true,
    content: read.content,
    body,
    meta,
    truncated: false,
    path: PROJECT_KNOWLEDGE_REL_PATH,
    maxChars: PROJECT_KNOWLEDGE_MAX_CHARS,
  };
}

async function saveProjectKnowledgeViaFileApi(
  projectPath: string,
  body: string,
  meta?: ProjectKnowledgeMeta,
): Promise<ProjectKnowledgePayload> {
  const now = new Date().toISOString();
  const mergedMeta: ProjectKnowledgeMeta = {
    updatedAt: now,
    ...meta,
  };
  const lines = ["---"];
  if (mergedMeta.updatedAt) lines.push(`updatedAt: ${mergedMeta.updatedAt}`);
  if (mergedMeta.lastExploredAt) lines.push(`lastExploredAt: ${mergedMeta.lastExploredAt}`);
  if (mergedMeta.exploreRounds != null) lines.push(`exploreRounds: ${mergedMeta.exploreRounds}`);
  if (mergedMeta.gitHead) lines.push(`gitHead: ${mergedMeta.gitHead}`);
  lines.push("---", "", body.trim());
  const content = `${lines.join("\n")}\n`;
  const write = await writeFile(PROJECT_KNOWLEDGE_REL_PATH, content, projectPath);
  if (!write.ok) {
    return { ok: false, error: write.error || "保存项目知识库失败" };
  }
  return {
    ok: true,
    path: PROJECT_KNOWLEDGE_REL_PATH,
    size: write.size,
    truncated: false,
    content,
    body: body.trim(),
    meta: mergedMeta,
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
      return fetchProjectKnowledgeViaFileApi(trimmed);
    }
    return await readJsonResponse<ProjectKnowledgePayload>(response);
  } catch (error) {
    const message = formatFetchError(error, "读取项目知识库失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return fetchProjectKnowledgeViaFileApi(trimmed);
    }
    return { ok: false, error: message };
  }
}

export async function saveProjectKnowledge(
  projectPath: string,
  body: string,
  options?: { fromExplore?: boolean; gitHead?: string; exploreRounds?: number },
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
      const now = new Date().toISOString();
      return saveProjectKnowledgeViaFileApi(trimmed, body, {
        updatedAt: now,
        lastExploredAt: options?.fromExplore ? now : undefined,
        exploreRounds: options?.exploreRounds,
        gitHead: options?.gitHead,
      });
    }
    return await readJsonResponse<ProjectKnowledgePayload>(response);
  } catch (error) {
    const message = formatFetchError(error, "保存项目知识库失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      const now = new Date().toISOString();
      return saveProjectKnowledgeViaFileApi(trimmed, body, {
        updatedAt: now,
        lastExploredAt: options?.fromExplore ? now : undefined,
        exploreRounds: options?.exploreRounds,
        gitHead: options?.gitHead,
      });
    }
    return { ok: false, error: message };
  }
}
