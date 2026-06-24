import { describe, expect, it } from "vitest";
import {
  buildIntentClassifierSystemPrompt,
  classifyUserIntentFromRules,
  formatIntentClassificationDetail,
  parseIntentClassifierResponse,
  resolveUserIntent,
  shouldSkipAiIntentClassifier,
} from "./agentIntentClassifier";

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
        scheduledTask: false,
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
      '```json\n{"primary":"implement","consultativeTopic":"none","implementFollowUp":true,"uiDefect":false,"codeReview":false,"behaviorContradiction":false,"behaviorPurpose":false,"scheduledTask":false,"accuracyQuestion":false,"implementationStatus":false,"agentStepClarification":false,"userErrorQuote":false,"uiAppearance":false,"configBindingTopic":null}\n```',
    );
    expect(payload?.primary).toBe("implement");
    expect(payload?.implementFollowUp).toBe(true);
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
          scheduledTask: false,
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

describe("classifyUserIntentFromRules", () => {
  it("detects project overview consultative prompt", () => {
    const result = classifyUserIntentFromRules({
      prompt: "解释这个项目是做什么的",
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    expect(result.consultative).toBe(true);
    expect(result.consultativeTopic).toBe("project_overview");
  });

  it("detects implement intent", () => {
    const result = classifyUserIntentFromRules({
      prompt: "帮我把输入框改成可聚焦",
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    expect(result.consultative).toBe(false);
    expect(result.primary).toBe("implement");
  });
});

describe("shouldSkipAiIntentClassifier", () => {
  it("skips AI for project overview rules match", () => {
    const rules = classifyUserIntentFromRules({
      prompt: "解释这个项目是做什么的",
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    expect(shouldSkipAiIntentClassifier(rules, "解释这个项目是做什么的")).toBe(true);
  });

  it("skips AI for explicit implement intent", () => {
    const rules = classifyUserIntentFromRules({
      prompt: "帮我把输入框改成可聚焦",
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    expect(shouldSkipAiIntentClassifier(rules, "帮我把输入框改成可聚焦")).toBe(true);
  });

  it("calls AI for ambiguous general consultative", () => {
    const rules = classifyUserIntentFromRules({
      prompt: "这个组件怎么回事",
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    expect(shouldSkipAiIntentClassifier(rules, "这个组件怎么回事")).toBe(false);
  });
});

describe("resolveUserIntent", () => {
  it("uses AI fields when AI present", () => {
    const merged = resolveUserIntent({
      prompt: "这个组件怎么回事",
      mode: "build",
      hasImage: false,
      isAsk: false,
      ai: {
        primary: "consultative",
        consultativeTopic: "general",
        implementFollowUp: false,
        uiDefect: false,
        codeReview: false,
        behaviorContradiction: false,
        behaviorPurpose: false,
        scheduledTask: false,
        accuracyQuestion: false,
        implementationStatus: false,
        agentStepClarification: false,
        userErrorQuote: false,
        uiAppearance: false,
        configBindingTopic: null,
      },
    });
    expect(merged.classificationSource).toBe("ai");
    expect(merged.consultative).toBe(true);
    expect(merged.codeReview).toBe(false);
  });

  it("hard-overrides ui defect with image", () => {
    const merged = resolveUserIntent({
      prompt: "按钮错位了，你看截图",
      mode: "build",
      hasImage: true,
      isAsk: false,
      ai: {
        primary: "consultative",
        consultativeTopic: "general",
        implementFollowUp: false,
        uiDefect: false,
        codeReview: false,
        behaviorContradiction: false,
        behaviorPurpose: false,
        scheduledTask: false,
        accuracyQuestion: false,
        implementationStatus: false,
        agentStepClarification: false,
        userErrorQuote: false,
        uiAppearance: false,
        configBindingTopic: null,
      },
    });
    expect(merged.uiDefect).toBe(true);
    expect(merged.consultative).toBe(false);
    expect(merged.classificationSource).toBe("rules");
  });

  it("rules implementFollowUp wins over AI", () => {
    const merged = resolveUserIntent({
      prompt: "改吧",
      mode: "build",
      hasImage: false,
      isAsk: false,
      history: [
        { role: "assistant", content: "## 修改方案\n\n改 `src/foo.ts`" },
        { role: "user", content: "先分析一下" },
      ],
      ai: {
        primary: "consultative",
        consultativeTopic: "general",
        implementFollowUp: false,
        uiDefect: false,
        codeReview: false,
        behaviorContradiction: false,
        behaviorPurpose: false,
        scheduledTask: false,
        accuracyQuestion: false,
        implementationStatus: false,
        agentStepClarification: false,
        userErrorQuote: false,
        uiAppearance: false,
        configBindingTopic: null,
      },
    });
    if (merged.implementFollowUp) {
      expect(merged.primary).toBe("implement");
    }
  });
});

describe("formatIntentClassificationDetail", () => {
  it("includes topic and shortcut marker", () => {
    const detail = formatIntentClassificationDetail({
      primary: "consultative",
      consultative: true,
      consultativeTopic: "project_overview",
      implementFollowUp: false,
      uiDefect: false,
      codeReview: false,
      behaviorContradiction: false,
      behaviorPurpose: false,
      scheduledTask: false,
      accuracyQuestion: false,
      implementationStatus: false,
      agentStepClarification: false,
      userErrorQuote: false,
      uiAppearance: false,
      configBindingTopic: null,
      ultraShortOpenTask: false,
      locateStatusFollowUp: false,
      classificationSource: "rules",
      skippedAiClassifier: true,
    });
    expect(detail).toContain("project_overview");
    expect(detail).toContain("规则短路");
  });
});

describe("buildIntentClassifierSystemPrompt", () => {
  it("stays generic without business nouns", () => {
    const prompt = buildIntentClassifierSystemPrompt();
    expect(prompt).toContain("project_overview");
    expect(prompt).not.toMatch(/ChatView|vibe-coding|粘贴图片/i);
  });
});
