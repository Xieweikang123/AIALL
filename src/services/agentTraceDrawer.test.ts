import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetAgentTraceDrawerForTest,
  closeTraceDrawer,
  notifyTraceRunStarted,
  openLatestTraceDrawer,
  openTraceDrawer,
  registerLatestTrace,
  resolveTraceRoundGroups,
  resolveTraceTools,
  setTraceAutoEnabled,
  setTraceDetail,
  setTraceGroupResolver,
  setTraceToolsResolver,
  useAgentTraceDrawerState,
} from "./agentTraceDrawer";
import type { AgentRoundGroup } from "./agentRoundGroups";

function group(turn: number, narrative: string): AgentRoundGroup {
  return { turn, narrative, modelSteps: [], toolIds: [] };
}

describe("agentTraceDrawer", () => {
  beforeEach(() => {
    __resetAgentTraceDrawerForTest();
  });

  it("默认不打开，详细度为标准档，自动展开开启", () => {
    const state = useAgentTraceDrawerState();
    expect(state.open).toBe(false);
    expect(state.detail).toBe("standard");
    expect(state.autoEnabled).toBe(true);
  });

  it("打开后按 messageId 实时取数，而不是打开那一刻的快照", () => {
    // 模拟消息的 roundGroups 被整体替换（recordAgentRound* 每次都会换新数组）
    let live = [group(1, "第一轮")];
    setTraceGroupResolver((id) => (id === "m1" ? live : []));

    openTraceDrawer("m1", live);
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["第一轮"]);

    // 运行中追加了一轮 —— 抽屉必须看到新数据
    live = [group(1, "第一轮"), group(2, "第二轮")];
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["第一轮", "第二轮"]);
  });

  it("未打开时也能解析最新注册的消息（工具栏入口用）", () => {
    setTraceGroupResolver((id) => (id === "m9" ? [group(1, "内容")] : []));
    registerLatestTrace("m9", [group(1, "内容")]);

    expect(resolveTraceRoundGroups()).toHaveLength(1);
  });

  it("查找函数抛错时不炸抽屉，退化成空轨迹", () => {
    setTraceGroupResolver(() => {
      throw new Error("boom");
    });
    registerLatestTrace("m1", []);

    expect(resolveTraceRoundGroups()).toEqual([]);
  });

  it("思考开始会自动弹出并指向该消息", () => {
    setTraceGroupResolver((id) => (id === "m1" ? [group(1, "思考中")] : []));

    notifyTraceRunStarted("m1");

    const state = useAgentTraceDrawerState();
    expect(state.open).toBe(true);
    expect(state.messageId).toBe("m1");
    expect(resolveTraceRoundGroups()).toHaveLength(1);
  });

  it("关掉自动展开后，思考开始不再自动弹出", () => {
    notifyTraceRunStarted("m1");
    closeTraceDrawer();
    setTraceAutoEnabled(false);

    notifyTraceRunStarted("m2");

    expect(useAgentTraceDrawerState().open).toBe(false);
  });

  it("自动弹出不会抢走用户已经打开的其他消息", () => {
    openTraceDrawer("m-old", [group(1, "旧轨迹")]);

    notifyTraceRunStarted("m-new");

    expect(useAgentTraceDrawerState().messageId).toBe("m-old");
  });

  it("切换详细度会归一化非法值", () => {
    setTraceDetail("detailed");
    expect(useAgentTraceDrawerState().detail).toBe("detailed");

    setTraceDetail("bogus" as never);
    expect(useAgentTraceDrawerState().detail).toBe("standard");
  });

  it("openLatestTraceDrawer 在无注册消息时给出空轨迹而不抛错", () => {
    openLatestTraceDrawer();

    expect(useAgentTraceDrawerState().open).toBe(true);
    expect(resolveTraceRoundGroups()).toEqual([]);
  });

  it("锁定的消息已失效时回退到最新消息（实测踩过的空轨迹根因）", () => {
    // 复现日志里的形态：抽屉锁着一个已不存在的旧 id，真正的最新消息在别处
    setTraceGroupResolver((id) => (id === "new-msg" ? [group(1, "真实轨迹")] : []));
    setTraceToolsResolver((id) => (id === "new-msg" ? [{ id: "t1" } as never] : []));

    // 旧 id 先被锁定（比如之前点过那条消息）
    openTraceDrawer("stale-msg", []);
    registerLatestTrace("new-msg", [group(1, "真实轨迹")]);

    // 不应因为锁着失效 id 就恒为空
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["真实轨迹"]);
    // 锁被打开后，工具表也跟随同一个有效 id
    expect(resolveTraceTools()).toHaveLength(1);
  });

  it("锁定 id 有效时仍然优先用它（显式点某条消息不被最新消息抢走）", () => {
    setTraceGroupResolver((id) =>
      id === "old-msg" ? [group(1, "旧轨迹")] : id === "new-msg" ? [group(1, "新轨迹")] : [],
    );
    registerLatestTrace("new-msg", [group(1, "新轨迹")]);
    openTraceDrawer("old-msg", [group(1, "旧轨迹")]);

    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["旧轨迹"]);
  });

  it("回退后不再反复查询失效 id（避免每帧白查）", () => {
    const seen: Array<string | null> = [];
    setTraceGroupResolver((id) => {
      seen.push(id);
      return id === "new-msg" ? [group(1, "真实轨迹")] : [];
    });
    openTraceDrawer("stale-msg", []);
    registerLatestTrace("new-msg", []);

    resolveTraceRoundGroups();
    seen.length = 0;
    resolveTraceRoundGroups();

    // 第二次只应该查有效 id，不再碰失效的那个
    expect(seen).toEqual(["new-msg"]);
  });
});
