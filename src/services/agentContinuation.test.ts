import { describe, expect, it } from "vitest";
import {
  compressHistoryForExecution,
  compressPlanForHistory,
  extractPlanCodeBlocks,
  extractPlanFilePaths,
  isExecutionContinuation,
  looksLikeModificationPlan,
} from "./agentContinuation";

const SAMPLE_PLAN = [
  "## 修改方案",
  "需要改 `src/components/ChatComposerEditor.vue` 和 `ChatComposerEditor.vue`：",
  "```ts",
  "const imageDataUrl = ref('');",
  "```",
  "以及 `src/services/vibeAgentClient.ts` 和 `src/views/VibeCodingView.vue`。",
].join("\n");

describe("isExecutionContinuation", () => {
  it("matches short confirmations", () => {
    expect(isExecutionContinuation("改吧")).toBe(true);
    expect(isExecutionContinuation("好的")).toBe(true);
    expect(isExecutionContinuation("执行吧")).toBe(true);
  });

  it("rejects long exploratory prompts", () => {
    expect(isExecutionContinuation("请把聊天框改成支持粘贴图片")).toBe(false);
  });

  it("matches implementation intent after a quoted reply", () => {
    expect(
      isExecutionContinuation("> Agent: 2. Vibe Coding 页 (/vibe-coding → VibeCodingView.vue)\n\n实现 vibe coding页的"),
    ).toBe(true);
    expect(isExecutionContinuation("帮我实现一下发图功能")).toBe(true);
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
      looksLikeModificationPlan("当前不支持发图。是否需要我帮你实现粘贴图片？"),
    ).toBe(false);
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
    expect(extractPlanCodeBlocks(SAMPLE_PLAN)).toEqual(["const imageDataUrl = ref('');"]);
  });
});

describe("compressPlanForHistory", () => {
  it("keeps file list and code blocks for execution", () => {
    const compressed = compressPlanForHistory(SAMPLE_PLAN);
    expect(compressed).toContain("[已确认方案]");
    expect(compressed).toContain("read_file");
    expect(compressed).toContain("imageDataUrl");
  });
});

describe("compressHistoryForExecution", () => {
  it("drops earlier chitchat and keeps only the plan exchange", () => {
    const longIntro = "a".repeat(5000);
    const history = [
      { role: "user" as const, content: "介绍项目" },
      { role: "assistant" as const, content: longIntro },
      { role: "user" as const, content: "能粘贴图片吗" },
      { role: "assistant" as const, content: SAMPLE_PLAN },
    ];
    const compressed = compressHistoryForExecution(history, "改吧");
    expect(compressed).toHaveLength(2);
    expect(compressed[0].content).toBe("能粘贴图片吗");
    expect(compressed[1].content).toContain("[已确认方案]");
    expect(compressed.some((m) => m.content.includes(longIntro))).toBe(false);
  });
});
