import { describe, expect, it } from "vitest";
import { buildAgentTraceTurns, pickTurnHeadlineEntry } from "./agentTraceTimeline";
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
      "response",
      "tool",
    ]);
    expect(turn.entries[1]?.label).toContain("发给模型");
    expect(turn.entries[1]?.label).toContain("最新的这条");
    expect(turn.entries[0]?.label).toContain("2 条历史消息");
    expect(turn.entries[2]?.label).toContain("好的，我来修改");
    expect(turn.entries[3]?.label).toContain("src/a.ts");
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

  it("把思考过程提升为独立条目，不再塞进回复正文", () => {
    const turns = buildAgentTraceTurns([
      group({
        turn: 1,
        reasoning: "先看看目录结构，再决定改哪个文件",
        response: {
          assistantText: "好的。",
          toolCalls: [],
          hasToolCalls: false,
          isFinal: true,
        },
      }),
    ]);

    const kinds = turns[0]?.entries.map((entry) => entry.kind) ?? [];
    // 思考排在回复之前：它发生在模型产出回复之前
    expect(kinds).toEqual(["reasoning", "response"]);

    const reasoning = turns[0]?.entries.find((entry) => entry.kind === "reasoning");
    expect(reasoning?.detail).toContain("先看看目录结构");
    expect(reasoning?.chars).toBe("先看看目录结构，再决定改哪个文件".length);
    expect(reasoning?.streaming).toBe(false);

    // 回复正文里不应再重复思考文本
    const response = turns[0]?.entries.find((entry) => entry.kind === "response");
    expect(response?.detail).not.toContain("先看看目录结构");
  });

  it("运行中、本轮未定稿时思考条目标记为流式中", () => {
    const turns = buildAgentTraceTurns([group({ turn: 1, reasoning: "还在想" })], "standard", true);

    const reasoning = turns[0]?.entries[0];
    expect(reasoning?.kind).toBe("reasoning");
    expect(reasoning?.streaming).toBe(true);
    expect(reasoning?.label).toContain("思考中");
  });

  it("整轮结束后思考条目不再标「思考中」（中断时永远拿不到 isFinal 也不能挂着）", () => {
    // 运行中断的典型形态：有 reasoning、没有 response、isFinal 永远不会来
    const turns = buildAgentTraceTurns([group({ turn: 1, reasoning: "想了一半就断了" })], "standard", false);

    const reasoning = turns[0]?.entries[0];
    expect(reasoning?.kind).toBe("reasoning");
    expect(reasoning?.streaming).toBe(false);
    expect(reasoning?.label).toContain("思考过程");
    expect(reasoning?.label).not.toContain("思考中");
  });

  it("简略档不默认展开任何条目，但条目仍然构建（点开还能看）", () => {
    const turns = buildAgentTraceTurns(
      [
        group({
          turn: 1,
          reasoning: "很长的一段思考".repeat(100),
          response: {
            assistantText: "结论",
            toolCalls: [],
            hasToolCalls: false,
            isFinal: true,
          },
          toolIds: ["t1"],
          tools: [
            {
              id: "t1",
              name: "grep",
              icon: "🔍",
              title: "搜索",
              detail: "pattern",
              label: "搜索",
              summary: "命中 3 处",
              ok: true,
            },
          ],
        }),
      ],
      "brief",
    );

    const entries = turns[0]?.entries ?? [];
    // 档位只管展开程度，不再让条目消失
    expect(entries.every((entry) => !entry.expandedByDefault)).toBe(true);
    expect(entries.map((entry) => entry.kind)).toEqual(["reasoning", "response", "tool"]);
    // 折叠不等于没有内容
    expect(entries.every((entry) => entry.detail.trim().length > 0)).toBe(true);
  });

  it("详细档保留已回复轮次里的瞬态 loop 阶段，标准档过滤掉", () => {
    const groups = [
      group({
        turn: 1,
        modelSteps: [
          { id: "s1", text: "正在压缩上下文…", phase: "compacting_context" },
        ],
        response: {
          assistantText: "回复",
          toolCalls: [],
          hasToolCalls: false,
          isFinal: false,
        },
      }),
    ];

    const standard = buildAgentTraceTurns(groups, "standard");
    expect(standard[0]?.entries.some((entry) => entry.kind === "phase")).toBe(false);

    const detailed = buildAgentTraceTurns(groups, "detailed");
    expect(detailed[0]?.entries.some((entry) => entry.kind === "phase")).toBe(true);
  });

  it("未回复的轮次在任何档位都保留瞬态阶段（卡在哪一步的线索）", () => {
    const turns = buildAgentTraceTurns(
      [
        group({
          turn: 1,
          modelSteps: [
            { id: "s1", text: "正在压缩上下文…", phase: "compacting_context" },
          ],
        }),
      ],
      "standard",
    );

    expect(turns[0]?.entries.some((entry) => entry.kind === "phase")).toBe(true);
  });
});

describe("pickTurnHeadlineEntry", () => {
  const waitStep = (id: string): AgentRoundGroupView["modelSteps"][number] => ({
    id,
    text: "正在等待模型响应（第 3/24 轮 · m）…",
    phase: "waiting_model",
  });

  it("已回复的轮次取回复条目，不取末尾那条过时的等待快照", () => {
    // 回归：折叠行曾永远显示「正在等待模型响应」，看着像每轮都卡住
    const [turn] = buildAgentTraceTurns(
      [
        group({
          turn: 1,
          modelSteps: [waitStep("s1")],
          request: {
            model: "m",
            contextMessages: 1,
            contextChars: 10,
            messages: [{ role: "system", content: "上下文" }],
          },
          response: {
            assistantText: "改完了",
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        }),
      ],
      "detailed",
    );

    const headline = pickTurnHeadlineEntry(turn!);
    expect(headline?.kind).toBe("response");
    expect(headline?.label).toContain("改完了");
    expect(headline?.label).not.toContain("正在等待模型响应");
  });

  it("未回复但已在跑工具时取最后一个动作，不显示等待态", () => {
    const [turn] = buildAgentTraceTurns(
      [
        group({
          turn: 1,
          modelSteps: [waitStep("s1")],
          request: {
            model: "m",
            contextMessages: 1,
            contextChars: 10,
            messages: [{ role: "system", content: "上下文" }],
          },
          toolIds: ["t1"],
          tools: [
            {
              id: "t1",
              name: "read_file",
              icon: "📖",
              title: "读文件",
              detail: "src/a.ts",
              label: "读文件",
              summary: "",
              running: true,
            },
          ],
        }),
      ],
      "detailed",
    );

    const headline = pickTurnHeadlineEntry(turn!);
    expect(headline?.kind).toBe("tool");
    expect(headline?.label).toContain("src/a.ts");
  });

  it("整轮只有等待态时才用 phase（此时它确实是当前状态）", () => {
    const [turn] = buildAgentTraceTurns([group({ turn: 1, modelSteps: [waitStep("s1")] })], "detailed");

    const headline = pickTurnHeadlineEntry(turn!);
    expect(headline?.kind).toBe("phase");
    expect(headline?.label).toContain("正在等待模型响应");
  });
});