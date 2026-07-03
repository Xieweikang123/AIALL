import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  buildAgentRegressionRustVectors,
  loadAgentRegressionFile,
  resolveDefaultRegressionFilePath,
} from "../src/services/agentRegression";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filePath = resolveDefaultRegressionFilePath(root);
const file = loadAgentRegressionFile(filePath);
const vectors = buildAgentRegressionRustVectors(file.cases);

const vectorsPath = path.join(root, "src-tauri", "agent-regression-vectors.json");
writeFileSync(vectorsPath, JSON.stringify({ vectors }, null, 2));

const policyFieldCount = vectors.reduce(
  (sum, item) => sum + Object.keys(item.expect).length,
  0,
);
console.log(
  `Rust agent regression: ${vectors.length} cases, ${policyFieldCount} policy field checks (desktop truth source)`,
);

const result = spawnSync(
  "cargo",
  ["test", "agent_regression_vectors_from_file", "--quiet", "--", "--nocapture"],
  {
    cwd: path.join(root, "src-tauri"),
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) {
  console.error("[agent-regression-rust] failed to spawn cargo:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
