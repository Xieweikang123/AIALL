import { invokeBackend, isTauriEnv, webRequiresTauriError } from "./tauriInvoke";

export interface DebugLogEntry {
  relativePath: string;
  name: string;
  scope: "app" | "project";
  projectSlug?: string;
}

/** List all debug log files under AppData debug-logs (root + per-project). Desktop runtime only. */
export async function listDebugLogs(): Promise<DebugLogEntry[]> {
  if (!isTauriEnv()) throw webRequiresTauriError();
  return invokeBackend<DebugLogEntry[]>("system_debug_log_list", {});
}

/** Read a debug log file by relative path (`name.log` or `slug/name.log`). Desktop runtime only. */
export async function readDebugLog(relativePath: string, limitLines?: number): Promise<string> {
  if (!isTauriEnv()) throw webRequiresTauriError();
  return invokeBackend<string>("system_debug_log_read", {
    relativePath,
    limitLines: limitLines ?? null,
  });
}
