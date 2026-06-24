import { describe, expect, it } from "vitest";
import {
  compressHistoryForExecution,
  compressPlanForHistory,
  compressProposalForHistory,
  classifyAssistantReply,
  detectUserFailureReport,
  extractPlanCodeBlocks,
  extractPlanFilePaths,
  findLastAssistantContentInMessages,
  historyRecentUserFailureReport,
  isExecutionContinuation,
  looksLikeActionableProposal,
  looksLikeModificationPlan,
} from "./agentContinuation";

const SAMPLE_PLAN = [
  "## 修改方案",
  "需要改 `src/components/ChatComposerEditor.vue` 和 `ChatComposerEditor.vue`：",
  "```ts",
  "const featureFlag = ref(false);",
  "```",
  "以及 `src/services/vibeAgentClient.ts` 和 `src/views/VibeCodingView.vue`。",
].join("\n");

describe("isExecutionContinuation", () => {
  it("matches short confirmations", () => {
    expect(isExecutionContinuation("改吧")).toBe(true);
    expect(isExecutionContinuation("好的")).toBe(true);
    expect(isExecutionContinuation("执行吧")).toBe(true);
    expect(isExecutionContinuation("执行")).toBe(true);
    expect(isExecutionContinuation("执行方案")).toBe(true);
    expect(isExecutionContinuation("继续")).toBe(true);
    expect(isExecutionContinuation("优化")).toBe(true);
    expect(isExecutionContinuation("优化吧")).toBe(true);
    expect(isExecutionContinuation("改进一下")).toBe(true);
  });

  it("rejects long exploratory prompts", () => {
    expect(isExecutionContinuation("请把聊天框改成支持某功能")).toBe(false);
  });

  it("matches implementation intent after a quoted reply", () => {
    expect(
      isExecutionContinuation("> Agent: 2. 某页面 (/foo → FooView.vue)\n\n实现该页的改动"),
    ).toBe(true);
    expect(isExecutionContinuation("帮我实现一下")).toBe(true);
    expect(isExecutionContinuation("那就做吧")).toBe(true);
  });
});

const ACTIONABLE_PROPOSAL = [
  "具体改动：",
  "1. 移除 `src/foo.ts` 中的 `deadProp` 绑定",
  "2. 删除 `src/bar.scss` 内无用样式",
  "",
  "需要我执行这个修改吗？",
].join("\n");

describe("looksLikeActionableProposal", () => {
  it("detects numbered edits with file refs even when asking for confirmation", () => {
    expect(looksLikeActionableProposal(ACTIONABLE_PROPOSAL)).toBe(true);
    expect(looksLikeModificationPlan(ACTIONABLE_PROPOSAL)).toBe(false);
  });

  it("rejects analysis that only asks whether to implement", () => {
    expect(
      looksLikeActionableProposal("当前不支持某功能。是否需要我帮你实现？"),
    ).toBe(false);
  });

  it("rejects audit reports with improvement advice as executable proposals", () => {
    const report = [
      "## 审计报告",
      "### 改进建议",
      "1. Build 模式下默认直接执行。",
      "2. 读取当前状态，避免误判。",
      "3. 一次读取覆盖所需范围，避免碎片化读取。",
      "示例：`src/styles/foo.scss` 里曾出现 gap 过大。",
    ].join("\n");
    expect(looksLikeActionableProposal(report)).toBe(false);
    expect(looksLikeModificationPlan(report)).toBe(false);
  });
});

describe("looksLikeModificationPlan", () => {
  it("detects plan-like assistant replies", () => {
    expect(looksLikeModificationPlan(SAMPLE_PLAN)).toBe(true);
    expect(looksLikeModificationPlan("项目介绍如下…")).toBe(false);
  });

  it("rejects analysis that only asks whether to implement", () => {
    expect(
      looksLikeModificationPlan("当前不支持某功能。是否需要我帮你实现？"),
    ).toBe(false);
  });

  it("rejects analysis with code snippet but no plan structure", () => {
    expect(
      looksLikeModificationPlan(
        [
          "可以在 `src/foo.ts` 里加一行：",
          "```ts",
          "export const featureFlag = true;",
          "```",
          "是否需要我帮你改？",
        ].join("\n"),
      ),
    ).toBe(false);
  });

  it("accepts explicit [PLAN] marker with target file", () => {
    expect(
      looksLikeModificationPlan(
        ["[PLAN]", "改 `src/foo.ts`：", "```ts", "export {};", "```"].join("\n"),
      ),
    ).toBe(true);
  });

  it("accepts multi-file plan without code blocks when structure keywords present", () => {
    expect(
      looksLikeModificationPlan(
        ["## 修改方案", "涉及文件：`src/a.ts`、`src/b.ts`", "第一步改 a，第二步改 b。"].join("\n"),
      ),
    ).toBe(true);
  });
});

