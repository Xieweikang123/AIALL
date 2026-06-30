import type { ConfigBindingTopic, UserIntentHistoryMessage } from "../orchestration/agentIntentTypes";

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
  | "config_binding"
  | "git_working_tree";

export const CONSULTATIVE_TOPIC_IDS = new Set<ConsultativeTopicId>([
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
  "git_working_tree",
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
  pendingPlanAmend: boolean;
  pendingPlanClarify: boolean;
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
