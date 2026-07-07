/**
 * Consultative topic modules — each adds system hints / runtime nudges by message shape.
 * New topics register here instead of hardcoding business symbols in classifiers.
 */

import type { ConsultativeTopicId } from "./intentClassifierTypes";
import {
  PROJECT_OVERVIEW_TOPIC_RE,
  SCHEDULED_TASK_TOPIC_RE,
  SESSION_AUDIT_TASK_RE,
  isGitWorkingTreeTopicPrompt,
  shouldNudgeScheduledJobRegistration,
} from "./agentStructuralPatterns";
import {
  buildAgentStepClarificationHint,
  buildBehaviorContradictionHint,
  buildConfigBindingTopicHint,
  buildImplementationStatusHint,
  buildSessionAuditHint,
} from "../orchestration/product/userIntentHints";
import {
  historySuggestsActiveImplementation,
  isAccuracyConsultativePrompt,
  isAgentStepClarificationPrompt,
  isBehaviorContradictionPrompt,
  isBehaviorPurposePrompt,
  isCodeReviewPrompt,
  isConsultativeUserPrompt,
  isImplementationStatusPrompt,
  isUiStatePersistenceQuestionPrompt,
  resolveConfigBindingTopic,
} from "../orchestration/generic/userIntentClassifiers";
import type { UserIntentHistoryMessage } from "../orchestration/agentIntentTypes";
import { buildConsultativeAccuracyTraceHint } from "./consultativeAccuracyTrace";
import { buildBehaviorPurposeTraceHint } from "./consultativeBehaviorTrace";
import { buildConsultativeUiBehaviorTraceHint } from "./consultativeUiBehaviorTrace";

export interface ConsultativeTopicModule {
  id: ConsultativeTopicId;
  isActive(prompt: string, history?: UserIntentHistoryMessage[]): boolean;
  buildSystemHint(prompt: string, history?: UserIntentHistoryMessage[]): string;
}

function scheduledTaskTopic(): ConsultativeTopicModule {
  return {
    id: "scheduled_task",
    isActive(prompt, history) {
      const text = prompt.trim();
      if (!text || !SCHEDULED_TASK_TOPIC_RE.test(text)) return false;
      return isConsultativeUserPrompt(text, history);
    },
    buildSystemHint: () => buildScheduledTaskConsultativeHint(),
  };
}

function projectOverviewTopic(): ConsultativeTopicModule {
  return {
    id: "project_overview",
    isActive(prompt) {
      const text = prompt.trim();
      return Boolean(text && PROJECT_OVERVIEW_TOPIC_RE.test(text));
    },
    buildSystemHint: () => buildProjectOverviewConsultativeHint(),
  };
}

function sessionAuditTopic(): ConsultativeTopicModule {
  return {
    id: "session_audit",
    isActive(prompt) {
      const text = prompt.trim();
      return Boolean(text && SESSION_AUDIT_TASK_RE.test(text));
    },
    buildSystemHint: () => buildSessionAuditHint(),
  };
}

function behaviorPurposeTopic(): ConsultativeTopicModule {
  return {
    id: "behavior_purpose",
    isActive(prompt, history) {
      return isBehaviorPurposePrompt(prompt.trim(), history);
    },
    buildSystemHint: () => buildBehaviorPurposeTraceHint(),
  };
}

function behaviorContradictionTopic(): ConsultativeTopicModule {
  return {
    id: "behavior_contradiction",
    isActive(prompt, history) {
      return isBehaviorContradictionPrompt(prompt.trim(), history);
    },
    buildSystemHint: () => buildBehaviorContradictionHint(),
  };
}

function accuracyTopic(): ConsultativeTopicModule {
  return {
    id: "accuracy",
    isActive(prompt) {
      return isAccuracyConsultativePrompt(prompt.trim());
    },
    buildSystemHint: () => buildConsultativeAccuracyTraceHint(),
  };
}

function codeReviewTopic(): ConsultativeTopicModule {
  return {
    id: "code_review",
    isActive(prompt) {
      return isCodeReviewPrompt(prompt.trim());
    },
    buildSystemHint: () => buildCodeReviewConsultativeHint(),
  };
}

function implementationStatusTopic(): ConsultativeTopicModule {
  return {
    id: "implementation_status",
    isActive(prompt, history) {
      return (
        isImplementationStatusPrompt(prompt.trim()) &&
        historySuggestsActiveImplementation(history)
      );
    },
    buildSystemHint: () => buildImplementationStatusHint(),
  };
}

function stepClarificationTopic(): ConsultativeTopicModule {
  return {
    id: "step_clarification",
    isActive(prompt) {
      return isAgentStepClarificationPrompt(prompt.trim());
    },
    buildSystemHint: () => buildAgentStepClarificationHint(),
  };
}

function configBindingTopic(): ConsultativeTopicModule {
  return {
    id: "config_binding",
    isActive(prompt) {
      return Boolean(resolveConfigBindingTopic(prompt.trim()));
    },
    buildSystemHint(prompt) {
      const topic = resolveConfigBindingTopic(prompt.trim());
      return topic ? buildConfigBindingTopicHint(topic) : "";
    },
  };
}

