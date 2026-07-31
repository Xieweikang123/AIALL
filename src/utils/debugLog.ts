import { invoke } from "@tauri-apps/api/core";

/** Bare filename under `%APPDATA%/aiall/debug-logs[/project-slug]/`. */
const LOG_FILE = "debug.log";
const CRASH_LOG_FILE = "crash.log";

let projectRoot = "";

export function setDebugLogProjectRoot(root: string) {
  projectRoot = root;
}

type PendingLine = { path: string; line: string };
let pendingLogs: PendingLine[] = [];
let crashHandlersInstalled = false;

async function appendLine(path: string, line: string, opts?: { scopedToProject?: boolean }) {
  // crash.log stays app-global so Rust panic + frontend share one file
  const scopedRoot =
    path === CRASH_LOG_FILE || opts?.scopedToProject === false
      ? undefined
      : projectRoot || undefined;
  try {
    await invoke("system_debug_log_append", {
      path,
      line,
      projectRoot: scopedRoot,
    });
  } catch {
    pendingLogs.push({ path, line });
  }
}

async function tryInvoke(path: string, label: string, data?: unknown) {
  const timestamp = new Date().toISOString().slice(11, 23);
  const line =
    data !== undefined
      ? `[${timestamp}] ${label}: ${typeof data === "string" ? data : JSON.stringify(data, null, 0)}`
      : `[${timestamp}] ${label}`;
  await appendLine(path, line);
}

async function flushPending() {
  if (!pendingLogs.length) return;
  const batch = pendingLogs.splice(0);
  for (const item of batch) {
    const scopedRoot = item.path === CRASH_LOG_FILE ? undefined : projectRoot || undefined;
    try {
      await invoke("system_debug_log_append", {
        path: item.path,
        line: item.line,
        projectRoot: scopedRoot,
      });
    } catch {
      pendingLogs.push(item);
    }
  }
}

export function debugLog(label: string, data?: unknown) {
  void tryInvoke(LOG_FILE, label, data);
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack?.trim();
    return stack ? `${err.name}: ${err.message}\n${stack}` : `${err.name}: ${err.message}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Append a line to crash.log (process restart / JS fatal diagnostics). */
export function crashLog(kind: string, detail?: unknown) {
  const stamp = new Date().toISOString();
  const body =
    detail === undefined ? kind : `${kind}: ${formatUnknownError(detail).replace(/\n/g, " | ")}`;
  void appendLine(CRASH_LOG_FILE, `[${stamp}] [frontend] ${body}`);
}

export function logAppLifecycle(event: string) {
  crashLog(`lifecycle ${event}`);
}

/**
 * Install global JS crash hooks once.
 * Writes to `%APPDATA%/aiall/debug-logs/crash.log`.
 */
export function installCrashHandlers(): void {
  if (crashHandlersInstalled || typeof window === "undefined") return;
  crashHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    const parts = [
      event.message || "ErrorEvent",
      event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : "",
      event.error ? formatUnknownError(event.error) : "",
    ].filter(Boolean);
    crashLog("window.onerror", parts.join(" | "));
  });

  window.addEventListener("unhandledrejection", (event) => {
    crashLog("unhandledrejection", event.reason);
  });

  window.addEventListener("pagehide", () => {
    logAppLifecycle("pagehide");
  });
}

export function reportVueError(err: unknown, info: string) {
  crashLog("vue-errorHandler", `${info} | ${formatUnknownError(err)}`);
}

export function clearDebugLog() {
  void invoke("system_debug_log_append", {
    path: LOG_FILE,
    line: "--- cleared ---",
    projectRoot: projectRoot || undefined,
  }).catch(() => {});
}

/** Append to a named AppData debug log (bare filename only, e.g. `tab-perf.log`). */
export function appendDebugLogFile(path: string, content: string, label?: string) {
  const line = `[${new Date().toISOString()}] ${label ? label + " | " : ""}${content}`;
  void appendLine(path, line);
}

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    void flushPending();
  }, 500);
});
