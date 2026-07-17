import fs from "node:fs";
import path from "node:path";

const TAG = "[session-diag]";

export function sessionDiagServer(event: string, data: Record<string, unknown> = {}) {
  const line = `[${new Date().toISOString()}] ${TAG} ${event} ${JSON.stringify(data)}`;
  try {
    const dir = path.join(process.cwd(), ".debug");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "debug.log"), line + "\n");
  } catch {
    // ignore
  }
}
