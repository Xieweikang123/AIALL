import { describe, expect, it } from "vitest";
import { aggregateToolSteps, summarizeAggregateSteps } from "./agentToolAggregates";
import type { AgentRoundTool } from "./agentRoundGroups";

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

describe("aggregateToolSteps", () => {
  it("merges multiple reads of the same file into one card", () => {
    const steps: AgentRoundTool[] = [
      step({
        id: "1",
        name: "read_file",
        args: { path: "src/FooController.cs", offset: 530, limit: 50 },
        fullResult: "line530\nline580",
      }),
      step({
        id: "2",
        name: "grep",
        args: { pattern: "Bar" },
        fullResult: "src/FooController.cs:705: private static bool Bar()",
      }),
      step({
        id: "3",
        name: "read_file",
        args: { path: "src/FooController.cs", offset: 640, limit: 50 },
      }),
    ];

    const cards = aggregateToolSteps(steps);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.kind).toBe("file");
    expect(cards[0]?.title).toBe("FooController.cs");
    expect(cards[0]?.subtitle).toContain("读取 2 次");
    expect(cards[1]?.kind).toBe("search");
    expect(cards[1]?.subtitle).toContain("Bar");
  });

  it("builds search preview from grep hits", () => {
    const cards = aggregateToolSteps([
      step({
        id: "g1",
        name: "grep",
        args: { pattern: "Alpha" },
        fullResult: "src/a.ts:10: const Alpha = 1;\nsrc/b.ts:20: Alpha()",
      }),
    ]);
    expect(cards[0]?.previewLines[0]).toContain("Alpha →");
  });

  it("merges multiple run_command steps into one card", () => {
    const cards = aggregateToolSteps([
      step({
        id: "c1",
        name: "run_command",
        args: { command: "npm test" },
        ok: true,
      }),
      step({
        id: "c2",
        name: "run_command",
        args: { command: "npm run build" },
        ok: false,
      }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe("执行命令");
    expect(cards[0]?.subtitle).toContain("2 次");
    expect(cards[0]?.subtitle).toContain("有失败");
    expect(cards[0]?.previewLines[0]).toContain("npm test");
  });

  it("shows single run_command as terminal title", () => {
    const cards = aggregateToolSteps([
      step({
        id: "c1",
        name: "run_command",
        args: { command: "npm test" },
        fullResult: "stdout:\nTests passed",
        ok: true,
      }),
    ]);
    expect(cards[0]?.title).toBe("$ npm test");
    expect(cards[0]?.subtitle).toBe("完成");
    expect(cards[0]?.previewLines[0]).toBe("Tests passed");
  });

  it("summarizes collapsed steps for fold header", () => {
    const summary = summarizeAggregateSteps([
      step({ id: "1", name: "read_file", args: { path: "src/a.ts" } }),
      step({ id: "2", name: "grep", args: { pattern: "x" } }),
    ]);
    expect(summary).toContain("2 步");
    expect(summary).toContain("搜");
  });
});
