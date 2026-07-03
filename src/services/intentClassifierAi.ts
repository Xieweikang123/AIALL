import { isShortContextDependentFollowUp } from "../orchestration/generic/userIntentClassifiers";
import type { UserIntentHistoryMessage } from "../orchestration/agentIntentTypes";
import {
  CONSULTATIVE_TOPIC_IDS,
  type ConsultativeTopicId,
  type ResolvedUserIntent,
  type UserIntentAiPayload,
  type UserIntentPrimary,
} from "./intentClassifierTypes";
import type { ConfigBindingTopic } from "../orchestration/agentIntentTypes";

const SHORT_FOLLOW_UP_ASSISTANT_CHARS = 2_000;

function readIntentEnv(key: string): string {
  if (typeof process !== "undefined") {
    const fromProcess = process.env?.[key];
    if (typeof fromProcess === "string" && fromProcess.trim()) {
      return fromProcess.trim();
    }
  }
  const viteKey = `VITE_${key}` as keyof ImportMetaEnv;
  const fromVite = import.meta.env?.[viteKey];
  if (typeof fromVite === "string" && fromVite.trim()) {
    return fromVite.trim();
  }
  return "";
}

export function resolveIntentClassifierModel(mainModel: string): string {
  const override = readIntentEnv("AIALL_INTENT_CLASSIFIER_MODEL");
  return override || mainModel;
}

export function formatIntentClassificationDetail(intent: ResolvedUserIntent): string {
  const topic =
    intent.consultativeTopic && intent.consultativeTopic !== "none"
      ? `/${intent.consultativeTopic}`
      : "";
  const skip = intent.skippedAiClassifier ? "·规则短路" : "";
  const pending =
    intent.pendingPlanAmend ? "·pending_amend" : intent.pendingPlanClarify ? "·pending_clarify" : "";
  return `意图：${intent.primary}${topic}（${intent.classificationSource}${skip}${pending}）`;
}

export function buildIntentCacheKey(input: {
  projectRoot?: string;
  prompt: string;
  mode: string;
  history?: UserIntentHistoryMessage[];
}): string {
  const tail = input.history?.length ? input.history[input.history.length - 1]?.content.slice(0, 80) : "";
  return [input.projectRoot || "", input.mode, input.prompt.trim(), tail].join("|");
}

export function buildIntentClassifierSystemPrompt(): string {
  return [
    "你是编程 Agent 的用户意图分类器。只输出一行合法 JSON，不要 markdown 围栏或解释。",
    "",
    "字段（全部必填）：",
    '{',
    '  "primary": "consultative" | "implement" | "automation",',
    '  "consultativeTopic": "none" | "general" | "project_overview" | "scheduled_task" | "behavior_purpose" | "accuracy" | "ui_appearance" | "session_audit" | "code_review" | "implementation_status" | "step_clarification" | "behavior_contradiction" | "config_binding",',
    '  "implementFollowUp": boolean,',
    '  "uiDefect": boolean,',
    '  "codeReview": boolean,',
    '  "behaviorContradiction": boolean,',
    '  "behaviorPurpose": boolean,',
    '  "scheduledTask": boolean,',
    '  "accuracyQuestion": boolean,',
    '  "implementationStatus": boolean,',
    '  "agentStepClarification": boolean,',
    '  "userErrorQuote": boolean,',
    '  "uiAppearance": boolean,',
    '  "configBindingTopic": null | "reject" | "enumeration" | "doc_lookup"',
    "}",
    "",
    "判定规则：",
    "- consultative：仅提问、解释、审计、核对，未要求改代码",
    "- implement：明确要求创建/修改/修复/优化/落地代码",
    "- automation：消息以【方案执行】等系统自动续跑标记开头",
    "- project_overview：问整个项目/仓库/应用做什么、用途、架构概览",
    "- scheduled_task：问定时/调度/cron/触发频率",
    "- behavior_purpose：问字段/枚举/配置项在运行时的作用",
    "- accuracy：问 Agent/回答是否准确、可靠",
    "- session_audit：要求审计另一聊天会话的质量",
    "- ui_defect 通过 uiDefect 字段；附截图且描述布局/控件异常为 true",
    "- implementFollowUp：在上文分析后短确认执行（如「改吧」「继续修」）",
    "- 短追问「需要吗」「要不要」承接上文，通常为 consultative",
    "- configBindingTopic 至多一个非 null 值",
  ].join("\n");
}

