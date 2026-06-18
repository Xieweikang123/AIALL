import { describe, expect, it } from "vitest";
import {
  buildAgentStepClarificationHint,
  buildAgentStepClarifyContinueHint,
  buildConsultativeBuildHint,
  buildImplementFollowUpHint,
  buildSessionAuditHint,
  buildUiDefectBuildHint,
  historySuggestsQuotePositionFix,
  isAgentStepClarificationPrompt,
  isConsultativeUserPrompt,
  isImplementFollowUpRun,
  isScreenshotVisibilityPrompt,
  isSessionAuditPrompt,
  isShortImplementPrompt,
  isUiDefectReportPrompt,
} from "./agentUserIntent";

describe("isConsultativeUserPrompt", () => {
  it("detects question-only prompts", () => {
    expect(isConsultativeUserPrompt("这个输入框，点哪里能聚焦？")).toBe(true);
    expect(isConsultativeUserPrompt("这是什么组件")).toBe(true);
    expect(isConsultativeUserPrompt("为什么点击没反应")).toBe(true);
  });

  it("rejects explicit implement requests", () => {
    expect(isConsultativeUserPrompt("帮我把输入框改成可聚焦")).toBe(false);
    expect(isConsultativeUserPrompt("实现点击空白也能聚焦")).toBe(false);
    expect(isConsultativeUserPrompt("修复聚焦问题")).toBe(false);
  });

  it("rejects automation/resume prompts", () => {
    expect(isConsultativeUserPrompt("【方案执行阶段】请直接动手")).toBe(false);
  });

  it("treats short evaluative follow-ups as consultative despite 优化", () => {
    expect(isConsultativeUserPrompt("需要优化吗")).toBe(true);
    expect(isConsultativeUserPrompt("要不要调整呢")).toBe(true);
  });

  it("treats screenshot UI defect reports as implement intent even with ？", () => {
    expect(isConsultativeUserPrompt("看到没，引用按钮跑别的地方了？")).toBe(false);
    expect(isConsultativeUserPrompt("你看，这个按钮错位了？")).toBe(false);
  });

  it("does not treat agent-step clarification as consultative read-only", () => {
    const prompt = "我直接去读取 Teleport 的 opening tag 确认 target 啥意思？";
    expect(isAgentStepClarificationPrompt(prompt)).toBe(true);
    expect(isConsultativeUserPrompt(prompt)).toBe(false);
  });

  it("treats accuracy questions as consultative", () => {
    expect(isConsultativeUserPrompt("AI 助手，引用按钮出现位置是否总是准确？")).toBe(true);
    expect(isConsultativeUserPrompt("这个位置一直准确吗？")).toBe(true);
  });
});

describe("buildConsultativeBuildHint", () => {
  it("mentions read-only tools", () => {
    expect(buildConsultativeBuildHint()).toContain("禁止 patch_file");
    expect(buildConsultativeBuildHint()).toContain("grep");
  });
});

describe("buildUiDefectBuildHint", () => {
  it("requires patch and mentions overlay positioning", () => {
    expect(buildUiDefectBuildHint()).toContain("patch_file");
    expect(buildUiDefectBuildHint()).toContain("Teleport");
    expect(buildUiDefectBuildHint()).toContain("getSelection");
  });
});

describe("buildAgentStepClarificationHint", () => {
  it("requires explain-first without tools", () => {
    const hint = buildAgentStepClarificationHint();
    expect(hint).toContain("禁止调用工具");
    expect(hint).toContain("Teleport");
    expect(hint).toContain("show*At");
  });
});

describe("isUiDefectReportPrompt", () => {
  it("treats screenshot visibility question with image as UI defect", () => {
    expect(isScreenshotVisibilityPrompt("能看到我截图的问题吗")).toBe(true);
    expect(isUiDefectReportPrompt("能看到我截图的问题吗", true)).toBe(true);
    expect(isUiDefectReportPrompt("能看到我截图的问题吗", false)).toBe(false);
  });
});

