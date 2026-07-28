import { describe, expect, it } from "vitest";
import {
  FIXTURE_CONTRADICTION_USER,
  FIXTURE_ENUM_LISTING,
  FIXTURE_LOCATE_EVIDENCE,
  FIXTURE_PRIOR_DENIAL,
} from "./agentTestFixtures";
import {
  historySuggestsActiveImplementation,
  historySuggestsQuotePositionFix,
  isAgentStepClarificationPrompt,
  isBehaviorContradictionPrompt,
  isBehaviorPurposePrompt,
  isCodeReviewPrompt,
  isAccuracyConsultativePrompt,
  isConsultativeUserPrompt,
  isEvaluativeOpinionPrompt,
  isEnumerationCountQuestionPrompt,
  isExternalApiLookupPrompt,
  isImplementationStatusPrompt,
  isImplementFollowUpRun,
  isImplementationFailureReportPrompt,
  isScreenshotVisibilityPrompt,
  isSameIssueFollowUpRun,
  isSessionAuditPrompt,
  isShortImplementPrompt,
  isLocateStatusFollowUpPrompt,
  isUiAppearanceQuestionPrompt,
  isUiDefectReportPrompt,
  isUserErrorQuotePrompt,
  isUserOptionMismatchPrompt,
  isUltraShortOpenTaskPrompt,
  historyPriorAssistantClaimedFix,
  resolveConfigBindingTopic,
} from "../orchestration/generic/userIntentClassifiers";
import {
  buildAgentStepClarificationHint,
  buildAgentStepClarifyContinueHint,
  buildBehaviorContradictionHint,
  buildBuildWriteBlockedHint,
  buildConsultativeBuildHint,
  buildConfigBindingTopicHint,
  buildConsultativeResumeHint,
  buildExternalApiLookupHint,
  buildImplementFollowUpHint,
  buildImplementationStatusHint,
  buildSessionAuditHint,
  buildUiDefectBuildHint,
  buildUserOptionMismatchHint,
  buildWriteToolBlockedMessage,
} from "../orchestration/product/userIntentHints";

