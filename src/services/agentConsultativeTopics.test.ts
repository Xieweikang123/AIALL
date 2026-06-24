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

  it("buildConsultativeTopicHints injects scheduled hint when active", () => {
    const hints = buildConsultativeTopicHints(FIXTURE_SCHEDULED_TASK_QUESTION);
    expect(hints).toContain("CronSchedule");
    expect(hints).not.toMatch(/EnergyRecord|gw_energy/i);
  });

  it("nudges when Job read without registration trace", () => {
    const reads = [FIXTURE_FOO_BACKFILL_JOB];
    const greps = [FIXTURE_BACKFILL_SERVICE];
    expect(shouldNudgeScheduledJobRegistration(reads, greps)).toBe(true);
  });
});