export function summarizeIntentHistory(history?: UserIntentHistoryMessage[], maxMessages = 4): string {
  if (!history?.length) return "";
  return history
    .slice(-maxMessages)
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content.trim().slice(0, 400)}`)
    .join("\n");
}

export function buildIntentClassifierUserMessage(input: {
  prompt: string;
  history?: UserIntentHistoryMessage[];
  mode: "ask" | "build" | "plan" | "explore";
  hasImage: boolean;
}): string {
  const lines = [
    `当前模式：${input.mode}`,
    `是否附图：${input.hasImage ? "是" : "否"}`,
    "",
    "用户最新消息：",
    input.prompt.trim(),
  ];
  const text = input.prompt.trim();
  const lastAssistant = [...(input.history ?? [])].reverse().find((m) => m.role === "assistant");
  if (isShortContextDependentFollowUp(text) && lastAssistant?.content?.trim()) {
    lines.push(
      "",
      "上一条助手回复（节选，短追问须承接此话题）：",
      lastAssistant.content.trim().slice(0, SHORT_FOLLOW_UP_ASSISTANT_CHARS),
    );
  } else {
    const historyBlock = summarizeIntentHistory(input.history);
    if (historyBlock) {
      lines.push("", "近期对话（节选）：", historyBlock);
    }
  }
  return lines.join("\n");
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asPrimary(value: unknown): UserIntentPrimary | null {
  if (value === "consultative" || value === "implement" || value === "automation") return value;
  return null;
}

function asConsultativeTopic(value: unknown): ConsultativeTopicId | null {
  if (typeof value !== "string") return null;
  return CONSULTATIVE_TOPIC_IDS.has(value as ConsultativeTopicId) ? (value as ConsultativeTopicId) : null;
}

function asConfigBindingTopic(value: unknown): ConfigBindingTopic | null {
  if (value === "reject" || value === "enumeration" || value === "doc_lookup") return value;
  return null;
}

export function parseIntentClassifierResponse(text: string): UserIntentAiPayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
    const candidate = fence ? fence[1].trim() : trimmed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      parsed = JSON.parse(candidate.slice(start, end + 1));
    }
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const primary = asPrimary(record.primary);
  const consultativeTopic = asConsultativeTopic(record.consultativeTopic);
  if (!primary || !consultativeTopic) return null;

  return {
    primary,
    consultativeTopic,
    implementFollowUp: asBool(record.implementFollowUp),
    uiDefect: asBool(record.uiDefect),
    codeReview: asBool(record.codeReview),
    behaviorContradiction: asBool(record.behaviorContradiction),
    behaviorPurpose: asBool(record.behaviorPurpose),
    scheduledTask: asBool(record.scheduledTask),
    accuracyQuestion: asBool(record.accuracyQuestion),
    implementationStatus: asBool(record.implementationStatus),
    agentStepClarification: asBool(record.agentStepClarification),
    userErrorQuote: asBool(record.userErrorQuote),
    uiAppearance: asBool(record.uiAppearance),
    configBindingTopic: asConfigBindingTopic(record.configBindingTopic),
  };
}

export function shouldUseAiIntentClassifier(): boolean {
  const flag = (readIntentEnv("AIALL_INTENT_CLASSIFIER") || "ai").trim().toLowerCase();
  return flag !== "rules" && flag !== "off" && flag !== "0";
}