describe("isConsultativeUserPrompt", () => {
  it("detects question-only prompts", () => {
    expect(isConsultativeUserPrompt("这个输入框，点哪里能聚焦？")).toBe(true);
    expect(isConsultativeUserPrompt("这是什么组件")).toBe(true);
    expect(isConsultativeUserPrompt("为什么点击没反应")).toBe(true);
  });

  it("treats manual-stop notification questions as consultative", () => {
    expect(isConsultativeUserPrompt("手动终止会话，也会通知？")).toBe(true);
    expect(isConsultativeUserPrompt("停止 Agent 后还会弹通知吗？")).toBe(true);
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

  it("treats UI locate questions as consultative when not asking to implement", () => {
    expect(isConsultativeUserPrompt("会话这里，显示的啥")).toBe(true);
    expect(isConsultativeUserPrompt("知道是哪儿的按钮吗？")).toBe(true);
    expect(isConsultativeUserPrompt("帮我把这个按钮改小一点")).toBe(false);
  });

  it("does not treat implementation failure reports as consultative", () => {
    expect(isImplementationFailureReportPrompt("看起来，没生效呢")).toBe(true);
    expect(isConsultativeUserPrompt("看起来，没生效呢")).toBe(false);
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
    expect(isAccuracyConsultativePrompt("ai生成注释准确吗？")).toBe(true);
  });

  it("treats implementation status prompts as consultative", () => {
    expect(isImplementationStatusPrompt("多会话同时进行  改好了吗？")).toBe(true);
    expect(isImplementationStatusPrompt("改好了吗")).toBe(true);
    expect(isConsultativeUserPrompt("多会话同时进行  改好了吗？")).toBe(true);
  });

  it("treats descriptive 更新 in question-shaped prompts as consultative", () => {
    expect(isConsultativeUserPrompt("昨天的会话，今天更新了，为啥还处在昨天？")).toBe(true);
    expect(isConsultativeUserPrompt("请更新一下这个功能？")).toBe(false);
  });

  it("treats evaluative opinion prompts as consultative despite 修复 in topic", () => {
    const prompt = '"扫描与测试修复" 功能，你觉得如何？';
    expect(isEvaluativeOpinionPrompt(prompt)).toBe(true);
    expect(isConsultativeUserPrompt(prompt)).toBe(true);
    expect(
      isImplementFollowUpRun(prompt, [
        { role: "user", content: "改" },
        { role: "assistant", content: "✅ 已完成修改。patch_file AutoBugFixPanel.vue" },
      ]),
    ).toBe(false);
  });
});

describe("isUiAppearanceQuestionPrompt", () => {
  it("detects transparency and blur style questions", () => {
    expect(isUiAppearanceQuestionPrompt("弹窗背景透明的？")).toBe(true);
    expect(isUiAppearanceQuestionPrompt("这个面板是半透明的吗")).toBe(true);
    expect(isUiAppearanceQuestionPrompt("知道是哪儿的按钮吗？")).toBe(false);
  });
});

describe("isLocateStatusFollowUpPrompt", () => {
  const priorLocated = [
    {
      role: "assistant" as const,
      content: FIXTURE_LOCATE_EVIDENCE,
    },
  ];

  it("detects locate progress follow-up with prior evidence", () => {
    expect(isLocateStatusFollowUpPrompt("找到位置了吗？", priorLocated)).toBe(true);
    expect(isLocateStatusFollowUpPrompt("定位到了吗", priorLocated)).toBe(true);
  });

  it("rejects when prior assistant had no locate evidence", () => {
    expect(
      isLocateStatusFollowUpPrompt("找到位置了吗？", [{ role: "assistant", content: "让我再看看。" }]),
    ).toBe(false);
  });
});

describe("buildConsultativeBuildHint", () => {
  it("mentions read-only tools and forbids mislabeling Ask mode", () => {
    expect(buildConsultativeBuildHint()).toContain("禁止 patch_file");
    expect(buildConsultativeBuildHint()).toContain("grep");
    expect(buildConsultativeBuildHint()).toContain("Ask 模式");
  });

  it("forbids premature completion claims on behavior questions", () => {
    expect(buildConsultativeBuildHint()).toContain("无需再改");
    expect(buildConsultativeBuildHint()).toContain("当前代码下");
    expect(buildConsultativeBuildHint()).toContain("直接调用方");
    expect(buildConsultativeBuildHint()).toContain("middleware");
  });
});

describe("isBehaviorContradictionPrompt", () => {
  const priorDenial = [
    {
      role: "assistant",
      content: FIXTURE_PRIOR_DENIAL,
    },
  ];

  it("detects observed behavior contradicting prior negative claim", () => {
    expect(isBehaviorContradictionPrompt(FIXTURE_CONTRADICTION_USER, priorDenial)).toBe(true);
  });

  it("rejects implement follow-ups", () => {
    expect(isBehaviorContradictionPrompt("改吧", priorDenial)).toBe(false);
  });

  it("rejects when no prior negative assistant claim", () => {
    expect(
      isBehaviorContradictionPrompt("但是还是会跑到上面", [{ role: "assistant", content: "排序按时间字段。" }]),
    ).toBe(false);
  });

  it("rejects implementation failure reports handled elsewhere", () => {
    expect(isBehaviorContradictionPrompt("试了不行，还是没效果", priorDenial)).toBe(false);
  });

  it("detects prior-answer challenge after behavior claim", () => {
    const priorBehavior = [
      {
        role: "assistant" as const,
        content: "根据代码，`src/foo.vue` 不会自动再次打开。",
      },
    ];
    expect(isBehaviorContradictionPrompt("你觉得有问题吗？", priorBehavior)).toBe(true);
    expect(isBehaviorContradictionPrompt("改吧", priorBehavior)).toBe(false);
  });
});

describe("buildBehaviorContradictionHint", () => {
  it("requires deepening trace and explicit correction", () => {
    const hint = buildBehaviorContradictionHint();
    expect(hint).toContain("现象与上轮矛盾");
    expect(hint).toContain("调用方");
    expect(hint).toContain("显式承认");
  });
});

describe("buildConsultativeResumeHint", () => {
  it("forbids patch on resume and misleading prior-patch claims", () => {
    const hint = buildConsultativeResumeHint();
    expect(hint).toContain("禁止 patch_file");
    expect(hint).toContain("上一轮的 patch");
    expect(hint).toContain("middleware");
  });

  it("requires branch logic when resuming behavior-purpose follow-ups", () => {
    const hint = buildConsultativeResumeHint(true);
    expect(hint).toContain("用途/作用类");
    expect(hint).toContain("禁止重复枚举定义");
  });
});

describe("isBehaviorPurposePrompt", () => {
  const enumListingHistory = [
    {
      role: "assistant" as const,
      content: FIXTURE_ENUM_LISTING,
    },
  ];

  it("detects short purpose follow-up after enum listing", () => {
    expect(isBehaviorPurposePrompt("啥作用", enumListingHistory)).toBe(true);
    expect(
      isBehaviorPurposePrompt("> Agent: FlagPartial = 1\n> FlagFull = 2\n\n啥作用", enumListingHistory),
    ).toBe(true);
  });

  it("detects explicit purpose markers without prior enum listing", () => {
    expect(isBehaviorPurposePrompt("这个字段有啥用？", [])).toBe(true);
  });
});

describe("buildImplementationStatusHint", () => {
  it("requires read-only progress answer", () => {
    const hint = buildImplementationStatusHint();
    expect(hint).toContain("实施进度");
    expect(hint).toContain("禁止 patch_file");
    expect(hint).toContain("Ask 模式");
  });
});

describe("buildWriteToolBlockedMessage", () => {
  it("disambiguates Build consultative from Ask mode", () => {
    expect(buildWriteToolBlockedMessage("consultative_build")).toContain("Build 只读轮");
    expect(buildWriteToolBlockedMessage("consultative_build")).toContain("禁止");
    expect(buildWriteToolBlockedMessage("ask")).toContain("Ask 模式");
  });
});

describe("buildBuildWriteBlockedHint", () => {
  it("mentions both error shapes", () => {
    const hint = buildBuildWriteBlockedHint();
    expect(hint).toContain("Build 只读轮");
    expect(hint).toContain("Ask 模式");
  });
});

describe("buildUiDefectBuildHint", () => {
  it("requires patch and mentions overlay positioning", () => {
    expect(buildUiDefectBuildHint()).toContain("patch_file");
    expect(buildUiDefectBuildHint()).toContain("portal");
    expect(buildUiDefectBuildHint()).toContain("getSelection");
  });
});

describe("buildAgentStepClarificationHint", () => {
  it("requires explain-first without tools", () => {
    const hint = buildAgentStepClarificationHint();
    expect(hint).toContain("禁止调用工具");
    expect(hint).toContain("解释");
  });
});

describe("isUiDefectReportPrompt", () => {
  it("treats screenshot visibility question with image as UI defect", () => {
    expect(isScreenshotVisibilityPrompt("能看到我截图的问题吗")).toBe(true);
    expect(isUiDefectReportPrompt("能看到我截图的问题吗", true)).toBe(true);
    expect(isUiDefectReportPrompt("能看到我截图的问题吗", false)).toBe(false);
  });

  it("treats short aesthetic feedback with image as UI defect", () => {
    expect(isUiDefectReportPrompt("也不好看", true)).toBe(true);
    expect(isUiDefectReportPrompt("好丑", true)).toBe(true);
    expect(isUiDefectReportPrompt("也不好看", false)).toBe(false);
  });
});

describe("isImplementFollowUpRun", () => {
  const history = [
    {
      role: "assistant",
      content: "定位分析显示坐标计算有问题，建议修复定位逻辑。",
    },
  ];
  const implHistory = [
    { role: "user", content: "实现吧" },
    { role: "assistant", content: "部分改好了，下一步需要把 chatSending 改为 per-session。" },
  ];

  it("detects 修复吧 after prior positioning analysis", () => {
    expect(isImplementFollowUpRun("修复吧", history)).toBe(true);
  });

  it("detects failure report after prior patch as implement follow-up", () => {
    const patchHistory = [
      { role: "user", content: "改成一个淡一点的颜色，不要突出它" },
      { role: "assistant", content: "已修改完成。将输入框中文件引用标签的配色改为…" },
    ];
    expect(isImplementFollowUpRun("看起来，没生效呢", patchHistory)).toBe(true);
  });

  it("detects 继续改 after partial implementation", () => {
    expect(isImplementFollowUpRun("继续改", implHistory)).toBe(true);
    expect(isConsultativeUserPrompt("继续改")).toBe(false);
  });

  it("does not treat implementation status as implement follow-up", () => {
    expect(isImplementFollowUpRun("多会话同时进行  改好了吗？", implHistory)).toBe(false);
  });

  it("rejects 修复吧 without relevant history", () => {
    expect(isImplementFollowUpRun("修复吧", [])).toBe(false);
  });

  it("detects bulk execute after prior implementation context", () => {
    const history = [
      {
        role: "assistant" as const,
        content: "建议去掉 fix-btn--block，需要我实际执行这些修改吗？",
      },
    ];
    expect(isImplementFollowUpRun("全部执行", history)).toBe(true);
  });

  it("detects numbered option selection after assistant offered priorities", () => {
    const history = [
      {
        role: "assistant" as const,
        content: "1. 主按钮去掉 block\n2. 增大圆点\n需要我实际执行吗？",
      },
    ];
    expect(
      isImplementFollowUpRun("> Agent: 连接线拉长\n\n1", history),
    ).toBe(true);
  });
});

describe("historySuggestsActiveImplementation", () => {
  it("detects partial implementation in recent history", () => {
    const history = [
      { role: "user", content: "实现吧" },
      { role: "assistant", content: "部分改好了，未完成 sendingSessionIds 接入。" },
    ];
    expect(historySuggestsActiveImplementation(history)).toBe(true);
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
  it("returns true when recent history mentions positioning analysis", () => {
    const history = [
      { role: "assistant", content: "定位分析显示坐标计算有问题，建议修复" },
      { role: "user", content: "修复吧" },
    ];
    expect(historySuggestsQuotePositionFix(history)).toBe(true);
  });

  it("returns false for empty or unrelated history", () => {
    expect(historySuggestsQuotePositionFix([])).toBe(false);
    expect(historySuggestsQuotePositionFix(undefined)).toBe(false);
    expect(historySuggestsQuotePositionFix([{ role: "user", content: "今天天气不错" }])).toBe(false);
  });

  it("detects positioning and fix proposal keywords", () => {
    expect(historySuggestsQuotePositionFix([{ role: "assistant", content: "浮层定位有误，需要分析坐标" }])).toBe(true);
    expect(historySuggestsQuotePositionFix([{ role: "assistant", content: "根因是定位偏移，建议修改" }])).toBe(true);
  });
});

describe("buildAgentStepClarifyContinueHint", () => {
  it("steers toward patch after explanation without symbol-specific names", () => {
    const hint = buildAgentStepClarifyContinueHint();
    expect(hint).toContain("禁止");
    expect(hint).toContain("patch");
    expect(hint).not.toMatch(/show\*At|getSelection/i);
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
  it("mentions path resolution and forbids run_command paging", () => {
    const hint = buildSessionAuditHint();
    expect(hint).toContain("offset/limit");
    expect(hint).toContain("禁止 run_command");
    expect(hint).toContain("AGENTS.md");
  });

  it("requires evidence-qualified conclusions and forbids repo audit writes", () => {
    const hint = buildSessionAuditHint();
    expect(hint).toContain("证据强度");
    expect(hint).toContain("摘要不足，无法确认");
    expect(hint).toContain("禁止断言");
    expect(hint).toContain("禁止 write_file");
  });
});

describe("isCodeReviewPrompt", () => {
  it("detects short review requests", () => {
    expect(isCodeReviewPrompt("检查下")).toBe(true);
    expect(isCodeReviewPrompt("核对一下")).toBe(true);
    expect(isCodeReviewPrompt("复查代码")).toBe(true);
  });

  it("rejects implement requests", () => {
    expect(isCodeReviewPrompt("帮我修复按钮")).toBe(false);
  });
});

describe("isUserErrorQuotePrompt", () => {
  it("detects error-shaped paste without question mark", () => {
    expect(isUserErrorQuotePrompt("通知权限已被拒绝，请在浏览器设置中手动开启通知权限")).toBe(true);
  });

  it("detects repeat of recent assistant banner text", () => {
    const history = [
      {
        role: "assistant",
        content: "通知权限已被拒绝，请在浏览器设置中手动开启通知权限。",
      },
    ];
    expect(isUserErrorQuotePrompt("通知权限已被拒绝，请在浏览器设置中手动开启通知权限", history)).toBe(
      true,
    );
  });

  it("rejects questions", () => {
    expect(isUserErrorQuotePrompt("为什么通知权限被拒绝？")).toBe(false);
  });
});

describe("isSameIssueFollowUpRun", () => {
  const priorFixHistory = [
    { role: "user", content: "某功能有问题，排查下" },
    { role: "assistant", content: "## ✅ 修复完成\n\n已修改 src/foo.ts。" },
  ];

  it("detects follow-up after prior fix claim", () => {
    expect(historyPriorAssistantClaimedFix(priorFixHistory)).toBe(true);
    expect(isSameIssueFollowUpRun("草稿显示有问题，明明没发送", priorFixHistory)).toBe(true);
    expect(isSameIssueFollowUpRun("给你发消息，会创建一个新会话，发现这个问题没？", priorFixHistory)).toBe(
      true,
    );
  });

  it("detects prior 已修复 / 已改完 claims", () => {
    const history = [
      { role: "user", content: "图标不显示" },
      { role: "assistant", content: "已修复：图标颜色改为更亮。" },
    ];
    expect(historyPriorAssistantClaimedFix(history)).toBe(true);
    expect(isSameIssueFollowUpRun("还是不显示", history)).toBe(true);
  });

  it("rejects when prior assistant did not claim fix", () => {
    const history = [
      { role: "user", content: "问题 A" },
      { role: "assistant", content: "我先分析一下…" },
    ];
    expect(isSameIssueFollowUpRun("还有问题", history)).toBe(false);
  });

  it("rejects unrelated new task", () => {
    expect(isSameIssueFollowUpRun("帮我把路由改成 lazy load", priorFixHistory)).toBe(false);
  });
});

describe("config binding topic", () => {
  it("detects user rejecting offered fields", () => {
    expect(isUserOptionMismatchPrompt("不是这几个选项")).toBe(true);
    expect(isUserOptionMismatchPrompt("fooField — 不是这几个")).toBe(true);
    expect(isUserOptionMismatchPrompt("这个不对")).toBe(false);
    expect(buildConfigBindingTopicHint("reject")).toContain("禁止扩 scope");
  });

  it("detects enumeration count questions", () => {
    expect(isEnumerationCountQuestionPrompt("fooField 有几个选项？")).toBe(true);
    expect(isEnumerationCountQuestionPrompt("你联网搜搜，有几个选项")).toBe(true);
    expect(buildConfigBindingTopicHint("enumeration")).toContain("首句");
  });

  it("requires doc lookup intent plus config context", () => {
    expect(isExternalApiLookupPrompt("你联网搜搜")).toBe(false);
    expect(isExternalApiLookupPrompt("查一下官方文档里的 option 定义")).toBe(true);
    expect(buildConfigBindingTopicHint("doc_lookup")).toContain("web_extract");
  });

  it("resolves at most one topic with priority reject > enumeration > lookup", () => {
    expect(resolveConfigBindingTopic("不是这几个选项")).toBe("reject");
    expect(resolveConfigBindingTopic("有几个取值？")).toBe("enumeration");
    expect(resolveConfigBindingTopic("查官方文档里的 enum 定义")).toBe("doc_lookup");
    expect(resolveConfigBindingTopic("帮我改路由")).toBe(null);
  });
});

describe("isUltraShortOpenTaskPrompt", () => {
  it("detects ultra-short open-ended instructions by shape", () => {
    expect(isUltraShortOpenTaskPrompt("找bug")).toBe(true);
    expect(isUltraShortOpenTaskPrompt("查一下")).toBe(true);
    expect(isUltraShortOpenTaskPrompt("排查")).toBe(true);
    expect(isUltraShortOpenTaskPrompt("优化一下")).toBe(true);
    expect(isUltraShortOpenTaskPrompt("帮忙看看")).toBe(true);
    expect(isUltraShortOpenTaskPrompt("跑一下")).toBe(true);
  });

  it("rejects questions, scoped requests, and code review prompts", () => {
    expect(isUltraShortOpenTaskPrompt("找bug？")).toBe(false);
    expect(isUltraShortOpenTaskPrompt("为什么找bug")).toBe(false);
    expect(isUltraShortOpenTaskPrompt("修复 src/foo.ts 的类型错误")).toBe(false);
    expect(isUltraShortOpenTaskPrompt("检查一下")).toBe(false);
    expect(isUltraShortOpenTaskPrompt("看看代码")).toBe(false);
    expect(isUltraShortOpenTaskPrompt("优化UI")).toBe(false);
    expect(isUltraShortOpenTaskPrompt("")).toBe(false);
  });
});
