import {
  compressHistoryForExecution,
  extractPlanFilePaths,
  extractReferencedFilePaths,
  hasDirectImplementationIntent,
  isExecutionContinuation,
  looksLikeModificationPlan,
  stripQuotedReplyPrefix,
} from "./agentContinuation";

export type AgentRunKind = "interactive" | "execute_plan";

export {
  ASK_MAX_TURNS,
  EXECUTE_PLAN_MAX_TURNS,
  INTERACTIVE_BUILD_MAX_TURNS,
  resolveAgentMaxTurns,
} from "../../server/agentTurnBudget";

export interface AgentRunProfile {
  kind: AgentRunKind;
  targetFiles?: string[];
  userIntent?: string;
}

export interface ResolveAgentRunProfileInput {
  prompt: string;
  mode: "ask" | "build";
  lastAssistantContent?: string;
  referencedFiles?: string[];
}

const MAX_SCOPED_TARGET_FILES = 8;

function mergeTargetFiles(...groups: Array<string[] | undefined>): string[] | undefined {
  const merged = [...new Set(groups.flatMap((g) => g ?? []))];
  return merged.length ? merged : undefined;
}

function resolveScopedTargetFiles(input: ResolveAgentRunProfileInput): string[] {
  const fromRefs = input.referencedFiles?.length
    ? input.referencedFiles.map((p) => p.replace(/\\/g, "/").trim()).filter(Boolean)
    : extractReferencedFilePaths(input.prompt);
  return fromRefs.slice(0, MAX_SCOPED_TARGET_FILES);
}

/** Classify the run and derive scoped context — single entry for client-side agent orchestration. */
export function resolveAgentRunProfile(input: ResolveAgentRunProfileInput): AgentRunProfile {
  const { prompt, mode, lastAssistantContent } = input;
  const trimmed = prompt.trim();
  const body = stripQuotedReplyPrefix(trimmed);

  if (
    mode === "build" &&
    isExecutionContinuation(trimmed) &&
    lastAssistantContent &&
    looksLikeModificationPlan(lastAssistantContent)
  ) {
    const targetFiles = extractPlanFilePaths(lastAssistantContent);
    const lastUserIntent = summarizeIntent(body || trimmed);
    return {
      kind: "execute_plan",
      targetFiles: targetFiles.length ? targetFiles : undefined,
      userIntent: lastUserIntent,
    };
  }

  if (mode === "build") {
    const scopedFiles = resolveScopedTargetFiles(input);
    if (scopedFiles.length && hasDirectImplementationIntent(body || trimmed)) {
      return {
        kind: "execute_plan",
        targetFiles: scopedFiles,
        userIntent: summarizeIntent(body || trimmed),
      };
    }
  }

  return { kind: "interactive" };
}

export function buildAgentPromptForProfile(prompt: string, profile: AgentRunProfile): string {
  if (profile.kind !== "execute_plan") return prompt;
  const files = profile.targetFiles?.length ? profile.targetFiles.join("、") : "见上一轮方案";
  return [
    stripQuotedReplyPrefix(prompt.trim()) || prompt.trim(),
    "",
    "[精准修改] 用户已 @ 引用或明确要求修改，请直接动手，不要再次询问是否开始。",
    "流程：read_file 核对目标文件 → patch_file / write_file；大文件禁止整文件 write_file。",
    "探索仅限定位未知路径（grep/search），不要重复 read 已 @ 的文件全文。",
    `目标文件（待服务端校验）：${files}`,
  ].join("\n");
}

export function shapeAgentHistoryForProfile(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  profile: AgentRunProfile,
  currentPrompt: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (profile.kind !== "execute_plan") return history;
  return compressHistoryForExecution(history, currentPrompt);
}

function summarizeIntent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 160)}…`;
}
