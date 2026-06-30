import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAgentRunProfile, resolveAskExecutionEscalation } from "../src/services/agentRunProfile";
import {
  classifyUserIntentFromRules,
  resolveUserIntent,
  shouldSkipAiIntentClassifier,
} from "../src/services/intentClassifierRules";
import type { ConsultativeTopicId, UserIntentPrimary } from "../src/services/intentClassifierTypes";
import type { UserIntentHistoryMessage } from "../src/orchestration/agentIntentTypes";
import { normalizeExecutePlanContext } from "./agentExecutePlanContext";
import { resolveAgentRunPolicy, usesReadOnlyTools } from "./agentRunPolicy";

export type AgentRegressionMode = "ask" | "build" | "plan" | "explore";

export interface AgentRegressionExpect {
  consultative?: boolean;
  consultativeTopic?: ConsultativeTopicId;
  primary?: UserIntentPrimary;
  implementFollowUp?: boolean;
  skipAiClassifier?: boolean;
  runProfileKind?: "interactive" | "execute_plan";
  readOnlyBuildRun?: boolean;
  readOnlyTools?: boolean;
  implementFollowUpRun?: boolean;
  uiDefectBuildRun?: boolean;
  consultativeUiAppearanceRun?: boolean;
  ultraShortOpenTaskRun?: boolean;
  codeReviewRun?: boolean;
  sameIssueFollowUpRun?: boolean;
  behaviorContradictionRun?: boolean;
  scheduledTaskConsultativeRun?: boolean;
  exploreHardCap?: number;
  maxContextChars?: number;
  automatedBugFixRun?: boolean;
  disableSegmentAutoExtend?: boolean;
}

export interface AgentRegressionCase {
  id: string;
  description?: string;
  prompt: string;
  mode: AgentRegressionMode;
  history?: UserIntentHistoryMessage[];
  lastAssistant?: string;
  hasImage?: boolean;
  runProfile?: {
    kind?: "interactive" | "execute_plan";
    triggerSource?: "auto_bug_fix";
    targetFiles?: string[];
  };
  expect: AgentRegressionExpect;
}

export interface AgentRegressionFile {
  version: number;
  cases: AgentRegressionCase[];
}

export interface AgentRegressionMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface AgentRegressionCaseResult {
  id: string;
  passed: boolean;
  mismatches: AgentRegressionMismatch[];
}

export interface AgentRegressionReport {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: AgentRegressionCaseResult[];
}

const EXPECT_FIELDS = new Set<string>([
  "consultative",
  "consultativeTopic",
  "primary",
  "implementFollowUp",
  "skipAiClassifier",
  "runProfileKind",
  "readOnlyBuildRun",
  "readOnlyTools",
  "implementFollowUpRun",
  "uiDefectBuildRun",
  "consultativeUiAppearanceRun",
  "ultraShortOpenTaskRun",
  "codeReviewRun",
  "sameIssueFollowUpRun",
  "behaviorContradictionRun",
  "scheduledTaskConsultativeRun",
  "quotedAmendRun",
  "exploreHardCap",
  "maxContextChars",
  "automatedBugFixRun",
  "disableSegmentAutoExtend",
]);

export function defaultRegressionFilePath(projectRoot = process.cwd()): string {
  return path.join(projectRoot, ".aiall", "agent-regression.json");
}

/** Bundled regression cases shipped with the repo (CI / fresh clones). */
export function bundledRegressionFilePath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "agent-regression.json");
}

export function resolveDefaultRegressionFilePath(projectRoot = process.cwd()): string {
  const local = defaultRegressionFilePath(projectRoot);
  if (fs.existsSync(local)) return local;
  return bundledRegressionFilePath();
}

export function loadAgentRegressionFile(filePath: string): AgentRegressionFile {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as AgentRegressionFile;
  if (!parsed?.cases?.length) {
    throw new Error(`agent regression file has no cases: ${filePath}`);
  }
  return parsed;
}

function profileMode(mode: AgentRegressionMode): "ask" | "build" | "plan" {
  if (mode === "explore") return "build";
  return mode;
}

function pushMismatch(
  mismatches: AgentRegressionMismatch[],
  field: string,
  expected: unknown,
  actual: unknown,
): void {
  if (Object.is(expected, actual)) return;
  mismatches.push({ field, expected, actual });
}

