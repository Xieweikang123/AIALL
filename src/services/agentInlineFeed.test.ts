import { describe, expect, it } from "vitest";
import {
  appendInlineAnswerBlock,
  buildInlineAgentFeed,
  collapseInlineFeedItems,
  filterInlineTimelineItems,
  splitInlineFeedItems,
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
  it("interleaves narrative text and tools in chronological order", () => {
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

    const kinds = feed.items.map((item) => item.kind);
    expect(kinds).toEqual(["text", "tool", "text"]);
    expect(feed.items[0]).toMatchObject({ kind: "text", variant: "narrative", text: "我先读文件。" });
    expect(feed.items[1]).toMatchObject({ kind: "tool", key: "t1" });
    expect(feed.items[2]).toMatchObject({ kind: "text", variant: "answer", text: "这是最终回答" });
  });

  it("appends streaming answer placeholder when preview is empty", () => {
    const feed = buildInlineAgentFeed({
      roundGroups: [{
        turn: 1,
        modelSteps: [],
        toolIds: ["t1"],
        narrative: "",
        tools: [readStep("t1")],
      }],
      answerPreview: "",
      answerStreaming: true,
      isRunning: true,
      activityDetailed: false,
      compactFeed: false,
      agentPhase: "streaming_model",
    });

    const answer = feed.items.at(-1);
    expect(answer).toMatchObject({
      kind: "text",
      variant: "answer",
      text: "",
      streaming: true,
    });
  });

  it("dedupes trailing narrative duplicated by the final answer", () => {
    const items: InlineFeedItem[] = [
      { kind: "text", key: "n1", text: "完整回答正文", variant: "narrative" },
    ];

    const merged = appendInlineAnswerBlock(items, "完整回答正文", false);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ kind: "text", variant: "answer", text: "完整回答正文" });
  });

  it("keeps tools before answer across multiple turns", () => {
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
    expect(feed.items.at(-1)).toMatchObject({ kind: "text", variant: "answer" });
  });

  it("collapses early tools when step count exceeds threshold", () => {
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
      isRunning: false,
      activityDetailed: false,
      compactFeed: false,
    });

    expect(feed.items[0]?.kind).toBe("collapsed");
    const visibleTools = feed.items.filter((item) => item.kind === "tool");
    expect(visibleTools).toHaveLength(4);
    expect(feed.items.at(-1)).toMatchObject({ kind: "text", variant: "answer" });
  });

  it("skips process items when showProcess is false", () => {
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

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ kind: "text", variant: "answer", text: "仅答案" });
    expect(feed.toolCount).toBe(0);
  });

  it("filters tool-turn filler from the live timeline", () => {
    const items: InlineFeedItem[] = [
      { kind: "text", key: "n1", text: "我先读文件。", variant: "narrative" },
      { kind: "tool", key: "t1", step: readStep("t1") },
      { kind: "text", key: "n2", text: "直接 patch：", variant: "narrative" },
    ];
    const filtered = filterInlineTimelineItems(items);
    expect(filtered.map((item) => item.kind)).toEqual(["text", "tool"]);
    expect(filtered[0]).toMatchObject({ text: "我先读文件。" });
  });

  it("splits process and answer items", () => {
    const items: InlineFeedItem[] = [
      { kind: "text", key: "n1", text: "分析", variant: "narrative" },
      { kind: "tool", key: "t1", step: readStep("t1") },
      { kind: "text", key: "a1", text: "结论", variant: "answer" },
    ];
    const { process, answer } = splitInlineFeedItems(items);
    expect(process).toHaveLength(2);
    expect(answer).toMatchObject({ variant: "answer", text: "结论" });
    expect(summarizeInlineFeedProcess(process, 1, false)).toMatch(/1 步/);
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
        { kind: "text", key: "n0", text: "开始", variant: "narrative" },
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
