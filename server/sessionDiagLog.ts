import fs from "node:fs";
import path from "node:path";

const TAG = "[session-diag]";

export function sessionDiagServer(event: string, data: Record<string, unknown> = {}) {
  const line = `[${new Date().toISOString()}] ${TAG} ${event} ${JSON.stringify(data)}`;
  const logPath = path.join(process.cwd(), ".debug.log");
  try {
    fs.appendFileSync(logPath, line + "\n");
  } catch {
    // ignore
  }
}
