import { describe, expect, it } from "vitest";
import { buildAgentTraceTurns } from "./agentTraceTimeline";
import type { AgentRoundGroupView } from "./agentRoundGroups";

function group(overrides: Partial<AgentRoundGroupView>): AgentRoundGroupView {
  return {
    turn: 1,
    modelSteps: [],
    toolIds: [],
    ...overrides,
  };
}

describe("buildAgentTraceTurns", () => {
  it("builds request/response/tool entries per turn in data-flow order", () => {
    const turns = buildAgentTraceTurns([
      group({
        turn: 1,
        request: {
          model: "test-model",
          contextMessages: 2,
          contextChars: 1200,
          messages: [
            { role: "user", content: "帮我改这个文件" },
            { role: "assistant", content: "上一轮回复" },
            { role: "user", content: "最新的这条" },
          ],
        },
        response: {
          assistantText: "好的，我来修改。",
          toolCalls: [{ id: "t1", name: "patch_file", arguments: "{}" }],
          hasToolCalls: true,
          isFinal: false,
        },
        toolIds: ["t1"],
        tools: [
          {
            id: "t1",
            name: "patch_file",
            icon: "✏️",
            title: "修改",
            detail: "src/a.ts",
            label: "修改",
            summary: "已修改",
            ok: true,
            args: { path: "src/a.ts" },
          },
        ],
      }),
    ]);

    expect(turns).toHaveLength(1);
    const [turn] = turns;
    expect(turn.turn).toBe(1);
    expect(turn.model).toBe("test-model");
    expect(turn.entries.map((entry) => entry.kind)).toEqual([
      "request",
      "request",
      "request",
      "response",
      "tool",
    ]);
    expect(turn.entries[0]?.label).toContain("帮我改这个文件");
    expect(turn.entries[2]?.label).toContain("发给模型");
    expect(turn.entries[3]?.label).toContain("好的，我来修改");
    expect(turn.entries[4]?.label).toContain("src/a.ts");
  });

  it("marks failed tools and skips turns without any entries", () => {
    const turns = buildAgentTraceTurns([
      group({ turn: 0, narrative: "setup phase, not a real turn" }),
      group({
        turn: 1,
        toolIds: ["t1"],
        tools: [
          {
            id: "t1",
            name: "grep",
            icon: "🔍",
            title: "搜索",
            detail: "pattern",
            label: "搜索",
            summary: "错误：失败",
            ok: false,
          },
        ],
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.entries).toHaveLength(1);
    expect(turns[0]?.entries[0]?.ok).toBe(false);
  });

  it("truncates oversized detail bodies", () => {
    const huge = "x".repeat(30_000);
    const turns = buildAgentTraceTurns([
      group({
        turn: 1,
        response: {
          assistantText: huge,
          toolCalls: [],
          hasToolCalls: false,
          isFinal: true,
        },
      }),
    ]);

    const detail = turns[0]?.entries[0]?.detail ?? "";
    expect(detail.length).toBeLessThan(30_000);
    expect(detail).toContain("已截断");
  });
});