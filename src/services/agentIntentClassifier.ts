import {
  type ConfigBindingTopic,
  IMPLEMENT_INTENT_RE,
  isAccuracyConsultativePrompt,
  isAgentStepClarificationPrompt,
  isBehaviorContradictionPrompt,
  isBehaviorPurposePrompt,
  isCodeReviewPrompt,
  isConsultativeUserPrompt,
  isImplementationStatusPrompt,
  isImplementFollowUpRun,
  isLocateStatusFollowUpPrompt,
  isSessionAuditPrompt,
  isUiAppearanceQuestionPrompt,
  isUiDefectReportPrompt,
  isUserErrorQuotePrompt,
  isUltraShortOpenTaskPrompt,
  resolveConfigBindingTopic,
  type UserIntentHistoryMessage,
} from "./agentUserIntent";
import { isScheduledTaskTopicPrompt } from "./agentConsultativeTopics";
import { PROJECT_OVERVIEW_TOPIC_RE } from "./agentStructuralPatterns";

/** Resume / plan execution prompts must keep write access — structural markers only. */
const AUTOMATION_PROMPT_RE = /^\s*(?:【|\[)(?:方案执行|精准修改|效率|系统自动续跑|读图完成)/;

export type UserIntentPrimary = "consultative" | "implement" | "automation";

export type ConsultativeTopicId =
  | "none"
  | "general"
  | "project_overview"
  | "scheduled_task"
  | "behavior_purpose"
  | "accuracy"
  | "ui_appearance"
  | "session_audit"
  | "code_review"
  | "implementation_status"
  | "step_clarification"
  | "behavior_contradiction"
  | "config_binding";

const CONSULTATIVE_TOPIC_IDS = new Set<ConsultativeTopicId>([
  "none",
  "general",
  "project_overview",
  "scheduled_task",
  "behavior_purpose",
  "accuracy",
  "ui_appearance",
  "session_audit",
  "code_review",
  "implementation_status",
  "step_clarification",
  "behavior_contradiction",
  "config_binding",
]);

export interface UserIntentAiPayload {
  primary: UserIntentPrimary;
  consultativeTopic: ConsultativeTopicId;
  implementFollowUp: boolean;
  uiDefect: boolean;
  codeReview: boolean;
  behaviorContradiction: boolean;
  behaviorPurpose: boolean;
  scheduledTask: boolean;
  accuracyQuestion: boolean;
  implementationStatus: boolean;
  agentStepClarification: boolean;
  userErrorQuote: boolean;
  uiAppearance: boolean;
  configBindingTopic: ConfigBindingTopic | null;
}

export interface ResolvedUserIntent extends UserIntentAiPayload {
  consultative: boolean;
  ultraShortOpenTask: boolean;
  locateStatusFollowUp: boolean;
  classificationSource: "ai" | "rules";
  skippedAiClassifier?: boolean;
}

export interface ResolveUserIntentInput {
  prompt: string;
  history?: UserIntentHistoryMessage[];
  mode: "ask" | "build" | "plan" | "explore";
  hasImage: boolean;
  isAsk: boolean;
  ai?: UserIntentAiPayload | null;
}

export function isShortContextDependentFollowUp(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || text.length > 24) return false;
  return /^(?:需要|要不要|是否|还得|还要|值得|可以|那)?[^。！!]{0,20}(?:吗|呢|吧|了)[？?]?\s*$/.test(text);
}

/** High-confidence rule outcome — skip extra classifier model call. */
export function shouldSkipAiIntentClassifier(
  rules: ResolvedUserIntent,
  prompt: string,
  opts?: { isAsk?: boolean },
): boolean {
  const text = prompt.trim();
  if (!text) return true;
  if (isShortContextDependentFollowUp(text)) return true;
  if (rules.primary === "automation" || rules.uiDefect || rules.implementFollowUp) return true;
  if (rules.primary === "implement" && IMPLEMENT_INTENT_RE.test(text)) return true;
  if (rules.consultativeTopic !== "none" && rules.consultativeTopic !== "general") return true;
  if (opts?.isAsk && rules.consultative) return true;
  return false;
}

export function resolveIntentClassifierModel(mainModel: string): string {
  const override = (process.env.AIALL_INTENT_CLASSIFIER_MODEL || "").trim();
  return override || mainModel;
}

