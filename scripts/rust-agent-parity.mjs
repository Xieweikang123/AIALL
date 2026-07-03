/**
 * Run Rust Agent parity unit tests (finish gate, exploration, explore guard, policy).
 * Usage: npm run test:rust-agent
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.join(root, "src-tauri");

const result = spawnSync(
  "cargo",
  ["test", "agent::", "--quiet"],
  {
    cwd: tauriDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) {
  console.error("[rust-agent-parity] failed to spawn cargo:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
