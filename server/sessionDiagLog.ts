import fs from "node:fs";
import path from "node:path";

const TAG = "[session-diag]";
const DEBUG_LOG = path.join(process.cwd(), "debug-afe7ec.log");

function inferHypothesisId(event: string): string {
  if (event.includes("chat-session-sync")) return "H1";
  if (event.includes("chat-store-sync")) return "H2";
  if (event.includes("chat-store-load")) return "H3";
  return "H0";
}

export function sessionDiagServer(event: string, data: Record<string, unknown> = {}) {
  const line = `[${new Date().toISOString()}] ${TAG} ${event} ${JSON.stringify(data)}`;
  const logPath = path.join(process.cwd(), ".debug.log");
  try {
    fs.appendFileSync(logPath, line + "\n");
  } catch {
    // ignore
  }
  // #region agent log
  try {
    const ndjson = JSON.stringify({
      sessionId: "afe7ec",
      hypothesisId: inferHypothesisId(event),
      location: `sessionDiagServer:${event}`,
      message: event,
      data,
      timestamp: Date.now(),
      runId: "pre-fix",
    });
    fs.appendFileSync(DEBUG_LOG, ndjson + "\n");
  } catch {
    // ignore
  }
  // #endregion
}
