const DEBUG_INGEST = "http://127.0.0.1:7681/ingest/c6f6b2fb-2f39-4dd4-897b-699ca68db244";
const DEBUG_SESSION = "a6a71f";

/** Debug-mode NDJSON ingest (no secrets). */
export function debugSessionLog(
  location: string,
  message: string,
  data?: Record<string, unknown>,
  hypothesisId?: string,
): void {
  // #region agent log
  fetch(DEBUG_INGEST, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": DEBUG_SESSION,
    },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION,
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}
