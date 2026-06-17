import { describe, expect, it } from "vitest";
import {
  compressHistoryForExecution,
  compressPlanForHistory,
  extractPlanCodeBlocks,
  extractPlanFilePaths,
  findLastAssistantContentInMessages,
  isExecutionContinuation,
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
    expect(isExecutionContinuation("执行方案")).toBe(true);
  });

  it("rejects ambiguous bare 继续", () => {
    expect(isExecutionContinuation("继续")).toBe(false);
  });

  it("matches execution-oriented 继续 phrasing", () => {
    expect(isExecutionContinuation("继续执行")).toBe(true);
    expect(isExecutionContinuation("继续改")).toBe(true);
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

describe("compressHistoryForExecution", () => {
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
