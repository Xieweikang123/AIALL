import fs from "node:fs";
import path from "node:path";

/**
 * Terms that must not appear in agent orchestration sources (classifiers, hints, trace guards).
 * Product code (Vue components, storage APIs) is out of scope.
 */
export const FORBIDDEN_ORCHESTRATION_TERMS = [
  "NoRefund",
  "PartialRefund",
  "FullRefund",
  "switchVibeSession",
  "project-history",
  "FilePanel",
  "ChatPanel",
  "VibeCodingView",
  "EnergyRecord",
  "gw_energy",
  "粘贴图片",
  "WorkOrder",
  "引用按钮",
] as const;

/** Repo-relative paths scanned by orchestration guard tests. */
export const ORCHESTRATION_GUARDED_RELATIVE_PATHS = [
  "src/services/agentUserIntent.ts",
  "src/services/agentReplyAccuracy.ts",
  "src/services/agentStructuralPatterns.ts",
  "src/services/agentConsultativeTopics.ts",
  "src/services/agentScheduledTask.ts",
  "src/services/agentContinuation.ts",
  "server/consultativeBehaviorTrace.ts",
  "server/agentExplorationBudget.ts",
  "server/agentAskPrompt.ts",
] as const;

export function findForbiddenTermsInSource(source: string): string[] {
  const hits = new Set<string>();
  for (const term of FORBIDDEN_ORCHESTRATION_TERMS) {
    if (source.includes(term)) hits.add(term);
  }
  return [...hits];
}

export function scanOrchestrationGuardedFiles(repoRoot: string): Map<string, string[]> {
  const results = new Map<string, string[]>();
  for (const rel of ORCHESTRATION_GUARDED_RELATIVE_PATHS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const source = fs.readFileSync(abs, "utf8");
    const hits = findForbiddenTermsInSource(source);
    if (hits.length) results.set(rel, hits);
  }
  return results;
}
