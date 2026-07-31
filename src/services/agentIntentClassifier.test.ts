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
      '```json\n{"primary":"implement","consultativeTopic":"none","implementFollowUp":true,"uiDefect":false,"codeReview":false,"behaviorContradiction":false,"behaviorPurpose":false,"accuracyQuestion":false,"implementationStatus":false,"agentStepClarification":false,"userErrorQuote":false,"uiAppearance":false,"configBindingTopic":null}\n```',
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

  it("ActionClassifier forces consultative for 是啥 root verb with project_overview topic", () => {
    const result = classifyUserIntentFromRules({
      prompt: "当前项目测试接口是啥",
      mode: "build",
      hasImage: false,
      isAsk: false,
    });
    expect(result.primary).toBe("consultative");
    expect(result.consultative).toBe(true);
    expect(result.consultativeTopic).toBe("project_overview");
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

  it("never skips AI when chat mode is auto", () => {
    const prompt =
      '我想做个单页，有一些按钮，能一键执行某些操作，比如替换 AlarmCenterProperties.xml 的某些内容';
    const rules = classifyUserIntentFromRules({
      prompt,
      mode: "auto",
      hasImage: false,
      isAsk: false,
    });
    expect(rules.primary).toBe("implement");
    expect(shouldSkipAiIntentClassifier(rules, prompt)).toBe(true);
    expect(shouldSkipAiIntentClassifier(rules, prompt, { mode: "auto" })).toBe(false);
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

  it("rules consultative wins over AI implementFollowUp on evaluative prompts", () => {
    const prompt = '"扫描与测试修复" 功能，你觉得如何？';
    const merged = resolveUserIntent({
      prompt,
      mode: "build",
      hasImage: false,
      isAsk: false,
      history: [
        { role: "user", content: "改" },
        { role: "assistant", content: "✅ 已完成修改。" },
      ],
      ai: {
        primary: "implement",
        consultativeTopic: "none",
        implementFollowUp: true,
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
      },
    });
    expect(merged.consultative).toBe(true);
    expect(merged.primary).toBe("consultative");
    expect(merged.implementFollowUp).toBe(false);
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
      classificationSource: "rules",
      skippedAiClassifier: true,
    });
    expect(detail).toContain("project_overview");
    expect(detail).toContain("规则短路");
  });
});

describe("classifyUserIntentFromRules pending plan follow-up", () => {
  const PLAN_MSG = [
    "[PLAN]",
    "## 修改方案",
    "涉及 `src/foo.ts`：",
    "```ts",
    "export const featureFlag = true;",
    "```",
  ].join("\n");

  const sessionHistory = [
    { role: "user", content: "写一个定时任务" },
    { role: "assistant", content: PLAN_MSG },
    {
      role: "user",
      content: '> 方案: _logger.LogInformation("…");\n\n日志写到哪里了？',
    },
    {
      role: "assistant",
      content: "默认输出到控制台，不会写入文件。如需持久化可添加文件日志提供程序。",
    },
  ];

  it("routes Agent-quote + 持久化 to pendingPlanAmend in plan mode", () => {
    const prompt =
      "> Agent: 当前方案下的 _logger 只会输出到控制台，不会写入文件。\n\n持久化";
    const result = classifyUserIntentFromRules({
      prompt,
      history: sessionHistory,
      mode: "plan",
      hasImage: false,
      isAsk: false,
    });
    expect(result.pendingPlanAmend).toBe(true);
    expect(result.pendingPlanClarify).toBe(false);
    expect(result.primary).toBe("consultative");
    expect(result.consultative).toBe(false);
    expect(shouldSkipAiIntentClassifier(result, prompt)).toBe(true);
  });

  it("does not amend when user breaks pending plan thread", () => {
    const result = classifyUserIntentFromRules({
      prompt: "另起一个方案，写独立模块",
      history: sessionHistory,
      mode: "plan",
      hasImage: false,
      isAsk: false,
    });
    expect(result.pendingPlanAmend).toBe(false);
  });
});

describe("buildIntentClassifierSystemPrompt", () => {
  it("stays generic without business nouns", () => {
    const prompt = buildIntentClassifierSystemPrompt();
    expect(prompt).toContain("project_overview");
    expect(prompt).not.toMatch(/ChatView|vibe-coding|粘贴图片/i);
  });
});
