import { buildImmediateTopicFollowUpHint } from "../../server/agentTopicFollowUp";
import { buildUiScopeFollowUpHint } from "../../server/visionMessage";
import {
  classifyAssistantReply,
  compressHistoryForExecution,
  extractPlanFilePaths,
  extractReferencedFilePaths,
  hasDirectImplementationIntent,
  isExecutionContinuation,
  looksLikeModificationPlan,
  stripQuotedReplyPrefix,
} from "./agentContinuation";
import { resolveAgentCompletedTurns, type AgentProgressSource, type AgentProgressTool } from "./agentRecovery";
import { isConsultativeUserPrompt, isUltraShortOpenTaskPrompt, type UserIntentHistoryMessage } from "./agentUserIntent";

export type AgentRunKind = "interactive" | "execute_plan";

export {
  ASK_MAX_TURNS,
  EXECUTE_PLAN_MAX_TURNS,
  INTERACTIVE_BUILD_MAX_TURNS,
  EXPLORE_MAX_TURNS,
  EXPLORE_QUICK_MAX_TURNS,
  EXPLORE_DEEP_MAX_TURNS,
  EXPLORE_FOLLOWUP_MAX_TURNS,
  PLAN_MAX_TURNS,
  resolveAgentMaxTurns,
  resolveResumeMaxTurns,
} from "../../server/agentTurnBudget";

export interface AgentRunProfile {
  kind: AgentRunKind;
  targetFiles?: string[];
  userIntent?: string;
}

export interface ResolveAgentRunProfileInput {
  prompt: string;
  mode: "ask" | "build" | "plan";
  lastAssistantContent?: string;
  referencedFiles?: string[];
  history?: UserIntentHistoryMessage[];
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
  const lastAssistantKind = lastAssistantContent ? classifyAssistantReply(lastAssistantContent) : "other";
  const followsReviewReport = lastAssistantKind === "audit_report";

  if (
    (mode === "build" || mode === "plan") &&
    isExecutionContinuation(trimmed) &&
    lastAssistantContent &&
    lastAssistantKind === "actionable_plan"
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
    const directBody = body || trimmed;
    if (isUltraShortOpenTaskPrompt(directBody)) {
      return { kind: "interactive" };
    }
    if (isConsultativeUserPrompt(directBody, input.history)) {
      return { kind: "interactive" };
    }
    const directIntent = hasDirectImplementationIntent(directBody);
    const isShortFollowUp = isExecutionContinuation(trimmed);
    if (directIntent) {
      if (followsReviewReport && isShortFollowUp) {
        return { kind: "interactive" };
      }
      let fromProposal: string[] = [];
      if (lastAssistantKind === "actionable_plan" && lastAssistantContent) {
        fromProposal = extractPlanFilePaths(lastAssistantContent);
      }
      const targetFiles = mergeTargetFiles(
        scopedFiles.length ? scopedFiles : undefined,
        fromProposal.length ? fromProposal : undefined,
      );
      return {
        kind: "execute_plan",
        targetFiles,
        userIntent: summarizeIntent(directBody),
      };
    }
  }

  return { kind: "interactive" };
}

/** Ask 模式下用户确认执行上一轮可执行方案时，自动升级到 Build + execute_plan。 */
export function resolveAskExecutionEscalation(
  input: ResolveAgentRunProfileInput,
): { mode: "build"; runProfile: AgentRunProfile } | null {
  if (input.mode !== "ask") return null;
  const trimmed = input.prompt.trim();
  if (!isExecutionContinuation(trimmed)) return null;
  const lastAssistant = input.lastAssistantContent?.trim();
  if (!lastAssistant) return null;
  if (classifyAssistantReply(lastAssistant) !== "actionable_plan") return null;

  const body = stripQuotedReplyPrefix(trimmed);
  const targetFiles = extractPlanFilePaths(lastAssistant);
  return {
    mode: "build",
    runProfile: {
      kind: "execute_plan",
      targetFiles: targetFiles.length ? targetFiles : undefined,
      userIntent: summarizeIntent(body || trimmed),
    },
  };
}

