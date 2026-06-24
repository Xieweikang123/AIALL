import { describe, expect, it } from "vitest";
import {
  buildTimelineEntriesFromBlocks,
  buildTimelineNodesFromSteps,
  buildTimelineProcessSummary,
  buildTimelineThoughtSummary,
  formatPathSegment,
  selectVisibleTimelineThoughts,
  shouldAutoExpandTimelineThoughts,
  shouldCollapseTimelineProcess,
} from "./agentTimelineNodes";
import type { AgentRoundTool } from "./agentRoundGroups";
import type { CursorFeedBlock } from "./agentCursorFeed";

function step(partial: Partial<AgentRoundTool> & Pick<AgentRoundTool, "id" | "name">): AgentRoundTool {
  return {
    icon: "📄",
    title: partial.name,
    detail: "",
    label: partial.name,
    summary: "",
    ok: true,
    ...partial,
  };
}

describe("buildTimelineNodesFromSteps", () => {
  it("merges consecutive list_dir steps into one explore node with breadcrumb chips", () => {
    const nodes = buildTimelineNodesFromSteps([
      step({ id: "1", name: "list_dir", args: { path: "src" }, detail: "src" }),
      step({
        id: "2",
        name: "list_dir",
        args: { path: "src/acme/module/feature" },
        detail: "src/acme/module/feature",
      }),
      step({
        id: "3",
        name: "list_dir",
        args: { path: "src/acme/module/feature/Tasks" },
        detail: "src/acme/module/feature/Tasks",
      }),
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe("explore");
    expect(nodes[0]?.chips).toHaveLength(3);
    expect(nodes[0]?.title).toContain("3 级");
  });

  it("groups reads and searches into separate nodes", () => {
    const nodes = buildTimelineNodesFromSteps([
      step({ id: "1", name: "read_file", args: { path: "src/a.ts" }, detail: "src/a.ts" }),
      step({ id: "2", name: "read_file", args: { path: "src/b.ts" }, detail: "src/b.ts" }),
      step({ id: "3", name: "grep", args: { pattern: "Foo" }, fullResult: "src/a.ts:1: Foo" }),
    ]);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.kind).toBe("read");
    expect(nodes[0]?.chips).toHaveLength(2);
    expect(nodes[1]?.kind).toBe("search");
  });

  it("marks running steps with running status", () => {
    const nodes = buildTimelineNodesFromSteps([
      step({ id: "1", name: "read_file", args: { path: "src/a.ts" }, running: true }),
    ]);
    expect(nodes[0]?.status).toBe("running");
  });
});

describe("buildTimelineEntriesFromBlocks", () => {
  it("builds chronological thought, collapsed, node, and answer entries", () => {
    const blocks: CursorFeedBlock[] = [
      { kind: "thought", key: "t1", text: "先看看相关任务代码。" },
      {
        kind: "actions",
        key: "a1",
        collapsed: [{ key: "c1", step: step({ id: "c1", name: "list_dir", args: { path: "src" } }) }],
        visible: [{ key: "v1", step: step({ id: "v1", name: "read_file", args: { path: "src/a.ts" } }) }],
      },
      { kind: "answer", key: "ans", text: "是的，有一个定时任务。", streaming: false },
    ];

    const entries = buildTimelineEntriesFromBlocks(blocks);
    expect(entries.map((entry) => entry.kind)).toEqual(["thought", "collapsed", "node", "answer"]);
  });
});

describe("buildTimelineThoughtSummary", () => {
  it("uses a truncated preview for a single thought", () => {
    const summary = buildTimelineThoughtSummary([
      { kind: "thought", key: "t1", text: "好的，我先读取配置文件，确认项目结构后再修改组件。" },
    ]);
    expect(summary).toContain("配置文件");
  });

  it("labels multiple thoughts with count and latest preview", () => {
    const summary = buildTimelineThoughtSummary([
      { kind: "thought", key: "t1", text: "第一段进度摘要。" },
      { kind: "thought", key: "t2", text: "第二段进度摘要，说明接下来要改 Git 面板。" },
    ]);
    expect(summary).toContain("思考过程 · 2 段");
    expect(summary).toContain("Git");
  });
});

describe("shouldAutoExpandTimelineThoughts", () => {
  it("stays collapsed while running or when an answer exists", () => {
    expect(
      shouldAutoExpandTimelineThoughts({
        isRunning: true,
        hasAnswer: false,
        thoughtCount: 3,
        activityDetailed: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoExpandTimelineThoughts({
        isRunning: false,
        hasAnswer: true,
        thoughtCount: 3,
        activityDetailed: true,
      }),
    ).toBe(false);
  });

  it("expands only for completed detailed runs without an answer block", () => {
    expect(
      shouldAutoExpandTimelineThoughts({
        isRunning: false,
        hasAnswer: false,
        thoughtCount: 2,
        activityDetailed: true,
      }),
    ).toBe(true);
  });
});

describe("selectVisibleTimelineThoughts", () => {
  const thoughts = [
    { kind: "thought" as const, key: "t1", text: "好的，我先读取配置文件，确认项目结构后再修改组件。" },
    { kind: "thought" as const, key: "t2", text: "Let me check the full template for any button." },
    { kind: "thought" as const, key: "t3", text: "进度摘要：已定位 minimap 设置入口，接下来修改 EditorPanel。" },
  ];

  it("returns empty when an answer block is present", () => {
    expect(
      selectVisibleTimelineThoughts(thoughts, {
        showThoughts: true,
        isRunning: false,
        hasAnswer: true,
        answerText: "进度摘要：已定位 minimap 设置入口，接下来修改 EditorPanel。",
      }),
    ).toEqual([]);
  });

  it("filters tool-turn narration and keeps substantive thoughts", () => {
    const visible = selectVisibleTimelineThoughts(thoughts, {
      showThoughts: true,
      isRunning: false,
      hasAnswer: false,
    });
    expect(visible.map((entry) => entry.key)).toEqual(["t1", "t3"]);
  });

  it("keeps only the latest thought while running without an answer", () => {
    const visible = selectVisibleTimelineThoughts(thoughts, {
      showThoughts: true,
      isRunning: true,
      hasAnswer: false,
    });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.key).toBe("t3");
  });

  it("returns empty when thoughts are hidden", () => {
    expect(
      selectVisibleTimelineThoughts(thoughts, {
        showThoughts: false,
        isRunning: true,
        hasAnswer: false,
      }),
    ).toEqual([]);
  });
});

describe("formatPathSegment", () => {
  it("shortens deep paths for breadcrumb chips", () => {
    expect(formatPathSegment("src/acme/module/feature/Tasks")).toBe("…/acme/module/feature/Tasks");
  });
});

describe("timeline process auto-collapse", () => {
  it("collapses tool steps once an answer block is present", () => {
    expect(
      shouldCollapseTimelineProcess({
        hasAnswer: true,
        toolCount: 3,
        activityDetailed: false,
      }),
    ).toBe(true);
  });

  it("keeps tools visible while exploring or in detailed mode", () => {
    expect(
      shouldCollapseTimelineProcess({
        hasAnswer: false,
        toolCount: 3,
        activityDetailed: false,
      }),
    ).toBe(false);
    expect(
      shouldCollapseTimelineProcess({
        hasAnswer: true,
        toolCount: 3,
        activityDetailed: true,
      }),
    ).toBe(false);
  });

  it("builds a compact summary for the folded process header", () => {
    const blocks: CursorFeedBlock[] = [{
      kind: "actions",
      key: "actions-0",
      collapsed: [],
      visible: [{
        key: "t1",
        step: step({ id: "t1", name: "grep", title: "代码搜索", detail: "minimap" }),
      }],
    }];
    expect(buildTimelineProcessSummary(blocks)).toBe("探索过程 · 搜索 1 次");
  });
});
