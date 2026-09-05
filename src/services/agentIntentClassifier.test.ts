import { describe, expect, it } from "vitest";
import {
  buildIntentClassifierSystemPrompt,
  formatIntentClassificationDetail,
  parseIntentClassifierResponse,
  resolveUserIntent,
} from "./agentIntentClassifier";
import type { UserIntentAiPayload } from "./intentClassifierTypes";

function aiPayload(overrides: Partial<UserIntentAiPayload> = {}): UserIntentAiPayload {
  return {
    primary: "implement",
    consultativeTopic: "none",
    implementFollowUp: false,
    uiDefect: false,
    codeReview: false,
    behaviorContradiction: false,
    behaviorPurpose: false,
    accuracyQuestion: false,
    implementationStatus: false,
    agentStepClarification: false,
    userErrorQuote: false,
    uiAppearance: false,
    configBindingTopic: null,
    ...overrides,
  };
}

describe("parseIntentClassifierResponse", () => {
  it("parses bare JSON", () => {
    const payload = parseIntentClassifierResponse(
      JSON.stringify({
        primary: "consultative",
        consultativeTopic: "project_overview",
        implementFollowUp: false,
        uiDefect: false,
        codeReview: false,
        behaviorContradiction: false,
        behaviorPurpose: false,
        accuracyQuestion: false,
        implementationStatus: false,
        agentStepClarification: false,
        userErrorQuote: false,
        uiAppearance: false,
        configBindingTopic: null,
      }),
    );
    expect(payload?.primary).toBe("consultative");
    expect(payload?.consultativeTopic).toBe("project_overview");
  });

  it("parses fenced JSON", () => {
    const payload = parseIntentClassifierResponse(
      '```json\n{"primary":"implement","consultativeTopic":"none","implementFollowUp":true,"uiDefect":false,"codeReview":false,"behaviorContradiction":false,"behaviorPurpose":false,"accuracyQuestion":false,"implementationStatus":false,"agentStepClarification":false,"userErrorQuote":false,"uiAppearance":false,"configBindingTopic":null,"needsClarification":true}\n```',
    );
    expect(payload?.primary).toBe("implement");
    expect(payload?.implementFollowUp).toBe(true);
    expect(payload?.needsClarification).toBe(true);
  });

  it("rejects invalid topic", () => {
    expect(
      parseIntentClassifierResponse(
        JSON.stringify({
          primary: "consultative",
          consultativeTopic: "not_a_topic",
          implementFollowUp: false,
          uiDefect: false,
          codeReview: false,
          behaviorContradiction: false,
          behaviorPurpose: false,
          accuracyQuestion: false,
          implementationStatus: false,
          agentStepClarification: false,
          userErrorQuote: false,
          uiAppearance: false,
          configBindingTopic: null,
        }),
      ),
    ).toBeNull();
  });
});

describe("resolveUserIntent", () => {
  it("uses AI fields when AI present", () => {
    const merged = resolveUserIntent({
      prompt: "这个组件怎么回事",
      mode: "build",
      hasImage: false,
      isAsk: false,
      ai: aiPayload({ primary: "consultative", consultativeTopic: "general" }),
    });
    expect(merged.classificationSource).toBe("ai");
    expect(merged.consultative).toBe(true);
    expect(merged.codeReview).toBe(false);
  });

  it("adopts AI implementFollowUp as implement", () => {
    const merged = resolveUserIntent({
      prompt: "改吧",
      mode: "build",
      hasImage: false,
      isAsk: false,
      history: [
        { role: "assistant", content: "## 修改方案\n\n改 `src/foo.ts`" },
        { role: "user", content: "先分析一下" },
      ],
      ai: aiPayload({ primary: "implement", implementFollowUp: true }),
    });
    expect(merged.primary).toBe("implement");
    expect(merged.implementFollowUp).toBe(true);
  });

  it("keeps AI consultative verdict for short imperatives in auto mode", () => {
    const merged = resolveUserIntent({
      prompt: "去掉他",
      mode: "auto",
      hasImage: false,
      isAsk: false,
      ai: aiPayload({ primary: "consultative", consultativeTopic: "general" }),
    });
    expect(merged.primary).toBe("consultative");
    expect(merged.consultative).toBe(true);
    expect(merged.needsClarification).toBe(false);
  });

  it("falls back to default implement when AI absent in build mode", () => {
    const merged = resolveUserIntent({
      prompt: "帮我把输入框改成可聚焦",
      mode: "build",
      hasImage: false,
      isAsk: false,
      ai: null,
    });
    expect(merged.primary).toBe("implement");
    expect(merged.consultative).toBe(false);
  });

  it("falls back to default consultative when AI absent in ask mode", () => {
    const merged = resolveUserIntent({
      prompt: "这个组件怎么回事",
      mode: "ask",
      hasImage: false,
      isAsk: true,
      ai: null,
    });
    expect(merged.primary).toBe("consultative");
    expect(merged.consultative).toBe(true);
  });
});

describe("formatIntentClassificationDetail", () => {
  it("includes topic and source", () => {
    const detail = formatIntentClassificationDetail({
      primary: "consultative",
      consultative: true,
      consultativeTopic: "project_overview",
      implementFollowUp: false,
      uiDefect: false,
      codeReview: false,
      behaviorContradiction: false,
      behaviorPurpose: false,
      accuracyQuestion: false,
      implementationStatus: false,
      agentStepClarification: false,
      userErrorQuote: false,
      uiAppearance: false,
      configBindingTopic: null,
      ultraShortOpenTask: false,
      locateStatusFollowUp: false,
      pendingPlanAmend: false,
      pendingPlanClarify: false,
      classificationSource: "ai",
    });
    expect(detail).toContain("project_overview");
    expect(detail).toContain("ai");
  });
});

describe("buildIntentClassifierSystemPrompt", () => {
  it("stays generic without business nouns", () => {
    const prompt = buildIntentClassifierSystemPrompt();
    expect(prompt).toContain("project_overview");
    expect(prompt).not.toMatch(/ChatView|vibe-coding|粘贴图片/i);
  });
});
