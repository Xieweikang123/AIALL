import { backendUrl } from "../services/backendBase";
import { isTauriEnv, tauriInvoke } from "../services/tauriInvoke";

function allowHttpFallbackInNodeTests(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.VITEST);
}

/** Append one line to a debug log file (project-relative when projectRoot is set). */
export function appendDebugLogFile(path: string, line: string, projectRoot?: string): void {
  if (isTauriEnv()) {
    void tauriInvoke("system_debug_log_append", {
      path,
      line,
      projectRoot: projectRoot?.trim() || null,
    }).catch(() => {});
    return;
  }
  if (!allowHttpFallbackInNodeTests()) return;
  fetch(backendUrl("/backend/vibe/log"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, line, projectRoot: projectRoot?.trim() || undefined }),
  }).catch(() => {});
}

export function debugLog(...args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`;
  appendDebugLogFile(".debug.log", line);
}
