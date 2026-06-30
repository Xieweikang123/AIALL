import { backendUrl } from "./backendBase";
import { formatFetchError, readJsonResponse } from "./vibeCodingClient";
import type { ProjectVerifyRunPayload } from "../../shared/projectVerifyRun";

export type ProjectVerifyRunResult = ProjectVerifyRunPayload & {
  ok: boolean;
  error?: string;
};

export async function fetchProjectVerifyRun(projectPath: string): Promise<ProjectVerifyRunResult> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" } as ProjectVerifyRunResult;
  try {
    const url = backendUrl(
      `/backend/vibe/project-verify-run?projectPath=${encodeURIComponent(trimmed)}`,
    );
    const response = await fetch(url, { method: "POST" });
    const data = await readJsonResponse<ProjectVerifyRunPayload & { ok?: boolean; error?: string }>(response);
    if (data.ok === false || data.error) {
      return { ok: false, error: data.error || "项目验证运行失败" } as ProjectVerifyRunResult;
    }
    return { ...data, ok: true };
  } catch (error) {
    return {
      ok: false,
      error: formatFetchError(error, "项目验证运行失败"),
    } as ProjectVerifyRunResult;
  }
}

export { compareVerifyRuns } from "../../shared/projectVerifyRun";