describe("classifyAssistantReply", () => {
  it("classifies audit reports before action hints inside the report", () => {
    const report = [
      "## 审计报告",
      "### 改进建议",
      "1. Build 模式下默认直接执行。",
      "2. 读取当前状态，避免误判。",
    ].join("\n");
    expect(classifyAssistantReply(report)).toBe("audit_report");
  });

  it("classifies concrete plans as actionable", () => {
    expect(classifyAssistantReply(ACTIONABLE_PROPOSAL)).toBe("actionable_plan");
  });
});

describe("findLastAssistantContentInMessages", () => {
  it("prefers the latest plan-like assistant message", () => {
    const content = findLastAssistantContentInMessages([
      { role: "user", content: "需求" },
      { role: "assistant", content: SAMPLE_PLAN },
      { role: "user", content: "再解释一下" },
      { role: "assistant", content: "这是补充说明，不涉及改代码。" },
    ]);
    expect(content).toBe(SAMPLE_PLAN);
  });
});

describe("extractPlanFilePaths", () => {
  it("collects unique file paths and drops bare duplicates", () => {
    expect(extractPlanFilePaths(SAMPLE_PLAN)).toEqual([
      "src/components/ChatComposerEditor.vue",
      "src/services/vibeAgentClient.ts",
      "src/views/VibeCodingView.vue",
    ]);
  });

  it("drops import-relative paths starting with ./", () => {
    expect(
      extractPlanFilePaths(
        "改 `src/main.ts` 中的 `import './assets/scrollbar.css'` 以及 `src/assets/scrollbar.css`",
      ),
    ).toEqual(["src/main.ts", "src/assets/scrollbar.css"]);
  });
});

describe("extractPlanCodeBlocks", () => {
  it("extracts fenced code blocks from the plan", () => {
    expect(extractPlanCodeBlocks(SAMPLE_PLAN)).toEqual(["const featureFlag = ref(false);"]);
  });
});

describe("compressPlanForHistory", () => {
  it("keeps file list and code blocks for execution", () => {
    const compressed = compressPlanForHistory(SAMPLE_PLAN);
    expect(compressed).toContain("[已确认方案]");
    expect(compressed).toContain("read_file");
    expect(compressed).toContain("featureFlag");
  });
});

describe("compressProposalForHistory", () => {
  it("compresses actionable proposals for execution", () => {
    const compressed = compressProposalForHistory(ACTIONABLE_PROPOSAL);
    expect(compressed).toContain("[已确认改动]");
    expect(compressed).toContain("src/foo.ts");
  });
});

describe("compressHistoryForExecution", () => {
  it("compresses history after actionable proposal confirmation", () => {
    const history = [
      { role: "user" as const, content: "状态行重复了" },
      { role: "assistant" as const, content: ACTIONABLE_PROPOSAL },
    ];
    const compressed = compressHistoryForExecution(history, "执行");
    expect(compressed).toHaveLength(2);
    expect(compressed[1].content).toContain("[已确认改动]");
  });

  it("drops earlier chitchat and keeps only the plan exchange", () => {
    const longIntro = "a".repeat(5000);
    const history = [
      { role: "user" as const, content: "介绍项目" },
      { role: "assistant" as const, content: longIntro },
      { role: "user" as const, content: "某功能需求" },
      { role: "assistant" as const, content: SAMPLE_PLAN },
    ];
    const compressed = compressHistoryForExecution(history, "改吧");
    expect(compressed).toHaveLength(2);
    expect(compressed[0].content).toBe("某功能需求");
    expect(compressed[1].content).toContain("[已确认方案]");
    expect(compressed.some((m) => m.content.includes(longIntro))).toBe(false);
  });

  it("finds an earlier plan when the latest assistant reply is not a plan", () => {
    const history = [
      { role: "user" as const, content: "需求" },
      { role: "assistant" as const, content: SAMPLE_PLAN },
      { role: "user" as const, content: "改吧" },
      { role: "assistant" as const, content: "好的，我再看看…" },
    ];
    const compressed = compressHistoryForExecution(history, "改吧");
    expect(compressed).toHaveLength(2);
    expect(compressed[1].content).toContain("[已确认方案]");
  });
});

describe("detectUserFailureReport", () => {
  it("detects practical failure reports", () => {
    expect(detectUserFailureReport("试了，并没有通知")).toBe(true);
    expect(detectUserFailureReport("电脑没弹出提示")).toBe(true);
    expect(detectUserFailureReport("看起来，没生效呢")).toBe(true);
    expect(detectUserFailureReport("还是不显示呢")).toBe(true);
    expect(detectUserFailureReport("帮我加个按钮")).toBe(false);
  });
});

describe("historyRecentUserFailureReport", () => {
  it("returns true when recent user messages report failure", () => {
    const history = [
      { role: "assistant", content: "已完成修改" },
      { role: "user", content: "试了，并没有效果" },
    ];
    expect(historyRecentUserFailureReport(history)).toBe(true);
  });

  it("returns false for unrelated history", () => {
    expect(historyRecentUserFailureReport([{ role: "user", content: "检查下" }])).toBe(false);
  });
});
