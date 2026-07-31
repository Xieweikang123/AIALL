import { describe, expect, it } from "vitest";
import { buildConsultativeTopicHints } from "./agentConsultativeTopics";

describe("agentConsultativeTopics", () => {
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
});
