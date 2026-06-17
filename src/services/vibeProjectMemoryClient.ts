import { backendUrl } from "./backendBase";
import {
  formatFetchError,
  readFile,
  readJsonResponse,
  writeFile,
} from "./vibeCodingClient";

export type ProjectMemoryPayload = {
  ok: boolean;
  content?: string;
  truncated?: boolean;
  path?: string;
  maxChars?: number;
  size?: number;
  error?: string;
};

export const PROJECT_MEMORY_REL_PATH = ".aiall/project-memory.md";
export const PROJECT_MEMORY_MAX_CHARS = 3_500;

function normalizeProjectMemoryContent(raw: string): { content: string; truncated: boolean } {
  const trimmed = raw.replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= PROJECT_MEMORY_MAX_CHARS) {
    return { content: trimmed, truncated: false };
  }
  return {
    content: `${trimmed.slice(0, PROJECT_MEMORY_MAX_CHARS)}\n\n…（已截断）`,
    truncated: true,
  };
}

function isMissingFileError(message?: string): boolean {
  return Boolean(message && /不存在|not found|ENOENT/i.test(message));
}

async function fetchProjectMemoryViaFileApi(projectPath: string): Promise<ProjectMemoryPayload> {
  const read = await readFile(PROJECT_MEMORY_REL_PATH, projectPath);
  if (!read.ok) {
    if (isMissingFileError(read.error)) {
      return {
        ok: true,
        content: "",
        truncated: false,
        path: PROJECT_MEMORY_REL_PATH,
        maxChars: PROJECT_MEMORY_MAX_CHARS,
      };
    }
    return { ok: false, error: read.error || "读取项目记忆失败" };
  }

  const normalized = normalizeProjectMemoryContent(read.content);
  return {
    ok: true,
    content: normalized.content,
    truncated: normalized.truncated,
    path: PROJECT_MEMORY_REL_PATH,
    maxChars: PROJECT_MEMORY_MAX_CHARS,
  };
}

async function saveProjectMemoryViaFileApi(
  projectPath: string,
  content: string,
): Promise<ProjectMemoryPayload> {
  const normalized = normalizeProjectMemoryContent(content);
  const write = await writeFile(PROJECT_MEMORY_REL_PATH, normalized.content, projectPath);
  if (!write.ok) {
    return { ok: false, error: write.error || "保存项目记忆失败" };
  }
  return {
    ok: true,
    path: PROJECT_MEMORY_REL_PATH,
    size: write.size,
    truncated: normalized.truncated,
    content: normalized.content,
    maxChars: PROJECT_MEMORY_MAX_CHARS,
  };
}

export async function fetchProjectMemory(projectPath: string): Promise<ProjectMemoryPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const url = backendUrl(
      `/backend/vibe/project-memory?projectPath=${encodeURIComponent(trimmed)}`,
    );
    const response = await fetch(url);
    if (response.ok) {
      return await readJsonResponse<ProjectMemoryPayload>(response);
    }
    if (response.status === 404 || response.status === 405) {
      return fetchProjectMemoryViaFileApi(trimmed);
    }
    const data = await readJsonResponse<ProjectMemoryPayload>(response);
    return data;
  } catch (error) {
    const message = formatFetchError(error, "读取项目记忆失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return fetchProjectMemoryViaFileApi(trimmed);
    }
    return { ok: false, error: message };
  }
}

export async function saveProjectMemory(
  projectPath: string,
  content: string,
): Promise<ProjectMemoryPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const response = await fetch(backendUrl("/backend/vibe/project-memory"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath: trimmed, content }),
    });
    if (response.ok) {
      return await readJsonResponse<ProjectMemoryPayload>(response);
    }
    if (response.status === 404 || response.status === 405) {
      return saveProjectMemoryViaFileApi(trimmed, content);
    }
    return await readJsonResponse<ProjectMemoryPayload>(response);
  } catch (error) {
    const message = formatFetchError(error, "保存项目记忆失败");
    if (/HTML|无效 JSON|空响应/i.test(message)) {
      return saveProjectMemoryViaFileApi(trimmed, content);
    }
    return { ok: false, error: message };
  }
}
