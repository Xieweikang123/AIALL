import { describe, expect, it } from "vitest";
import { buildAgentTraceTurns } from "./agentTraceTimeline";
import type { AgentRoundGroup } from "./agentRoundGroups";

/**
 * 锁「详细度 = 展开程度」这条契约：
 * 切档**不改变条目集合**，只改变谁默认展开、正文多长。
 */
describe("轨迹档位 = 展开程度", () => {
  function group(overrides: Partial<AgentRoundGroup>): AgentRoundGroup {
    return { turn: 1, modelSteps: [], toolIds: [], ...overrides };
  }

  /** 一轮完整的轨迹：请求 + 思考 + 回复 + 工具。 */
  function fullTurn(): AgentRoundGroup {
    return group({
      turn: 1,
      reasoning: "先看看目录结构，README 提到这是 Tauri + Vue3",
      modelSteps: [{ id: "s1", text: "等待模型响应", phase: "waiting_model" }],
      request: {
        contextMessages: 2,
        contextChars: 100,
        messages: [
          { role: "user", content: "旧消息" },
          { role: "user", content: "解释这个项目" },
        ],
      },
      response: {
        assistantText: "这是一个桌面应用",
        toolCalls: [],
        hasToolCalls: false,
        isFinal: true,
      },
      toolIds: ["t1"],
      tools: [
        {
          id: "t1",
          name: "read_file",
          icon: "📄",
          title: "读取",
          detail: "README.md",
          label: "读取",
          summary: "ok",
          ok: true,
        },
      ],
    });
  }

  function kindsAt(level: Parameters<typeof buildAgentTraceTurns>[1]) {
    return buildAgentTraceTurns([fullTurn()], level, false)[0].entries.map((e) => e.kind);
  }

  it("条目集合不随档位变化（切档不会让东西突然消失）", () => {
    const brief = kindsAt("brief");
    const standard = kindsAt("standard");
    const detailed = kindsAt("detailed");
    const full = kindsAt("full");

    // 请求/思考/回复/工具在所有档位都在场
    for (const kinds of [brief, standard, detailed, full]) {
      expect(kinds).toContain("request");
      expect(kinds).toContain("reasoning");
      expect(kinds).toContain("response");
      expect(kinds).toContain("tool");
    }
    // 轮次内顺序也稳定
    expect(brief).toEqual(standard);
    expect(standard.slice(0, 4)).toEqual(detailed.slice(0, 4));
  });

  it("档位只改变「谁默认展开」", () => {
    const expandedKindsAt = (level: Parameters<typeof buildAgentTraceTurns>[1]) => {
      const entries = buildAgentTraceTurns([fullTurn()], level, false)[0].entries;
      return [...new Set(entries.filter((e) => e.expandedByDefault).map((e) => e.kind))];
    };

    expect(expandedKindsAt("brief")).toEqual([]);
    expect(expandedKindsAt("standard")).toEqual(["reasoning"]);
    expect(expandedKindsAt("detailed")).toEqual(["reasoning", "tool"]);
    expect(expandedKindsAt("full")).toContain("request");
    expect(expandedKindsAt("full")).toContain("response");
  });

  it("标准档下思考默认展开且正文就是思考原文", () => {
    const reasoning = buildAgentTraceTurns([fullTurn()], "standard", true)[0].entries.find(
      (e) => e.kind === "reasoning",
    );
    expect(reasoning?.expandedByDefault).toBe(true);
    expect(reasoning?.detail).toContain("先看看目录结构");
  });

  it("简略档全部折叠，但正文仍然构建（点开还能看）", () => {
    const entries = buildAgentTraceTurns([fullTurn()], "brief", false)[0].entries;
    expect(entries.every((e) => !e.expandedByDefault)).toBe(true);

    const reasoning = entries.find((e) => e.kind === "reasoning");
    expect(reasoning?.detail.trim().length).toBeGreaterThan(0);
  });

  it("全量档不截断任何正文", () => {
    const long = "思考内容".repeat(500);
    const g = group({ turn: 1, reasoning: long });
    const reasoning = buildAgentTraceTurns([g], "full", false)[0].entries.find(
      (e) => e.kind === "reasoning",
    );
    expect(reasoning?.detail).toBe(long);
    expect(reasoning?.detail).not.toContain("已截断");
  });

  it("同一输入重复构建时条目 key 稳定（否则展开态每帧被丢弃）", () => {
    const first = buildAgentTraceTurns([fullTurn()], "full", true)[0].entries.map((e) => e.key);
    const second = buildAgentTraceTurns([fullTurn()], "full", true)[0].entries.map((e) => e.key);
    expect(first).toEqual(second);
    expect(first).toContain("reason-1");
  });

  it("运行中断后思考不再标「思考中」（中断时 isFinal 永远不来）", () => {
    const interrupted = buildAgentTraceTurns(
      [group({ turn: 1, reasoning: "想了一半就断了" })],
      "standard",
      false,
    )[0].entries.find((e) => e.kind === "reasoning");

    expect(interrupted?.streaming).toBe(false);
    expect(interrupted?.label).toContain("思考过程");
    expect(interrupted?.label).not.toContain("思考中");
  });
});
