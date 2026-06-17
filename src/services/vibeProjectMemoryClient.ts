import { backendUrl } from "./backendBase";
import { formatFetchError } from "./vibeCodingClient";

export type ProjectMemoryPayload = {
  ok: boolean;
  content?: string;
  truncated?: boolean;
  path?: string;
  maxChars?: number;
  size?: number;
  error?: string;
};

export async function fetchProjectMemory(projectPath: string): Promise<ProjectMemoryPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const url = backendUrl(
      `/backend/vibe/project-memory?projectPath=${encodeURIComponent(trimmed)}`,
    );
    const response = await fetch(url);
    return (await response.json()) as ProjectMemoryPayload;
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "读取项目记忆失败") };
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
    return (await response.json()) as ProjectMemoryPayload;
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "保存项目记忆失败") };
  }
}
