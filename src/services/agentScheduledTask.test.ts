import { describe, expect, it } from "vitest";
import {
  isScheduledTaskConsultativePrompt,
  shouldNudgeScheduledJobRegistration,
} from "./agentConsultativeTopics";

/** Re-export surface stays stable for legacy import paths. */
describe("agentScheduledTask re-exports", () => {
  it("delegates to agentConsultativeTopics", () => {
    expect(isScheduledTaskConsultativePrompt("有没有跑批数据的定时任务吗？")).toBe(true);
    expect(
      shouldNudgeScheduledJobRegistration(["src/module/Tasks/FooBackfillJob.cs"], ["IService"]),
    ).toBe(true);
  });
});
