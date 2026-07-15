import { describe, expect, it } from "vitest";
import {
  buildAgentRoundGroupViews,
  recordAgentRoundNarrative,
  recordAgentRoundRequest,
  recordAgentRoundResponse,
  recordAgentRoundStreamDelta,
  recordAgentRoundStatus,
  recordAgentRoundToolStart,
  resetAgentRoundGroupIds,
} from "./agentRoundGroups";

describe("agentRoundGroups", () => {
  it("groups model phases under the same turn", () => {
    resetAgentRoundGroupIds();
    let groups = recordAgentRoundStatus(undefined, "compacting_context", "正在整理上下文… · 48 条", 3);
    groups = recordAgentRoundStatus(groups, "sending_request", "正在发送模型请求… · 正在发送请求", 3);
    groups = recordAgentRoundStatus(groups, "waiting_model", "正在等待模型响应（第 3 轮）… · 等待首包 · 3s", 3);

    expect(groups).toHaveLength(1);
    expect(groups[0].turn).toBe(3);
    expect(groups[0].modelSteps).toHaveLength(3);
    expect(groups[0].modelSteps[2].phase).toBe("waiting_model");
  });

  it("updates the latest step when phase stays the same", () => {
    resetAgentRoundGroupIds();
    let groups = recordAgentRoundStatus(undefined, "waiting_model", "正在等待模型响应… · 3s", 2);
    groups = recordAgentRoundStatus(groups, "waiting_model", "正在等待模型响应… · 8s", 2);
    expect(groups[0].modelSteps).toHaveLength(1);
    expect(groups[0].modelSteps[0].text).toContain("8s");
  });

  it("attaches narrative, model steps, and tools to one round view", () => {
    resetAgentRoundGroupIds();
    let groups = recordAgentRoundStatus(undefined, "compacting_context", "正在整理上下文…", 1);
    groups = recordAgentRoundNarrative(groups, 1, "让我看看 VibeCodingView 中发送消息的逻辑");
    groups = recordAgentRoundToolStart(groups, "tool-1", 1);

    const views = buildAgentRoundGroupViews({
      roundGroups: groups,
      tools: [{
        id: "tool-1",
        turn: 1,
        name: "grep",
        icon: "🔎",
        title: "搜索内容",
        detail: "runVibeAgent",
        label: "搜索内容",
        summary: "找到 3 处匹配",
        ok: true,
      }],
      activeTurn: 1,
      activePhase: "waiting_model",
    });

    expect(views[0].narrative).toContain("VibeCodingView");
    expect(views[0].modelSteps).toHaveLength(1);
    expect(views[0].tools).toHaveLength(1);
  });

  it("stores request and response details on a round group", () => {
    resetAgentRoundGroupIds();
    let groups = recordAgentRoundRequest(undefined, 2, {
      model: "mimo-v2.5-pro",
      contextMessages: 48,
      contextChars: 98000,
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
    }, 20);
    groups = recordAgentRoundResponse(groups, 2, {
      assistantText: "让我看看 VibeCodingView",
      toolCalls: [{ id: "1", name: "grep", arguments: "{\"pattern\":\"runVibe\"}" }],
      hasToolCalls: true,
      isFinal: false,
    }, 20);

    expect(groups[0].request?.contextMessages).toBe(48);
    expect(groups[0].request?.messages).toEqual([
      { role: "system", content: "2 条消息，98000 字符" },
    ]);
    expect(groups[0].response?.toolCalls).toHaveLength(1);
    expect(groups[0].narrative).toContain("VibeCodingView");
  });

  it("ignores missing narrative without throwing", () => {
    resetAgentRoundGroupIds();
    let groups = recordAgentRoundStatus(undefined, "waiting_model", "等待模型", 1);
    groups = recordAgentRoundNarrative(groups, 1, undefined);
    expect(groups[0].narrative).toBeUndefined();
  });

  it("keeps longer streamed narrative when turn_response is shorter", () => {
    resetAgentRoundGroupIds();
    let groups = recordAgentRoundStreamDelta(undefined, 2, "这是一段较长的流式输出内容，用于验证不会被更短的响应覆盖。", 20);
    groups = recordAgentRoundResponse(groups, 2, {
      assistantText: "这是一段较长的流式",
      toolCalls: [],
      hasToolCalls: false,
      isFinal: false,
    }, 20);

    expect(groups[0].narrative).toContain("用于验证不会被更短的响应覆盖");
  });
});
