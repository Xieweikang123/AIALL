/**
 * Consultative topic modules — each adds system hints / runtime nudges by message shape.
 * New topics register here instead of hardcoding business symbols in classifiers.
 */

import {
  SCHEDULED_TASK_TOPIC_RE,
  shouldNudgeScheduledJobRegistration,
} from "./agentStructuralPatterns";
import { isConsultativeUserPrompt, type UserIntentHistoryMessage } from "./agentUserIntent";

export interface ConsultativeTopicModule {
  id: string;
  isActive(prompt: string, history?: UserIntentHistoryMessage[]): boolean;
  buildSystemHint(): string;
}

function scheduledTaskTopic(): ConsultativeTopicModule {
  return {
    id: "scheduled_task",
    isActive(prompt, history) {
      const text = prompt.trim();
      if (!text || !SCHEDULED_TASK_TOPIC_RE.test(text)) return false;
      return isConsultativeUserPrompt(text, history);
    },
    buildSystemHint: buildScheduledTaskConsultativeHint,
  };
}

const CONSULTATIVE_TOPICS: ConsultativeTopicModule[] = [scheduledTaskTopic()];

export function resolveActiveConsultativeTopics(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): ConsultativeTopicModule[] {
  return CONSULTATIVE_TOPICS.filter((topic) => topic.isActive(prompt, history));
}

export function buildConsultativeTopicHints(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): string {
  return resolveActiveConsultativeTopics(prompt, history)
    .map((topic) => topic.buildSystemHint())
    .join("");
}

export function isScheduledTaskTopicPrompt(prompt: string): boolean {
  return SCHEDULED_TASK_TOPIC_RE.test(prompt.trim());
}

export function isScheduledTaskConsultativePrompt(
  prompt: string,
  history?: UserIntentHistoryMessage[],
): boolean {
  return resolveActiveConsultativeTopics(prompt, history).some((t) => t.id === "scheduled_task");
}

export function buildScheduledTaskConsultativeHint(): string {
  return [
    "",
    "【定时/调度类】用户问的是有无定时任务、何时触发、执行频率等。",
    "read 到 IJob / Job 实现后，须 grep Job 类名或 Schedule/Trigger/CronSchedule/TriggerBuilder 找注册处并 read，再作答。",
    "禁止只 trace Execute→Service 即收工；答案须含触发时机/频率（代码中有则写明）。",
    "探索时避免连续 list_dir 逐级下探超过 2 层，优先 grep/search_files 定位 Tasks 或调度注册文件。",
  ].join("\n");
}

export function buildScheduledJobRegistrationNudge(jobClassNames: string[]): string {
  const listed = jobClassNames.slice(0, 2).join("、");
  return [
    `【系统提示】你已 read Job 类（${listed}），但尚未 read/grep 调度注册处。`,
    `下一轮 grep \`${jobClassNames[0]}\` 或 CronSchedule/TriggerBuilder/ScheduleJob，read Startup 或调度配置文件。`,
    "作答须含触发时机/频率（如 cron、启动即跑）；禁止只写 Execute→Service 业务逻辑即结束。",
  ].join("");
}

export { shouldNudgeScheduledJobRegistration };
