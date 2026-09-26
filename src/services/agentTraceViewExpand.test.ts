import { describe, expect, it } from "vitest";
import { buildAgentTraceTurns } from "./agentTraceTimeline";
import {
  AGENT_TRACE_ENTRY_KINDS,
  applyAgentTraceViewPreset,
  createDefaultAgentTraceView,
  withTraceBodyLength,
  withTraceExpand,
  withTraceTransientPhases,
  type AgentTraceViewConfig,
} from "./agentTraceView";
import type { AgentRoundGroup } from "./agentRoundGroups";

/**
 * 锁「显示配置 = 展开程度」这条契约：
 * 改配置**不改变条目集合**，只改变谁默认展开、正文多长。
 */
describe("轨迹显示配置 = 展开程度", () => {
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

  /**
   * 展开 / 正文长度的各种组合。
   *
   * 全部把 `transientPhases` 按成 false：那是唯一能改变条目集合的开关（本身是噪音开关），
   * 由下面那条单独的测试守着，这里只验「展开/截断怎么配都不让条目消失」。
   */
  function configs(): Array<[string, AgentTraceViewConfig]> {
    const base = createDefaultAgentTraceView();
    const allOn = AGENT_TRACE_ENTRY_KINDS.reduce((v, kind) => withTraceExpand(v, kind, true), base);
    return ([
      ["简略", applyAgentTraceViewPreset("brief")],
      ["标准（默认）", base],
      ["详细", applyAgentTraceViewPreset("detailed")],
      ["全量", applyAgentTraceViewPreset("full")],
      ["只开工具", withTraceExpand(base, "tool", true)],
      ["全关", withTraceExpand(base, "reasoning", false)],
      ["全开", allOn],
      ["全开+短正文", withTraceBodyLength(allOn, "short")],
    ] as Array<[string, AgentTraceViewConfig]>).map(([name, config]) => [
      name,
      withTraceTransientPhases(config, false),
    ]);
  }

  function kindsAt(config: AgentTraceViewConfig) {
    return buildAgentTraceTurns([fullTurn()], config, false)[0].entries.map((e) => e.kind);
  }

  it("条目集合不随配置变化（改配置不会让东西突然消失）", () => {
    const expected = kindsAt(createDefaultAgentTraceView());

    for (const [name, config] of configs()) {
      // 请求/思考/回复/工具在所有配置下都在场，顺序也稳定
      expect(kindsAt(config), `${name} 的条目集合与默认不一致`).toEqual(expected);
    }
  });

  it("瞬态阶段开关是唯一能改变条目集合的旋钮（它本来就是噪音开关）", () => {
    const base = createDefaultAgentTraceView();
    const quiet = kindsAt(base);
    const noisy = kindsAt(withTraceTransientPhases(base, true));

    // 唯一的差别就是已回复轮次里的瞬态阶段回来了，其余条目一模一样
    expect(noisy.filter((kind) => kind !== "phase")).toEqual(quiet.filter((kind) => kind !== "phase"));
    expect(noisy).toContain("phase");
    expect(quiet).not.toContain("phase");
  });

  it("配置只改变「谁默认展开」", () => {
    const expandedKindsAt = (config: AgentTraceViewConfig) => {
      const entries = buildAgentTraceTurns([fullTurn()], config, false)[0].entries;
      return [...new Set(entries.filter((e) => e.expandedByDefault).map((e) => e.kind))];
    };

    expect(expandedKindsAt(createDefaultAgentTraceView())).toEqual(["reasoning"]);
    expect(expandedKindsAt(withTraceExpand(createDefaultAgentTraceView(), "tool", true))).toEqual([
      "reasoning",
      "tool",
    ]);
    expect(expandedKindsAt(applyAgentTraceViewPreset("brief"))).toEqual([]);
    expect(expandedKindsAt(applyAgentTraceViewPreset("full"))).toContain("request");
    expect(expandedKindsAt(applyAgentTraceViewPreset("full"))).toContain("response");
  });

  it("默认配置下思考默认展开且正文就是思考原文", () => {
    const reasoning = buildAgentTraceTurns([fullTurn()], undefined, true)[0].entries.find(
      (e) => e.kind === "reasoning",
    );
    expect(reasoning?.expandedByDefault).toBe(true);
    expect(reasoning?.detail).toContain("先看看目录结构");
  });

  it("全部折叠的预设下正文仍然构建（点开还能看）", () => {
    const entries = buildAgentTraceTurns([fullTurn()], applyAgentTraceViewPreset("brief"), false)[0]
      .entries;
    expect(entries.every((e) => !e.expandedByDefault)).toBe(true);

    const reasoning = entries.find((e) => e.kind === "reasoning");
    expect(reasoning?.detail.trim().length).toBeGreaterThan(0);
  });

  it("不截断档不截断任何正文", () => {
    const long = "思考内容".repeat(500);
    const g = group({ turn: 1, reasoning: long });
    const reasoning = buildAgentTraceTurns([g], applyAgentTraceViewPreset("full"), false)[0].entries.find(
      (e) => e.kind === "reasoning",
    );
    expect(reasoning?.detail).toBe(long);
    expect(reasoning?.detail).not.toContain("已截断");
  });

  it("同一输入重复构建时条目 key 稳定（否则展开态每帧被丢弃）", () => {
    const view = applyAgentTraceViewPreset("full");
    const first = buildAgentTraceTurns([fullTurn()], view, true)[0].entries.map((e) => e.key);
    const second = buildAgentTraceTurns([fullTurn()], view, true)[0].entries.map((e) => e.key);
    expect(first).toEqual(second);
    expect(first).toContain("reason-1");
  });

  it("运行中断后思考不再标「思考中」（中断时 isFinal 永远不来）", () => {
    const interrupted = buildAgentTraceTurns(
      [group({ turn: 1, reasoning: "想了一半就断了" })],
      undefined,
      false,
    )[0].entries.find((e) => e.kind === "reasoning");

    expect(interrupted?.streaming).toBe(false);
    expect(interrupted?.label).toContain("思考过程");
    expect(interrupted?.label).not.toContain("思考中");
  });
});
