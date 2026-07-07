import { describe, expect, it } from "vitest";
import {
  buildConsultativeTopicHints,
  isScheduledTaskConsultativePrompt,
  isScheduledTaskTopicPrompt,
  shouldNudgeScheduledJobRegistration,
} from "./agentConsultativeTopics";
import {
  FIXTURE_FOO_BACKFILL_JOB,
  FIXTURE_BACKFILL_SERVICE,
  FIXTURE_SCHEDULED_TASK_QUESTION,
} from "./agentTestFixtures";

describe("agentConsultativeTopics", () => {
  it("detects scheduled-task topic", () => {
    expect(isScheduledTaskTopicPrompt(FIXTURE_SCHEDULED_TASK_QUESTION)).toBe(true);
    expect(isScheduledTaskTopicPrompt("这个 Job 几点执行？")).toBe(true);
    expect(isScheduledTaskTopicPrompt("今天天气怎么样")).toBe(false);
  });

  it("topic + consultative intent", () => {
    expect(isScheduledTaskConsultativePrompt(FIXTURE_SCHEDULED_TASK_QUESTION)).toBe(true);
    expect(isScheduledTaskConsultativePrompt("帮我把定时任务改成每小时")).toBe(false);
  });

  it("buildConsultativeTopicHints injects scheduled trace hint when active", () => {
    const hints = buildConsultativeTopicHints(FIXTURE_SCHEDULED_TASK_QUESTION);
    expect(hints).toContain("定时/调度类");
    expect(hints).toContain("项目上下文");
    expect(hints).not.toContain("CronSchedule");
    expect(hints).not.toMatch(/EnergyRecord|gw_energy/i);
  });

  it("uses AI topic when provided", () => {
    const hints = buildConsultativeTopicHints("随便问问", undefined, "project_overview");
    expect(hints).toContain("项目概览");
    expect(hints).not.toContain("CronSchedule");
  });

  it("buildConsultativeTopicHints injects project overview hint", () => {
    const hints = buildConsultativeTopicHints("解释这个项目是做什么的");
    expect(hints).toContain("项目上下文");
  });

  it("session audit topic injects audit hint", () => {
    const hints = buildConsultativeTopicHints(
      "【任务】请自行排查以下 AIALL Vibe 会话中 Agent 回复的准确度",
    );
    expect(hints).toContain("会话审计");
  });

  it("nudges when Job read without registration trace", () => {
    const reads = [FIXTURE_FOO_BACKFILL_JOB];
    const greps = [FIXTURE_BACKFILL_SERVICE];
    expect(shouldNudgeScheduledJobRegistration(reads, greps)).toBe(true);
  });
});
