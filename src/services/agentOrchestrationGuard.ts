import fs from "node:fs";
import path from "node:path";
import {
  GENERIC_CLASSIFIER_PATHS,
  GENERIC_MECHANISM_PATHS,
  ORCHESTRATION_GUARDED_RELATIVE_PATHS,
  PRODUCT_ORCHESTRATION_PATHS,
  tierForGuardedPath,
  type OrchestrationTier,
} from "../orchestration/orchestrationTiers";

export {
  GENERIC_CLASSIFIER_PATHS,
  GENERIC_MECHANISM_PATHS,
  ORCHESTRATION_GUARDED_RELATIVE_PATHS,
  PRODUCT_ORCHESTRATION_PATHS,
  tierForGuardedPath,
  type OrchestrationTier,
} from "../orchestration/orchestrationTiers";

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

/** Conditional fix recipes belong in dynamic hints, not always-on system prompt strings. */
export const STATIC_FIX_RECIPE_RE =
  /用户要求[「""].{4,48}[」""]时：|常见修复[为:：]/i;

export function findForbiddenTermsInSource(source: string): string[] {
  const hits = new Set<string>();
  for (const term of FORBIDDEN_ORCHESTRATION_TERMS) {
    if (source.includes(term)) hits.add(term);
  }
  return [...hits];
}

export function findStaticFixRecipeViolations(source: string): string[] {
  return STATIC_FIX_RECIPE_RE.test(source) ? ["static fix recipe (use dynamic build*Hint instead)"] : [];
}

export function findOrchestrationViolations(source: string, tier: OrchestrationTier): string[] {
  const hits = findForbiddenTermsInSource(source);
  if (tier === "product") return hits;
  return [...hits, ...findStaticFixRecipeViolations(source)];
}

export function scanOrchestrationGuardedFiles(repoRoot: string): Map<string, string[]> {
  const results = new Map<string, string[]>();
  for (const rel of ORCHESTRATION_GUARDED_RELATIVE_PATHS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const source = fs.readFileSync(abs, "utf8");
    const hits = findOrchestrationViolations(source, tierForGuardedPath(rel));
    if (hits.length) results.set(rel, hits);
  }
  return results;
}