export function enrichAgentUserPrompt(
  prompt: string,
  options?: { lastAssistantContent?: string; hasImages?: boolean },
): string {
  let enriched = buildUiScopeFollowUpHint(prompt, options?.lastAssistantContent);
  enriched = buildImmediateTopicFollowUpHint(
    enriched,
    options?.lastAssistantContent,
    prompt,
  );
  if (!options?.hasImages && isExecutionContinuation(prompt.trim())) {
    enriched = [
      enriched,
      "",
      "【续跑确认】本条消息无附图；禁止写「看到截图/如图所示」等读图开场，直接基于上一轮方案执行。",
    ].join("\n");
  }
  return enriched;
}

export function buildAgentPromptForProfile(prompt: string, profile: AgentRunProfile): string {
  if (profile.kind !== "execute_plan") return prompt;
  const files = profile.targetFiles?.length
    ? profile.targetFiles.join("、")
    : "（未 @ 指定；用 1 次 grep 定位后立即 patch_file/write_file）";
  return [
    stripQuotedReplyPrefix(prompt.trim()) || prompt.trim(),
    "",
    "[精准修改] 用户已明确要求实施（如执行/继续/改吧/优化等）。禁止再问「需要我执行吗」「请确认后」；直接 patch_file / write_file。",
    "流程：grep 定位（如需）→ read_file 核对片段 → patch_file / write_file；大文件禁止整文件 write_file。",
    "探索最多 1–2 轮，然后必须写入代码；同一轮可并行多个 read_file。",
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

function extractTargetFilesFromTools(tools: AgentProgressTool[]): string[] {
  const paths = new Set<string>();
  const pathRe =
    /((?:[\w@.-]+\/)+[\w.-]+\.(?:vue|ts|tsx|js|jsx|json|md|css|scss|html|py|rs|go|toml))/gi;
  for (const tool of tools) {
    const args = (tool as AgentProgressTool & { args?: { path?: string } }).args;
    const fromArgs = args?.path?.replace(/\\/g, "/").trim();
    if (fromArgs) paths.add(fromArgs);
    for (const field of [tool.label, tool.detail, tool.title]) {
      if (!field) continue;
      for (const match of field.matchAll(pathRe)) {
        const rel = match[1]?.replace(/\\/g, "/").trim();
        if (rel) paths.add(rel);
      }
    }
  }
  return [...paths].slice(0, MAX_SCOPED_TARGET_FILES);
}

/** After partial runs, switch to execute_plan so resume skips broad exploration. */
export function resolveAgentResumeRunProfile(
  msg: AgentProgressSource,
  originalPrompt: string,
  mode: "ask" | "build" | "plan",
  lastAssistantContent?: string,
  history?: UserIntentHistoryMessage[],
): AgentRunProfile {
  const strippedPrompt = stripQuotedReplyPrefix(originalPrompt.trim());
  const base = resolveAgentRunProfile({
    prompt: strippedPrompt,
    mode,
    lastAssistantContent,
  });
  if (mode !== "build" && mode !== "plan") return base;
  if (isConsultativeUserPrompt(strippedPrompt, history)) return base;

  const turns = resolveAgentCompletedTurns(msg);
  const completedTools = msg.tools?.filter((t) => !t.running) ?? [];
  const fromWritten = [
    ...(msg.writtenFiles ?? []),
    ...Object.keys(msg.turnFileDiffs ?? {}),
  ].map((p) => p.replace(/\\/g, "/").trim());
  const fromTools = extractTargetFilesFromTools(completedTools);
  const mergedTargets = [...new Set([...(base.targetFiles ?? []), ...fromWritten, ...fromTools])].slice(
    0,
    MAX_SCOPED_TARGET_FILES,
  );

  if (base.kind === "execute_plan") {
    if (!mergedTargets.length) return base;
    return { ...base, targetFiles: mergedTargets };
  }

  if (turns < 2 && completedTools.length < 4) return base;

  return {
    kind: "execute_plan",
    targetFiles: mergedTargets.length ? mergedTargets : undefined,
    userIntent: summarizeIntent(originalPrompt),
  };
}
