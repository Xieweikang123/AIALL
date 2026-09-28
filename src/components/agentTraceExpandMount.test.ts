// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createApp, h, nextTick } from "vue";

vi.mock("dompurify", () => ({
  default: { sanitize: (html: string) => html, addHook: vi.fn() },
}));

import AgentTracePanel from "./AgentTracePanel.vue";
import { __resetAgentTraceDrawerForTest } from "../services/agentTraceDrawer";
import type { AgentRoundGroupView } from "../services/agentRoundGroups";

function group(turn: number): AgentRoundGroupView {
  return {
    turn,
    modelSteps: [],
    toolIds: [],
    reasoning: `思考 ${turn}`,
    request: {
      contextMessages: 2,
      contextChars: 100,
      messages: [
        { role: "system", content: `系统提示词 ${turn}` },
        { role: "user", content: `用户消息 ${turn}` },
      ],
    },
    response: {
      assistantText: `回复 ${turn}`,
      toolCalls: [],
      hasToolCalls: false,
      isFinal: true,
    },
    tools: [],
  };
}

function mountPanel(groups: AgentRoundGroupView[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(AgentTracePanel, { roundGroups: groups, tools: [], embedded: true }),
  });
  app.mount(host);
  return { host, app };
}

describe("AgentTracePanel 展开态跨卸载", () => {
  beforeEach(() => {
    __resetAgentTraceDrawerForTest();
  });

  it("折叠某轮后卸载再挂载，仍保持折叠", async () => {
    const groups = [group(1), group(2), group(3)];
    const first = mountPanel(groups);
    await nextTick();

    const turnHeads = first.host.querySelectorAll(".agent-trace-turn-head");
    expect(turnHeads.length).toBe(3);
    // 默认展开最新一轮（第 3 轮）
    const turn3 = first.host.querySelectorAll(".agent-trace-turn")[2] as HTMLElement;
    expect(turn3.className).not.toContain("collapsed");

    // 手动折叠第 3 轮
    (turnHeads[2] as HTMLElement).click();
    await nextTick();
    expect((first.host.querySelectorAll(".agent-trace-turn")[2] as HTMLElement).className).toContain(
      "collapsed",
    );

    first.app.unmount();
    await nextTick();

    const second = mountPanel(groups);
    await nextTick();
    const remountedTurn3 = second.host.querySelectorAll(".agent-trace-turn")[2] as HTMLElement;
    expect(remountedTurn3.className).toContain("collapsed");
  });

  it("展开某条历史轮次后卸载再挂载，仍保持展开", async () => {
    const groups = [group(1), group(2), group(3)];
    const first = mountPanel(groups);
    await nextTick();

    // 展开第 1 轮
    (first.host.querySelectorAll(".agent-trace-turn-head")[0] as HTMLElement).click();
    await nextTick();
    expect(
      (first.host.querySelectorAll(".agent-trace-turn")[0] as HTMLElement).className,
    ).not.toContain("collapsed");

    first.app.unmount();
    await nextTick();

    const second = mountPanel(groups);
    await nextTick();
    expect(
      (second.host.querySelectorAll(".agent-trace-turn")[0] as HTMLElement).className,
    ).not.toContain("collapsed");
  });

  it("展开某条「系统提示词」后卸载再挂载，该条仍展开", async () => {
    const groups = [group(1)];
    const first = mountPanel(groups);
    await nextTick();

    // 第 1 条应是 system（系统提示词）
    const rows = first.host.querySelectorAll(".agent-trace-row");
    expect((rows[0] as HTMLElement).textContent).toContain("系统提示词");
    expect(
      (first.host.querySelectorAll(".agent-trace-entry")[0] as HTMLElement).className,
    ).not.toContain("expanded");

    (rows[0] as HTMLElement).click();
    await nextTick();
    expect(
      (first.host.querySelectorAll(".agent-trace-entry")[0] as HTMLElement).className,
    ).toContain("expanded");

    first.app.unmount();
    await nextTick();

    const second = mountPanel(groups);
    await nextTick();
    expect(
      (second.host.querySelectorAll(".agent-trace-entry")[0] as HTMLElement).className,
    ).toContain("expanded");
  });
});
