/**
 * Headless Agent smoke — drives desktop Rust Agent (`cargo run --bin agent-smoke`).
 * See AGENT_SSOT.md.
 *
 * Usage:
 *   npm run agent:smoke -- --prompt "..."
 *   npm run agent:smoke -- --session <id> --no-image
 *
 * Env: AIALL_ENDPOINT, AIALL_API_KEY, AIALL_MODEL, AIALL_PROJECT, AIALL_TIMEOUT_MS
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.join(root, "src-tauri");
const passthrough = process.argv.slice(2);

const result = spawnSync(
  "cargo",
  ["run", "--quiet", "--bin", "agent-smoke", "--", ...passthrough],
  {
    cwd: tauriDir,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);

if (result.error) {
  console.error("[agent-smoke] failed to spawn cargo:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
