import { backendUrl } from "./backendBase";
import { invokeBackend } from "./tauriInvoke";
import { formatFetchError, readJsonResponse } from "./vibeCodingClient";
import {
  isVerifyRunRequestFailed,
  type ProjectVerifyRunPayload,
} from "../../shared/projectVerifyRun";

export type ProjectVerifyRunResult = ProjectVerifyRunPayload & {
  error?: string;
};

function emptyVerifyResult(projectPath: string, error: string): ProjectVerifyRunResult {
  return {
    ok: false,
    error,
    projectPath,
    command: "",
    exitCode: -1,
    durationMs: 0,
    stdout: "",
    stderr: "",
    failingFiles: [],
    ranAt: "",
  };
}

export async function fetchProjectVerifyRun(projectPath: string): Promise<ProjectVerifyRunResult> {
  const trimmed = projectPath.trim();
  if (!trimmed) return emptyVerifyResult("", "缺少 projectPath");
  return invokeBackend<ProjectVerifyRunResult>(
    "project_verify_run",
    { projectPath: trimmed },
    async () => {
      try {
        const url = backendUrl(
          `/backend/vibe/project-verify-run?projectPath=${encodeURIComponent(trimmed)}`,
        );
        const response = await fetch(url, { method: "POST" });
        const data = await readJsonResponse<ProjectVerifyRunPayload & { error?: string }>(response);
        if (isVerifyRunRequestFailed(data) || (!response.ok && !data.ranAt)) {
          return emptyVerifyResult(trimmed, data.error || "项目验证运行失败");
        }
        return data;
      } catch (error) {
        return emptyVerifyResult(trimmed, formatFetchError(error, "项目验证运行失败"));
      }
    },
  );
}

export {
  compareVerifyRuns,
  formatVerifyComparisonSummary,
  getVerifyEnvironmentNote,
  isVerifyRunRequestFailed,
} from "../../shared/projectVerifyRun";
