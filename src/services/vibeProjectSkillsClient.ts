import { backendUrl } from "./backendBase";
import { formatFetchError, readJsonResponse } from "./vibeCodingClient";
import type { ExplorationIndexEntry, SkillIndexEntry } from "./projectSkills";

export type ProjectSkillsListPayload = {
  ok: boolean;
  skills?: SkillIndexEntry[];
  exploration?: ExplorationIndexEntry[];
  error?: string;
};

export type ProjectSkillReadPayload = {
  ok: boolean;
  slug?: string;
  path?: string;
  frontmatter?: { kind: string; title: string; updatedAt?: string };
  body?: string;
  error?: string;
};

export type ProjectSkillUpsertPayload = {
  ok: boolean;
  slug?: string;
  path?: string;
  error?: string;
};

export type ExplorationArchivePayload = {
  ok: boolean;
  path?: string;
  id?: string;
  error?: string;
};

export async function fetchProjectSkills(projectPath: string): Promise<ProjectSkillsListPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const response = await fetch(
      backendUrl(`/backend/vibe/project-skills?projectPath=${encodeURIComponent(trimmed)}`),
    );
    const data = await readJsonResponse<
      ProjectSkillsListPayload & { index?: { skills?: SkillIndexEntry[]; exploration?: ExplorationIndexEntry[] } }
    >(response);
    if (!data.ok) return data;
    return {
      ok: true,
      skills: data.skills ?? data.index?.skills ?? [],
      exploration: data.exploration ?? data.index?.exploration ?? [],
    };
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "读取 skills 失败") };
  }
}

export async function fetchProjectSkill(
  projectPath: string,
  slug: string,
): Promise<ProjectSkillReadPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const response = await fetch(
      backendUrl(
        `/backend/vibe/project-skills?projectPath=${encodeURIComponent(trimmed)}&slug=${encodeURIComponent(slug)}`,
      ),
    );
    return await readJsonResponse<ProjectSkillReadPayload>(response);
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "读取 skill 失败") };
  }
}

export async function upsertProjectSkill(
  projectPath: string,
  payload: { slug: string; kind: "fact" | "heuristic" | "preference"; title: string; content: string },
): Promise<ProjectSkillUpsertPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const response = await fetch(backendUrl("/backend/vibe/project-skills"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath: trimmed, action: "upsert", ...payload }),
    });
    return await readJsonResponse<ProjectSkillUpsertPayload>(response);
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "写入 skill 失败") };
  }
}

export async function archiveExplorationSnapshot(
  projectPath: string,
  payload: {
    filename: string;
    content: string;
    readCount: number;
    writtenCount: number;
  },
): Promise<ExplorationArchivePayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" };
  try {
    const response = await fetch(backendUrl("/backend/vibe/project-skills"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: trimmed,
        action: "archive",
        filename: payload.filename,
        archiveContent: payload.content,
        readCount: payload.readCount,
        writtenCount: payload.writtenCount,
      }),
    });
    return await readJsonResponse<ExplorationArchivePayload>(response);
  } catch (error) {
    return { ok: false, error: formatFetchError(error, "归档探索快照失败") };
  }
}
