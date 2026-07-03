import { backendUrl } from "./backendBase";
import { invokeBackend } from "./tauriInvoke";
import { formatFetchError, readJsonResponse, writeFile } from "./vibeCodingClient";
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
  if (!trimmed) return { ok: false, error: "缂哄皯 projectPath" };
  return invokeBackend<ProjectSkillsListPayload>(
    "project_skills_list",
    { projectPath: trimmed },
    async () => {
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
    },
  );
}

export async function fetchProjectSkill(
  projectPath: string,
  slug: string,
): Promise<ProjectSkillReadPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缂哄皯 projectPath" };
  return invokeBackend<ProjectSkillReadPayload>(
    "project_skills_list",
    { projectPath: trimmed, slug },
    async () => {
      const response = await fetch(
        backendUrl(
          `/backend/vibe/project-skills?projectPath=${encodeURIComponent(trimmed)}&slug=${encodeURIComponent(slug)}`,
        ),
      );
      return readJsonResponse<ProjectSkillReadPayload>(response);
    },
  );
}

export async function upsertProjectSkill(
  projectPath: string,
  payload: { slug: string; kind: "fact" | "heuristic" | "preference"; title: string; content: string },
): Promise<ProjectSkillUpsertPayload> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缂哄皯 projectPath" };
  return invokeBackend<ProjectSkillUpsertPayload>(
    "project_skills_save",
    { projectPath: trimmed, slug: payload.slug, content: payload.content },
    async () => {
      const response = await fetch(backendUrl("/backend/vibe/project-skills"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: trimmed, action: "upsert", ...payload }),
      });
      return readJsonResponse<ProjectSkillUpsertPayload>(response);
    },
  );
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
  if (!trimmed) return { ok: false, error: "缂哄皯 projectPath" };
  const write = await writeFile(`.aiall/exploration/${payload.filename}`, payload.content, trimmed);
  if (!write.ok) return { ok: false, error: write.error || "褰掓。鎺㈢储蹇収澶辫触" };
  return { ok: true, path: write.path, id: payload.filename };
}