describe("isImplementFollowUpRun", () => {
  const history = [
    {
      role: "assistant",
      content: "引用按钮 getSelectionAnchorRect 可能有问题，建议修复 showQuoteButtonAt。",
    },
  ];

  it("detects 修复吧 after prior quote-button analysis", () => {
    expect(isImplementFollowUpRun("修复吧", history)).toBe(true);
  });

  it("rejects 修复吧 without relevant history", () => {
    expect(isImplementFollowUpRun("修复吧", [])).toBe(false);
  });
});

describe("buildImplementFollowUpHint", () => {
  it("forbids paste-only instructions", () => {
    expect(buildImplementFollowUpHint()).toContain("禁止");
    expect(buildImplementFollowUpHint()).toContain("patch_file");
  });
});

describe("isShortImplementPrompt", () => {
  it("detects bare short implement prompts", () => {
    expect(isShortImplementPrompt("修复吧")).toBe(true);
    expect(isShortImplementPrompt("改一下")).toBe(true);
    expect(isShortImplementPrompt("动手")).toBe(true);
    expect(isShortImplementPrompt("执行")).toBe(true);
  });

  it("rejects non-implementation prompts", () => {
    expect(isShortImplementPrompt("这是什么")).toBe(false);
    expect(isShortImplementPrompt("帮我把按钮改成红色")).toBe(false);
  });
});

describe("historySuggestsQuotePositionFix", () => {
  it("returns true when recent history mentions quote positioning", () => {
    const history = [
      { role: "assistant", content: "getSelectionAnchorRect 获取选区锚点位置" },
      { role: "user", content: "修复吧" },
    ];
    expect(historySuggestsQuotePositionFix(history)).toBe(true);
  });

  it("returns false for empty or unrelated history", () => {
    expect(historySuggestsQuotePositionFix([])).toBe(false);
    expect(historySuggestsQuotePositionFix(undefined)).toBe(false);
    expect(historySuggestsQuotePositionFix([{ role: "user", content: "今天天气不错" }])).toBe(false);
  });

  it("detects quote-floating and showQuoteButtonAt keywords", () => {
    expect(historySuggestsQuotePositionFix([{ role: "assistant", content: "quote-floating 定位有误" }])).toBe(true);
    expect(historySuggestsQuotePositionFix([{ role: "assistant", content: "showQuoteButtonAt 需要修改" }])).toBe(true);
  });
});

describe("buildAgentStepClarifyContinueHint", () => {
  it("contains tool prohibition and key positioning terms", () => {
    const hint = buildAgentStepClarifyContinueHint();
    expect(hint).toContain("禁止");
    expect(hint).toContain("show*At");
  });
});

describe("isSessionAuditPrompt", () => {
  it("detects session audit copy template", () => {
    const prompt =
      "【任务】请自行排查以下 AIALL Vibe 会话中 Agent 回复的准确度问题。\n【相关文件】\n- 会话文件：aiall/vibe-chat-sessions/chat-1781689365698.json";
    expect(isSessionAuditPrompt(prompt)).toBe(true);
  });

  it("rejects ordinary implement prompts", () => {
    expect(isSessionAuditPrompt("帮我把按钮改紧凑一点")).toBe(false);
  });
});

describe("buildSessionAuditHint", () => {
  it("mentions read_file absolute path and forbids run_command paging", () => {
    const hint = buildSessionAuditHint();
    expect(hint).toContain("read_file");
    expect(hint).toContain("%APPDATA%");
    expect(hint).toContain("禁止 run_command");
  });

  it("prioritizes logical session paths and evidence-qualified conclusions", () => {
    const hint = buildSessionAuditHint();
    expect(hint).toContain("aiall/vibe-chat-sessions/");
    expect(hint).toContain("不要先在项目根目录搜索 aiall");
    expect(hint).toContain("证据强度");
    expect(hint).toContain("摘要不足，无法确认");
    expect(hint).toContain("禁止断言");
  });
});
