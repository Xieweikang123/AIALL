/**
 * Print agent routing regression pass rate from .aiall/agent-regression.json
 *
 * Web/shared parity: validates TS intent classifier + src/services/agentRunPolicy fields.
 * Desktop policy fields are validated first by scripts/agent-regression-rust.ts (Rust).
 *
 * Usage: npm run agent:regression
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatAgentRegressionReport,
  loadAgentRegressionFile,
  runAgentRegression,
  defaultRegressionFilePath,
} from "../src/services/agentRegression";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filePath = defaultRegressionFilePath(projectRoot);
const file = loadAgentRegressionFile(filePath);
const report = runAgentRegression(file.cases);

console.log(formatAgentRegressionReport(report));

if (report.failed > 0) {
  process.exitCode = 1;
}