export function evaluateAgentRegressionCase(caseInput: AgentRegressionCase): AgentRegressionCaseResult {
  const { prompt, mode, history, lastAssistant, hasImage = false, expect } = caseInput;
  const mismatches: AgentRegressionMismatch[] = [];
  const isAsk = mode === "ask";
  const isExplore = mode === "explore";
  const isReadOnlyAgent = isAsk || isExplore;

  const rulesIntent = classifyUserIntentFromRules({
    prompt,
    history,
    mode,
    hasImage,
    isAsk,
  });
  const userIntent = resolveUserIntent({
    prompt,
    history,
    mode,
    hasImage,
    isAsk,
    ai: null,
  });

  const profileModeValue = profileMode(mode);
  const askEscalation =
    mode === "ask"
      ? resolveAskExecutionEscalation({
          prompt,
          mode: "ask",
          lastAssistantContent: lastAssistant,
          history,
        })
      : null;
  const clientProfile =
    askEscalation?.runProfile ??
    (caseInput.runProfile
      ? { kind: caseInput.runProfile.kind ?? "execute_plan", ...caseInput.runProfile }
      : resolveAgentRunProfile({
          prompt,
          mode: profileModeValue,
          lastAssistantContent: lastAssistant,
          history,
        }));
  const runProfile = normalizeExecutePlanContext(clientProfile);
  const isExecutePlan = runProfile.kind === "execute_plan";
  const isPlanExplore = mode === "plan" && !isExecutePlan;

  const policy = resolveAgentRunPolicy({
    prompt,
    mode,
    history,
    userIntent,
    runProfile,
    hasImage,
    isExecutePlan,
    isPlanExplore,
  });

  const readOnlyTools = usesReadOnlyTools(policy, { isReadOnlyAgent, isPlanExplore });
  const skipAiClassifier = shouldSkipAiIntentClassifier(rulesIntent, prompt, { isAsk });

  const actual: Record<string, unknown> = {
    consultative: userIntent.consultative,
    consultativeTopic: userIntent.consultativeTopic,
    primary: userIntent.primary,
    implementFollowUp: userIntent.implementFollowUp,
    skipAiClassifier,
    runProfileKind: runProfile.kind,
    readOnlyBuildRun: policy.readOnlyBuildRun,
    readOnlyTools,
    implementFollowUpRun: policy.implementFollowUpRun,
    uiDefectBuildRun: policy.uiDefectBuildRun,
    consultativeUiAppearanceRun: policy.consultativeUiAppearanceRun,
    ultraShortOpenTaskRun: policy.ultraShortOpenTaskRun,
    codeReviewRun: policy.codeReviewRun,
    sameIssueFollowUpRun: policy.sameIssueFollowUpRun,
    behaviorContradictionRun: policy.behaviorContradictionRun,
    scheduledTaskConsultativeRun: policy.scheduledTaskConsultativeRun,
    quotedAmendRun: policy.quotedAmendRun,
    exploreHardCap: policy.exploreHardCap,
    maxContextChars: policy.maxContextChars,
    automatedBugFixRun: policy.automatedBugFixRun,
    disableSegmentAutoExtend: policy.disableSegmentAutoExtend,
  };

  for (const [field, expected] of Object.entries(expect)) {
    if (!EXPECT_FIELDS.has(field)) {
      mismatches.push({ field, expected, actual: `unknown expect field "${field}"` });
      continue;
    }
    pushMismatch(mismatches, field, expected, actual[field]);
  }

  return {
    id: caseInput.id,
    passed: mismatches.length === 0,
    mismatches,
  };
}

export function runAgentRegression(cases: AgentRegressionCase[]): AgentRegressionReport {
  const results = cases.map((item) => evaluateAgentRegressionCase(item));
  const passed = results.filter((item) => item.passed).length;
  const total = results.length;
  return {
    total,
    passed,
    failed: total - passed,
    passRate: total ? passed / total : 1,
    results,
  };
}

export function formatAgentRegressionReport(report: AgentRegressionReport): string {
  const lines = [
    `Agent regression: ${report.passed}/${report.total} passed (${(report.passRate * 100).toFixed(1)}%)`,
  ];
  for (const result of report.results) {
    if (result.passed) continue;
    lines.push(`  ✗ ${result.id}`);
    for (const mismatch of result.mismatches) {
      lines.push(`      ${mismatch.field}: expected ${JSON.stringify(mismatch.expected)}, got ${JSON.stringify(mismatch.actual)}`);
    }
  }
  return lines.join("\n");
}

export function loadAndRunAgentRegression(projectRoot = process.cwd()): AgentRegressionReport {
  const filePath = resolveDefaultRegressionFilePath(projectRoot);
  const file = loadAgentRegressionFile(filePath);
  return runAgentRegression(file.cases);
}
