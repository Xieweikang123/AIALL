import { invoke } from "@tauri-apps/api/core";

const LOG_FILE = ".debug.log";

let projectRoot = "";

export function setDebugLogProjectRoot(root: string) {
  projectRoot = root;
}

let pendingLogs: string[] = [];

async function tryInvoke(label: string, data?: unknown) {
  const timestamp = new Date().toISOString().slice(11, 23);
  const line = data !== undefined
    ? `[${timestamp}] ${label}: ${typeof data === "string" ? data : JSON.stringify(data, null, 0)}`
    : `[${timestamp}] ${label}`;

  try {
    await invoke("system_debug_log_append", {
      path: LOG_FILE,
      line,
      projectRoot: projectRoot || undefined,
    });
  } catch {
    pendingLogs.push(line);
  }
}

async function flushPending() {
  if (!pendingLogs.length) return;
  const batch = pendingLogs.splice(0);
  for (const line of batch) {
    try {
      await invoke("system_debug_log_append", { path: LOG_FILE, line, projectRoot: projectRoot || undefined });
    } catch {
      pendingLogs.push(line);
    }
  }
}

export function debugLog(label: string, data?: unknown) {
  void tryInvoke(label, data);
}

export function clearDebugLog() {
  void invoke("system_debug_log_append", { path: LOG_FILE, line: "--- cleared ---", projectRoot: projectRoot || undefined }).catch(() => {});
}

export function appendDebugLogFile(path: string, content: string, label?: string) {
  const line = `[${new Date().toISOString()}] ${label ? label + " | " : ""}${content}`;
  void invoke("system_debug_log_append", { path, line, projectRoot: projectRoot || undefined }).catch(() => {});
}

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(flushPending, 500);
});