function gitWorkingTreeTopic(): ConsultativeTopicModule {
  return {
    id: "git_working_tree",
    isActive(prompt) {
      return isGitWorkingTreeTopicPrompt(prompt.trim());
    },
    buildSystemHint: () => buildGitWorkingTreeConsultativeHint(),
  };
}

const CONSULTATIVE_TOPICS: ConsultativeTopicModule[] = [
  sessionAuditTopic(),
  scheduledTaskTopic(),
  projectOverviewTopic(),
  gitWorkingTreeTopic(),
  behaviorPurposeTopic(),
  behaviorContradictionTopic(),
  accuracyTopic(),
  codeReviewTopic(),
  implementationStatusTopic(),
  stepClarificationTopic(),
  configBindingTopic(),
];

const TOPIC_ID_TO_MODULE = new Map(CONSULTATIVE_TOPICS.map((topic) => [topic.id, topic]));

export function resolveActiveConsultativeTopics(
  prompt: string,
  history?: UserIntentHistoryMessage[],
  aiTopic?: ConsultativeTopicId | null,
): ConsultativeTopicModule[] {
  if (aiTopic && aiTopic !== "none" && aiTopic !== "general") {
    const mapped = TOPIC_ID_TO_MODULE.get(aiTopic);
    if (mapped) return [mapped];
  }
  return CONSULTATIVE_TOPICS.filter((topic) => topic.isActive(prompt, history));
}

export function buildConsultativeTopicHints(
  prompt: string,
  history?: UserIntentHistoryMessage[],
  aiTopic?: ConsultativeTopicId | null,
): string {
  const topicHints = resolveActiveConsultativeTopics(prompt, history, aiTopic)
    .map((topic) => topic.buildSystemHint(prompt, history))
    .join("");
  const uiStateHint = isUiStatePersistenceQuestionPrompt(prompt.trim())
    ? buildConsultativeUiBehaviorTraceHint()
    : "";
  return topicHints + uiStateHint;
}

export function isScheduledTaskTopicPrompt(prompt: string): boolean {
  return SCHEDULED_TASK_TOPIC_RE.test(prompt.trim());
}

export function isScheduledTaskConsultativePrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
  aiTopic?: ConsultativeTopicId | null,
): boolean {
  return resolveActiveConsultativeTopics(prompt, history, aiTopic).some((t) => t.id === "scheduled_task");
}

export function buildScheduledTaskConsultativeHint(): string {
  return [
    "",
    "【定时/调度类】用户问的是有无定时任务、何时触发、执行频率等。",
    "read 到 job/task 实现后，须继续 trace 到调度注册/触发配置处并 read；符号与入口路径依上方【项目栈 Profile】与 manifest 自行选用，勿凭记忆臆测。",
    "禁止只 trace Execute→Service 即收工；答案须含触发时机/频率（代码中有则写明）。",
    "探索时避免连续 list_dir 逐级下探超过 2 层，优先 grep/search_files 定位调度注册文件。",
  ].join("\n");
}

export function buildProjectOverviewConsultativeHint(): string {
  return [
    "",
    "【项目概览】用户问的是整个应用/仓库做什么，不是某个函数行为。",
    "1. 优先引用 system 已注入的「顶层路由与页面说明」与 AGENTS.md 产品入口；",
    "2. 仅当摘要不足时再 read 路由入口或各 view 首屏 desc（offset/limit 约 1–80 行）；",
    "3. 回答按「入口 → 用途」逐项说明全部顶层路由，勿只深挖单一子系统；",
    "4. 已注入的关键文件（如 package.json）勿重复 read_file；",
    "5. 禁止用单一产品类比替代多入口说明。",
  ].join("\n");
}

export function buildCodeReviewConsultativeHint(): string {
  return [
    "",
    "【代码核对·只读】用户要求检查/核对/验证代码或改动，不是新实施请求。",
    "须 read_file 核对目标文件实际内容后作答；禁止仅凭记忆或截图断言「已正确」。",
  ].join("\n");
}

export function buildGitWorkingTreeConsultativeHint(): string {
  return [
    "",
    "【Git 工作区】用户问未提交/暂存变更。须先 git_status 列出文件，再用 git_diff 查看具体 diff。",
    "区分已暂存、未暂存、未跟踪；回答时概括每个文件的改动要点。",
    "禁止声称无法执行 Git 或要求用户粘贴 git status；禁止用 read_file 代替 diff 来猜测变更。",
  ].join("\n");
}

export function buildScheduledJobRegistrationNudge(jobClassNames: string[]): string {
  const listed = jobClassNames.slice(0, 2).join("、");
  return [
    `【系统提示】你已 read Job 类（${listed}），但尚未 read/grep 调度注册处。`,
    `下一轮 grep \`${jobClassNames[0]}\` 并 trace 到调度注册/触发配置（符号依【项目栈 Profile】）；read 注册入口后再作答。`,
    "作答须含触发时机/频率（如 cron、启动即跑）；禁止只写 Execute→Service 业务逻辑即结束。",
  ].join("\n");
}

export { shouldNudgeScheduledJobRegistration };
