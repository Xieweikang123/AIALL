/**
 * Print agent routing regression pass rate from .aiall/agent-regression.json
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
} from "../server/agentRegression";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filePath = defaultRegressionFilePath(projectRoot);
const file = loadAgentRegressionFile(filePath);
const report = runAgentRegression(file.cases);

console.log(formatAgentRegressionReport(report));

if (report.failed > 0) {
  process.exitCode = 1;
}
