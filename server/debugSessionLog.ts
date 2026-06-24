import fs from "node:fs";
import path from "node:path";

const DEBUG_INGEST = "http://127.0.0.1:7681/ingest/c6f6b2fb-2f39-4dd4-897b-699ca68db244";
const DEBUG_SESSION = "a6a71f";
const DEBUG_LOG_FILE = path.join(process.cwd(), ".cursor", "debug-a6a71f.log");

export function debugSessionLog(
  location: string,
  message: string,
  data?: Record<string, unknown>,
  hypothesisId?: string,
): void {
  const payload = {
    sessionId: DEBUG_SESSION,
    location,
    message,
    data,
    hypothesisId,
    timestamp: Date.now(),
  };
  // #region agent log
  fetch(DEBUG_INGEST, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": DEBUG_SESSION,
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_FILE), { recursive: true });
    fs.appendFileSync(DEBUG_LOG_FILE, `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore
  }
  // #endregion
}
