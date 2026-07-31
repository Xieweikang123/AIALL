import { describe, expect, it } from "vitest";
import {
  resolveUserIntent,
  classifyUserIntentFromRules,
} from "./agentIntentClassifier";
import { buildConsultativeTopicHints } from "./agentConsultativeTopics";

const FIXTURE_SESSION_AUDIT =
  "【任务】请自行排查以下 AIALL Vibe 会话中 Agent 回复的准确度问题。会话文件：aiall/vibe-chat-sessions/chat-123.json";

describe("intent + consultative topic integration", () => {
  it("project overview rules intent injects updated overview hint", () => {
    const prompt = "解释这个项目是做什么的";
    const rules = classifyUserIntentFromRules({
      prompt,
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    const intent = resolveUserIntent({ prompt, mode: "build", hasImage: false, isAsk: false, ai: null });
    const hints = buildConsultativeTopicHints(prompt, undefined, intent.consultativeTopic);

    expect(rules.consultativeTopic).toBe("project_overview");
    expect(hints).toContain("项目概览");
    expect(hints).toContain("routes");
    expect(hints).not.toContain("read 路由入口（如 src/router");
  });

  it("session audit topic via rules without duplicate path in vibeAgent", () => {
    const intent = classifyUserIntentFromRules({
      prompt: FIXTURE_SESSION_AUDIT,
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    const hints = buildConsultativeTopicHints(FIXTURE_SESSION_AUDIT, undefined, intent.consultativeTopic);

    expect(intent.consultativeTopic).toBe("session_audit");
    expect(hints).toContain("会话审计");
  });
});
