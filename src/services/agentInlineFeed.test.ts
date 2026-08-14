import { describe, expect, it } from "vitest";
import {
  buildInlineAgentFeed,
  collapseInlineFeedItems,
  summarizeInlineFeedProcess,
} from "./agentInlineFeed";
import type { AgentRoundGroupView } from "./agentRoundGroups";
import type { InlineFeedItem } from "./agentInlineFeed";

function readStep(id: string): AgentRoundGroupView["tools"][number] {
  return {
    id,
    turn: 1,
    name: "read_file",
    icon: "📄",
    title: "读取",
    detail: "src/foo.ts",
    label: "读取",
    summary: "ok",
    ok: true,
    args: { path: "src/foo.ts" },
  };
}

describe("buildInlineAgentFeed", () => {
  it("renders narrative and tools in chronological order with no separate answer item", () => {
    const groups: AgentRoundGroupView[] = [{
      turn: 1,
      modelSteps: [],
      toolIds: ["t1"],
      narrative: "我先读文件。",
      tools: [readStep("t1")],
    }];

    const feed = buildInlineAgentFeed({
      roundGroups: groups,
      answerPreview: "这是最终回答",
      answerStreaming: false,
      isRunning: false,
      activityDetailed: false,
      compactFeed: false,
    });

    // No answer item: narrative + tools only
    const kinds = feed.items.map((item) => item.kind);
    expect(kinds).toEqual(["text", "tool"]);
    expect(feed.items[0]).toMatchObject({ kind: "text", variant: "narrative", text: "我先读文件。" });
    expect(feed.items[1]).toMatchObject({ kind: "tool", key: "t1" });
  });

  it("shows only narrative when there are no tools", () => {
    const feed = buildInlineAgentFeed({
      roundGroups: [{
        turn: 1,
        modelSteps: [],
        toolIds: [],
        narrative: "直接回答。",
        tools: [],
      }],
      answerPreview: "直接回答。",
      answerStreaming: false,
      isRunning: false,
      activityDetailed: false,
      compactFeed: false,
    });

    const kinds = feed.items.map((item) => item.kind);
    expect(kinds).toEqual(["text"]);
    expect(feed.items[0]).toMatchObject({ kind: "text", variant: "narrative", text: "直接回答。" });
  });

  it("keeps tools before next narrative across multiple turns", () => {
    const groups: AgentRoundGroupView[] = [
      {
        turn: 1,
        modelSteps: [],
        toolIds: ["t1"],
        narrative: "第一轮分析。",
        tools: [readStep("t1")],
      },
      {
        turn: 2,
        modelSteps: [],
        toolIds: ["t2"],
        narrative: "继续搜索。",
        tools: [{
          ...readStep("t2"),
          id: "t2",
          name: "grep",
          icon: "🔍",
          title: "搜索",
          detail: "pattern",
          args: { pattern: "foo" },
        }],
      },
    ];

    const feed = buildInlineAgentFeed({
      roundGroups: groups,
      answerPreview: "结论在这里。",
      answerStreaming: false,
      isRunning: false,
      activityDetailed: false,
      compactFeed: false,
    });

    const toolKeys = feed.items.filter((item) => item.kind === "tool").map((item) => item.key);
    expect(toolKeys).toEqual(["t1", "t2"]);
    // In single-stream linear model, the last item is the last turn's tool, not a separate answer
    expect(feed.items.at(-1)).toMatchObject({ kind: "tool" });
  });

  it("keeps all tool steps visible while running (no collapse)", () => {
    const tools = Array.from({ length: 8 }, (_, index) => ({
      ...readStep(`t${index}`),
      id: `t${index}`,
      detail: `src/file${index}.ts`,
      args: { path: `src/file${index}.ts` },
    }));

    const feed = buildInlineAgentFeed({
      roundGroups: [{
        turn: 1,
        modelSteps: [],
        toolIds: tools.map((tool) => tool.id),
        narrative: "探索中。",
        tools,
      }],
      answerPreview: "完成。",
      answerStreaming: false,
      isRunning: true,
      activityDetailed: false,
      compactFeed: false,
    });

    expect(feed.items.some((item) => item.kind === "collapsed")).toBe(false);
    const visibleTools = feed.items.filter((item) => item.kind === "tool");
    expect(visibleTools).toHaveLength(8);
  });

  it("returns empty feed when showProcess is false", () => {
    const feed = buildInlineAgentFeed({
      roundGroups: [{
        turn: 1,
        modelSteps: [],
        toolIds: ["t1"],
        narrative: "我先读文件。",
        tools: [readStep("t1")],
      }],
      answerPreview: "仅答案",
      answerStreaming: false,
      isRunning: false,
      activityDetailed: false,
      compactFeed: false,
      showProcess: false,
    });

    expect(feed.items).toHaveLength(0);
    expect(feed.toolCount).toBe(0);
  });

  it("does not collapse running tools into the hidden prefix", () => {
    const tools = Array.from({ length: 6 }, (_, index) => ({
      ...readStep(`t${index}`),
      id: `t${index}`,
      running: index === 2,
      ok: index !== 2,
    }));

    const collapsed = collapseInlineFeedItems(
      [
        { kind: "text" as const, key: "n0", text: "开始", variant: "narrative" as const },
        ...tools.map((step) => ({ kind: "tool" as const, key: step.id, step })),
      ],
      { collapseAfter: 5, keepVisible: 2 },
    );

    const runningVisible = collapsed.some(
      (item) => item.kind === "tool" && item.step.id === "t2",
    );
    expect(runningVisible).toBe(true);
    expect(collapsed.some((item) => item.kind === "collapsed")).toBe(true);
  });
});

describe("summarizeInlineFeedProcess", () => {
  it("summarizes narrative-only feed", () => {
    expect(summarizeInlineFeedProcess([], 0, false)).toBe("查看过程");
    expect(summarizeInlineFeedProcess([
      { kind: "text", key: "n1", text: "hello", variant: "narrative" },
    ], 0, false)).toBe("1 段分析");
  });
});