export function formatIntentClassificationDetail(intent: ResolvedUserIntent): string {
  const topic =
    intent.consultativeTopic && intent.consultativeTopic !== "none"
      ? `/${intent.consultativeTopic}`
      : "";
  const skip = intent.skippedAiClassifier ? "·规则短路" : "";
  return `意图：${intent.primary}${topic}（${intent.classificationSource}${skip}）`;
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

export function isAutomationResumePrompt(prompt: string): boolean {
  return AUTOMATION_PROMPT_RE.test(prompt.trim());
}

const SHORT_FOLLOW_UP_ASSISTANT_CHARS = 2_000;

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

function inferConsultativeTopicFromRules(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): ConsultativeTopicId {
  const text = prompt.trim();
  if (isSessionAuditPrompt(text)) return "session_audit";
  if (isScheduledTaskTopicPrompt(text)) return "scheduled_task";
  if (isBehaviorPurposePrompt(text, history)) return "behavior_purpose";
  if (isAccuracyConsultativePrompt(text)) return "accuracy";
  if (isCodeReviewPrompt(text)) return "code_review";
  if (isImplementationStatusPrompt(text)) return "implementation_status";
  if (isAgentStepClarificationPrompt(text)) return "step_clarification";
  if (isBehaviorContradictionPrompt(text, history)) return "behavior_contradiction";
  if (resolveConfigBindingTopic(text)) return "config_binding";
  if (isUiAppearanceQuestionPrompt(text)) return "ui_appearance";
  if (PROJECT_OVERVIEW_TOPIC_RE.test(text)) {
    return "project_overview";
  }
  if (isConsultativeUserPrompt(text, history)) return "general";
  return "none";
}

/** Rule-based baseline — used as fallback and for hard safety overrides. */
export function classifyUserIntentFromRules(input: ResolveUserIntentInput): ResolvedUserIntent {
  const text = input.prompt.trim();
  const history = input.history;
  const automation = isAutomationResumePrompt(text);
  const uiDefect = isUiDefectReportPrompt(text, input.hasImage);
  const implementFollowUp = isImplementFollowUpRun(text, history, { isAsk: input.isAsk });
  const consultative =
    !automation &&
    !uiDefect &&
    !implementFollowUp &&
    isConsultativeUserPrompt(text, history);

  const topic = inferConsultativeTopicFromRules(text, history);

  return {
    primary: automation ? "automation" : implementFollowUp || !consultative ? "implement" : "consultative",
    consultative,
    consultativeTopic: topic,
    implementFollowUp,
    uiDefect,
    codeReview: isCodeReviewPrompt(text),
    behaviorContradiction: isBehaviorContradictionPrompt(text, history),
    behaviorPurpose: isBehaviorPurposePrompt(text, history),
    scheduledTask: isScheduledTaskTopicPrompt(text),
    accuracyQuestion: isAccuracyConsultativePrompt(text),
    implementationStatus: isImplementationStatusPrompt(text),
    agentStepClarification: isAgentStepClarificationPrompt(text),
    userErrorQuote: isUserErrorQuotePrompt(text, history),
    uiAppearance: isUiAppearanceQuestionPrompt(text),
    configBindingTopic: resolveConfigBindingTopic(text),
    ultraShortOpenTask: isUltraShortOpenTaskPrompt(text),
    locateStatusFollowUp: isLocateStatusFollowUpPrompt(text, history),
    classificationSource: "rules",
  };
}

function buildResolvedFromAi(ai: UserIntentAiPayload, rules: ResolvedUserIntent): ResolvedUserIntent {
  const implementFollowUp = rules.implementFollowUp || ai.implementFollowUp;
  const primary: UserIntentPrimary = implementFollowUp
    ? "implement"
    : ai.primary === "automation"
      ? "automation"
      : ai.primary;
  const consultative = primary === "consultative";

  return {
    primary,
    consultative,
    consultativeTopic: ai.consultativeTopic,
    implementFollowUp,
    uiDefect: ai.uiDefect,
    codeReview: ai.codeReview,
    behaviorContradiction: ai.behaviorContradiction,
    behaviorPurpose: ai.behaviorPurpose,
    scheduledTask: ai.scheduledTask,
    accuracyQuestion: ai.accuracyQuestion,
    implementationStatus: ai.implementationStatus,
    agentStepClarification: ai.agentStepClarification,
    userErrorQuote: ai.userErrorQuote,
    uiAppearance: ai.uiAppearance,
    configBindingTopic: ai.configBindingTopic,
    ultraShortOpenTask: rules.ultraShortOpenTask,
    locateStatusFollowUp: rules.locateStatusFollowUp,
    classificationSource: "ai",
  };
}

/** Merge AI classification with rule baseline; hard overrides win over AI. */
export function resolveUserIntent(input: ResolveUserIntentInput): ResolvedUserIntent {
  const rules = classifyUserIntentFromRules(input);

  if (isAutomationResumePrompt(input.prompt) || rules.uiDefect) {
    return {
      ...rules,
      primary: rules.uiDefect ? "implement" : rules.primary,
      consultative: false,
      consultativeTopic: rules.uiDefect ? "none" : rules.consultativeTopic,
      classificationSource: "rules",
    };
  }

  const ai = input.ai;
  if (!ai) return rules;

  return buildResolvedFromAi(ai, rules);
}

export function shouldUseAiIntentClassifier(): boolean {
  const flag = (process.env.AIALL_INTENT_CLASSIFIER || "ai").trim().toLowerCase();
  return flag !== "rules" && flag !== "off" && flag !== "0";
}
