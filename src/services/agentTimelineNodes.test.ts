import { describe, expect, it } from "vitest";
import {
  buildTimelineEntriesFromBlocks,
  buildTimelineNodesFromSteps,
  formatPathSegment,
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

describe("formatPathSegment", () => {
  it("shortens deep paths for breadcrumb chips", () => {
    expect(formatPathSegment("src/acme/module/feature/Tasks")).toBe("…/acme/module/feature/Tasks");
  });
});
