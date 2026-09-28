import { describe, expect, it } from "vitest";
import { buildAgentTraceTurns, pickTurnHeadlineEntry } from "./agentTraceTimeline";
import {
  applyAgentTraceViewPreset,
  createDefaultAgentTraceView,
  withTraceTransientPhases,
} from "./agentTraceView";
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
    // 逐条线性：3 条请求消息 → 3 个请求条目，保持原始顺序
    expect(turn.entries.map((entry) => entry.kind)).toEqual([
      "request",
      "request",
      "request",
      "response",
      "tool",
    ]);
    expect(turn.entries[0]?.label).toContain("帮我改这个文件");
    expect(turn.entries[1]?.label).toContain("上一轮回复");
    expect(turn.entries[2]?.label).toContain("发给模型");
    expect(turn.entries[2]?.label).toContain("最新的这条");
    expect(turn.entries[3]?.label).toContain("好的，我来修改");
    expect(turn.entries[4]?.label).toContain("src/a.ts");
  });

  it("系统提示词单独成条，不混进历史消息，且保持线性顺序", () => {
    const turns = buildAgentTraceTurns([
      group({
        turn: 1,
        request: {
          contextMessages: 3,
          contextChars: 900,
          messages: [
            { role: "system", content: "你是 AIALL 项目 Agent……" },
            { role: "user", content: "上一句" },
            { role: "user", content: "本轮这句" },
          ],
        },
      }),
    ]);

    const requests = turns[0]?.entries.filter((entry) => entry.kind === "request") ?? [];
    // 每条消息一个条目，顺序与 messages 一致（system 在最前）
    expect(requests).toHaveLength(3);
    expect(requests[0]?.label).toContain("系统提示词");
    expect(requests[0]?.detail).toContain("你是 AIALL 项目 Agent");
    // 历史不再把 system 算进去
    expect(requests[1]?.label).toContain("发给模型");
    expect(requests[1]?.label).not.toContain("系统提示词");
    expect(requests[2]?.label).toContain("本轮这句");
    expect(requests.map((entry) => entry.key)).toEqual([
      "req-1-0-system",
      "req-1-1-user",
      "req-1-2-user",
    ]);
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

  it("无正文的回复标签不再重复报「0 字符」，并给重复工具名去重计次", () => {
    const turns = buildAgentTraceTurns([
      group({
        turn: 1,
        response: {
          assistantText: "   ",
          toolCalls: [
            { id: "t1", name: "grep", arguments: "{}" },
            { id: "t2", name: "grep", arguments: "{}" },
            { id: "t3", name: "read_file", arguments: "{}" },
          ],
          hasToolCalls: true,
          isFinal: false,
        },
      }),
    ]);

    const label = turns[0]?.entries.find((entry) => entry.kind === "response")?.label ?? "";
    // 无正文时不出现「0 字符」与「（无正文）」叠在一起
    expect(label).not.toContain("0 字符");
    expect(label).toContain("（无正文）");
    // 同名工具合并成「×N」，不同名照常列出
    expect(label).toContain("grep ×2");
    expect(label).toContain("read_file");
    expect(label).not.toContain("grep、grep");
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
    const turns = buildAgentTraceTurns([group({ turn: 1, reasoning: "还在想" })], undefined, true);

    const reasoning = turns[0]?.entries[0];
    expect(reasoning?.kind).toBe("reasoning");
    expect(reasoning?.streaming).toBe(true);
    expect(reasoning?.label).toContain("思考中");
  });

  it("整轮结束后思考条目不再标「思考中」（中断时永远拿不到 isFinal 也不能挂着）", () => {
    // 运行中断的典型形态：有 reasoning、没有 response、isFinal 永远不会来
    const turns = buildAgentTraceTurns([group({ turn: 1, reasoning: "想了一半就断了" })], undefined, false);

    const reasoning = turns[0]?.entries[0];
    expect(reasoning?.kind).toBe("reasoning");
    expect(reasoning?.streaming).toBe(false);
    expect(reasoning?.label).toContain("思考过程");
    expect(reasoning?.label).not.toContain("思考中");
  });

  it("运行中只有最新一轮标「思考中」，调过工具的老轮次不再挂着", () => {
    // 回归：后端 isFinal = 「本轮没有工具调用」，所以调过工具的轮次 isFinal 恒为 false。
    // 曾用 `isRunning && !response.isFinal` 判定，导致第 1、2 轮早跑完了还永远显示「思考中」。
    const turns = buildAgentTraceTurns(
      [
        group({
          turn: 1,
          reasoning: "第一轮想了一下",
          response: { assistantText: "", toolCalls: [{ id: "t1", name: "grep", arguments: "{}" }], hasToolCalls: true, isFinal: false },
        }),
        group({
          turn: 2,
          reasoning: "第二轮还在想",
          response: { assistantText: "先读配置", toolCalls: [], hasToolCalls: false, isFinal: false },
        }),
      ],
      undefined,
      true,
    );

    const first = turns[0]?.entries.find((e) => e.kind === "reasoning");
    const second = turns[1]?.entries.find((e) => e.kind === "reasoning");
    // 老轮次：跑完了，不该再标流式
    expect(first?.streaming).toBe(false);
    expect(first?.label).toContain("思考过程");
    expect(first?.label).not.toContain("思考中");
    // 最新一轮：仍在产出，标流式
    expect(second?.streaming).toBe(true);
    expect(second?.label).toContain("思考中");
  });

  it("全折叠的预设下不默认展开任何条目，但条目仍然构建（点开还能看）", () => {
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
      applyAgentTraceViewPreset("brief"),
    );

    const entries = turns[0]?.entries ?? [];
    // 配置只管展开程度，不让条目消失
    expect(entries.every((entry) => !entry.expandedByDefault)).toBe(true);
    expect(entries.map((entry) => entry.kind)).toEqual(["reasoning", "response", "tool"]);
    // 折叠不等于没有内容
    expect(entries.every((entry) => entry.detail.trim().length > 0)).toBe(true);
  });

  it("瞬态阶段开关打开后保留已回复轮次里的 loop 阶段，默认关掉", () => {
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

    const standard = buildAgentTraceTurns(groups);
    expect(standard[0]?.entries.some((entry) => entry.kind === "phase")).toBe(false);

    const noisy = buildAgentTraceTurns(groups, withTraceTransientPhases(createDefaultAgentTraceView(), true));
    expect(noisy[0]?.entries.some((entry) => entry.kind === "phase")).toBe(true);
  });

  it("未回复的轮次在任何配置下都保留瞬态阶段（卡在哪一步的线索）", () => {
    const turns = buildAgentTraceTurns(
      [
        group({
          turn: 1,
          modelSteps: [
            { id: "s1", text: "正在压缩上下文…", phase: "compacting_context" },
          ],
        }),
      ],
      applyAgentTraceViewPreset("brief"),
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
      undefined,
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
      undefined,
    );

    const headline = pickTurnHeadlineEntry(turn!);
    expect(headline?.kind).toBe("tool");
    expect(headline?.label).toContain("src/a.ts");
  });

  it("整轮只有等待态时才用 phase（此时它确实是当前状态）", () => {
    const [turn] = buildAgentTraceTurns([group({ turn: 1, modelSteps: [waitStep("s1")] })]);

    const headline = pickTurnHeadlineEntry(turn!);
    expect(headline?.kind).toBe("phase");
    expect(headline?.label).toContain("正在等待模型响应");
  });
});