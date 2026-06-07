import {
  compressHistoryForExecution,
  extractPlanFilePaths,
  isExecutionContinuation,
  looksLikeModificationPlan,
} from "./agentContinuation";

export type AgentRunKind = "interactive" | "execute_plan";

export interface AgentRunProfile {
  kind: AgentRunKind;
  targetFiles?: string[];
  userIntent?: string;
}

export interface ResolveAgentRunProfileInput {
  prompt: string;
  mode: "ask" | "build";
  lastAssistantContent?: string;
}

/** Classify the run and derive scoped context — single entry for client-side agent orchestration. */
export function resolveAgentRunProfile(input: ResolveAgentRunProfileInput): AgentRunProfile {
  const { prompt, mode, lastAssistantContent } = input;
  const trimmed = prompt.trim();

  if (
    mode === "build" &&
    isExecutionContinuation(trimmed) &&
    lastAssistantContent &&
    looksLikeModificationPlan(lastAssistantContent)
  ) {
    const targetFiles = extractPlanFilePaths(lastAssistantContent);
    const lastUserIntent = summarizeIntent(trimmed);
    return {
      kind: "execute_plan",
      targetFiles: targetFiles.length ? targetFiles : undefined,
      userIntent: lastUserIntent,
    };
  }

  return { kind: "interactive" };
}

export function buildAgentPromptForProfile(prompt: string, profile: AgentRunProfile): string {
  if (profile.kind !== "execute_plan") return prompt;
  const files = profile.targetFiles?.length ? profile.targetFiles.join("、") : "见上一轮方案";
  return [
    prompt.trim(),
    "",
    "[方案执行] 按已确认方案修改代码。",
    "请先 read_file 核对目标文件真实内容，再 patch_file / write_file；方案代码块仅供参考。",
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
