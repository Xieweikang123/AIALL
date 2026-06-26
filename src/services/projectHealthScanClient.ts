import { backendUrl } from "./backendBase";
import { formatFetchError, readJsonResponse } from "./vibeCodingClient";
import {
  buildCodeReviewPrompt,
  healthIssueCount,
  type HealthIssue,
  type HealthIssueCategory,
  type HealthIssueSeverity,
  type ProjectHealthScanPayload,
} from "../../shared/projectHealthScan";

export type {
  HealthIssue,
  HealthIssueCategory,
  HealthIssueSeverity,
  ProjectHealthScanPayload,
};

export type ProjectHealthScanResult = ProjectHealthScanPayload & {
  ok: boolean;
  error?: string;
};

export { buildCodeReviewPrompt, healthIssueCount };

export async function fetchProjectHealthScan(projectPath: string): Promise<ProjectHealthScanResult> {
  const trimmed = projectPath.trim();
  if (!trimmed) return { ok: false, error: "缺少 projectPath" } as ProjectHealthScanResult;
  try {
    const url = backendUrl(
      `/backend/vibe/project-health-scan?projectPath=${encodeURIComponent(trimmed)}`,
    );
    const response = await fetch(url);
    const data = await readJsonResponse<ProjectHealthScanPayload & { ok?: boolean; error?: string }>(response);
    if (data.ok === false || data.error) {
      return { ok: false, error: data.error || "项目体检失败" } as ProjectHealthScanResult;
    }
    return { ok: true, ...data };
  } catch (error) {
    return {
      ok: false,
      error: formatFetchError(error, "项目体检失败"),
    } as ProjectHealthScanResult;
  }
}
