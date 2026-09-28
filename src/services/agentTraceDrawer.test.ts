import { beforeEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import {
  __resetAgentTraceDrawerForTest,
  closeTraceDrawer,
  collapseTraceForEditor,
  notifyTraceRunStarted,
  openLatestTraceDrawer,
  openTraceDrawer,
  registerLatestTrace,
  resolveTraceRoundGroups,
  resolveTraceTools,
  restoreTraceAfterEditor,
  setTraceActiveSessionResolver,
  setTraceAutoEnabled,
  setTraceEditorSpaceResolver,
  setTraceGroupResolver,
  setTraceMaximized,
  setTraceMessageExistsResolver,
  setTraceToolsResolver,
  setTraceView,
  syncTraceScopeToActiveSession,
  useAgentTraceDrawerState,
} from "./agentTraceDrawer";
import { createDefaultAgentTraceView, withTraceAutoMaximize, withTraceExpand } from "./agentTraceView";
import type { AgentRoundGroup } from "./agentRoundGroups";

function group(turn: number, narrative: string): AgentRoundGroup {
  return { turn, narrative, modelSteps: [], toolIds: [] };
}

describe("agentTraceDrawer", () => {
  beforeEach(() => {
    __resetAgentTraceDrawerForTest();
  });

  it("默认不打开，显示配置为默认档（只展开思考），自动展开开启", () => {
    const state = useAgentTraceDrawerState();
    expect(state.open).toBe(false);
    expect(state.view).toEqual(createDefaultAgentTraceView());
    expect(state.view.expand.reasoning).toBe(true);
    expect(state.view.expand.tool).toBe(false);
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

  it("面板还开着时，新一轮开始要跟过去（回归：不跟就永远停在上一轮）", () => {
    // 抽屉跑完一轮不自动收起（设计如此）。上一轮锁着 m1，新一轮跑起来时
    // 若不换锁，m1 仍能解析出数据 → 不回退 → 面板永远显示上一轮轨迹
    setTraceGroupResolver((id) =>
      id === "m1" ? [group(1, "上一轮")] : id === "m2" ? [group(1, "新一轮")] : [],
    );

    notifyTraceRunStarted("m1");
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["上一轮"]);

    notifyTraceRunStarted("m2");

    expect(useAgentTraceDrawerState().open).toBe(true);
    expect(useAgentTraceDrawerState().messageId).toBe("m2");
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["新一轮"]);
  });

  it("用户点消息入口锁定的那条，新一轮也不抢（锁定语义）", () => {
    setTraceGroupResolver((id) =>
      id === "m-old" ? [group(1, "用户在看的老轨迹")] : id === "m-new" ? [group(1, "新轨迹")] : [],
    );

    openTraceDrawer("m-old", [group(1, "用户在看的老轨迹")]);
    notifyTraceRunStarted("m-new");

    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["用户在看的老轨迹"]);
  });

  it("锁定消息失效后不再挡着新一轮的跟随", () => {
    setTraceGroupResolver((id) => (id === "m-new" ? [group(1, "新轨迹")] : []));
    // "m-dead 已不在消息表里" —— 失效必须由存在性查询明说，不能靠"没数据"推断
    setTraceMessageExistsResolver((id) => id === "m-new");
    openTraceDrawer("m-dead", []);
    registerLatestTrace("m-new", [group(1, "新轨迹")]);

    // 失效锁在同会话内回退到最新一条
    expect(resolveTraceRoundGroups()).toHaveLength(1);

    // 失效的**显式锁定**不再挡着新一轮跟随；`notifyTraceRunStarted` 会识别出
    // 那条锁定**已不在消息表里**（存在性查询说 false）→ 自动作废它，然后把锁跟到新 id。
    notifyTraceRunStarted("m-new");
    expect(useAgentTraceDrawerState().messageId).toBe("m-new");
  });

  it("openLatestTraceDrawer 是跟随语义，不算显式锁定", () => {
    setTraceGroupResolver((id) => (id === "m1" ? [group(1, "老轨迹")] : []));
    openTraceDrawer("m1", [group(1, "老轨迹")]);

    openLatestTraceDrawer();
    notifyTraceRunStarted("m2");

    expect(useAgentTraceDrawerState().messageId).toBe("m2");
  });

  it("改显示配置会归一化脏值（外部传旧档位字符串也不能把面板搞坏）", () => {
    // 正交开关：只动工具，其余类型不受影响
    setTraceView(withTraceExpand(createDefaultAgentTraceView(), "tool", true));
    const view = useAgentTraceDrawerState().view;
    expect(view.expand.tool).toBe(true);
    expect(view.expand.reasoning).toBe(true);
    expect(view.expand.request).toBe(false);

    // 旧档位字符串仍被接住（映射到同名预设）
    setTraceView("detailed" as never);
    expect(useAgentTraceDrawerState().view.expand.tool).toBe(true);
    expect(useAgentTraceDrawerState().view.transientPhases).toBe(true);

    // 完全非法的值回落默认配置
    setTraceView("bogus" as never);
    expect(useAgentTraceDrawerState().view).toEqual(createDefaultAgentTraceView());
  });

  it("openLatestTraceDrawer 在无注册消息时给出空轨迹而不抛错", () => {
    openLatestTraceDrawer();
    expect(useAgentTraceDrawerState().open).toBe(true);
    expect(resolveTraceRoundGroups()).toEqual([]);
  });

  it("手动放大 / 还原只改尺寸，不动开合与消息锁", () => {
    setTraceGroupResolver((id) => (id === "m1" ? [group(1, "轨迹")] : []));
    openTraceDrawer("m1", [group(1, "轨迹")]);

    setTraceMaximized(true);
    expect(useAgentTraceDrawerState().maximized).toBe(true);
    expect(useAgentTraceDrawerState().open).toBe(true);
    expect(useAgentTraceDrawerState().messageId).toBe("m1");

    setTraceMaximized(false);
    expect(useAgentTraceDrawerState().maximized).toBe(false);
    expect(useAgentTraceDrawerState().open).toBe(true);
    expect(useAgentTraceDrawerState().messageId).toBe("m1");
  });

  it("开启「思考时自动放大」后，跑起来自动放大；默认不放大", () => {
    setTraceGroupResolver((id) => (id === "m1" ? [group(1, "轨迹")] : []));

    // 默认配置：自动弹出但不放大
    notifyTraceRunStarted("m1");
    expect(useAgentTraceDrawerState().open).toBe(true);
    expect(useAgentTraceDrawerState().maximized).toBe(false);

    closeTraceDrawer();
    setTraceView(withTraceAutoMaximize(createDefaultAgentTraceView(), true));
    notifyTraceRunStarted("m2");

    expect(useAgentTraceDrawerState().maximized).toBe(true);
  });

  it("关掉「自动打开」时不做自动放大（面板都不弹，更不需要放大）", () => {
    setTraceView(withTraceAutoMaximize(createDefaultAgentTraceView(), true));
    setTraceAutoEnabled(false);

    notifyTraceRunStarted("m1");

    expect(useAgentTraceDrawerState().open).toBe(false);
    expect(useAgentTraceDrawerState().maximized).toBe(false);
  });

  it("锁定的消息已失效时回退到最新消息（实测踩过的空轨迹根因）", () => {
    // 复现日志里的形态：抽屉锁着一个已不存在的旧 id，真正的最新消息在别处
    setTraceGroupResolver((id) => (id === "new-msg" ? [group(1, "真实轨迹")] : []));
    setTraceToolsResolver((id) => (id === "new-msg" ? [{ id: "t1" } as never] : []));
    // 「stale-msg 已不在消息表里」—— 失效必须由存在性查询明说，不能靠"没数据"推断
    setTraceMessageExistsResolver((id) => id === "new-msg");

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

  it("失效 id 只回退，不会把同会话最新消息也带偏", () => {
    const seen: Array<string | null> = [];
    setTraceGroupResolver((id) => {
      seen.push(id);
      return id === "new-msg" ? [group(1, "真实轨迹")] : [];
    });
    setTraceMessageExistsResolver((id) => id === "new-msg");
    openTraceDrawer("stale-msg", []);
    registerLatestTrace("new-msg", []);

    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["真实轨迹"]);
    expect(seen).toContain("stale-msg");
    expect(seen).toContain("new-msg");

    // 反复求值结果稳定 —— 失效判定是实时重算的，不会"第二次就变了"
    seen.length = 0;
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["真实轨迹"]);
    expect(seen).toContain("new-msg");
  });

  /**
   * 反面契约：**瞬时假阴性不能锁死面板**。
   *
   * 曾经的 `deadLock*` 缓存把一次"查不到"永久记住，从此不再回头查 —— 存在性查询只要
   * 给一次假阴性（会话消息表尚未 hydrate 很常见），正在看的轨迹就被判死且永不恢复，
   * 而回退分支又排除 `fallbackId === locked`，结果是 groups / tools 双双为空。
   * 现在失效判定每次实时重算，所以"一次说不在、随后又在"必须能自动恢复。
   *
   * 关键：假阴性期间分组数据必须是**空**的，否则会走"有数据就直接返回"的短路分支，
   * 根本测不到存在性判定这条路（那样这条用例就是废的）。
   */
  it("存在性查询一次假阴性后恢复，面板必须能自动跟上", () => {
    let exists = false;   // 先假装消息不在（瞬时误判）
    let hasData = false;  // 且此时确实还没有数据 —— 必须走存在性判定
    setTraceGroupResolver((id) => (id === "m1" && hasData ? [group(1, "轨迹")] : []));
    setTraceMessageExistsResolver((id) => (id === "m1" ? exists : false));

    notifyTraceRunStarted("m1");
    // 误判期间为空，这不重要 —— 重要的是不能永久卡住。
    // 多求值几次：旧实现会在这一刻把 m1 记进失效缓存。
    expect(resolveTraceRoundGroups()).toEqual([]);
    expect(resolveTraceRoundGroups()).toEqual([]);

    // 消息其实一直在（会话消息表 hydrate 完），而且数据也长出来了 → 必须重新显示
    exists = true;
    hasData = true;
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["轨迹"]);
  });

  /**
   * 假阴性只影响**那一帧**：即便缓存曾把 id 判死，消息回来后也必须能重新解析出它，
   * 而不是像旧实现那样"第二次起跳过 resolver、永不回头"。
   */
  it("假阴性期间也不该把锁永久判死（恢复后仍是同一条消息）", () => {
    let exists = false;
    setTraceGroupResolver((id) => (id === "m1" ? [group(1, "轨迹")] : []));
    setTraceMessageExistsResolver((id) => (id === "m1" ? exists : false));

    notifyTraceRunStarted("m1");
    resolveTraceRoundGroups();

    exists = true;
    // 数据一直在，只是存在性查询一度说谎 —— 锁不该被换掉
    expect(useAgentTraceDrawerState().messageId).toBe("m1");
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["轨迹"]);
  });
});

describe("agentTraceDrawer 编辑器让位", () => {
  beforeEach(() => {
    __resetAgentTraceDrawerForTest();
    setTraceGroupResolver((id) => (id === "msg-1" ? [group(1, "轨迹")] : []));
    registerLatestTrace("msg-1", []);
  });

  it("打开文件时收起面板，编辑器让开后自动恢复", () => {
    openLatestTraceDrawer();
    expect(useAgentTraceDrawerState().open).toBe(true);

    collapseTraceForEditor();
    expect(useAgentTraceDrawerState().open).toBe(false);

    restoreTraceAfterEditor();
    expect(useAgentTraceDrawerState().open).toBe(true);
  });

  it("让位只收面板，不丢消息锁（恢复后还是原来那条）", () => {
    openTraceDrawer("msg-1", []);
    collapseTraceForEditor();
    restoreTraceAfterEditor();

    // 锁还在，所以解析得到原来那条的轨迹，而不是回退到"最新"
    expect(resolveTraceRoundGroups()).toEqual([group(1, "轨迹")]);
  });

  it("用户主动关闭的，编辑器让开也不该自动弹回来", () => {
    openLatestTraceDrawer();
    closeTraceDrawer();

    restoreTraceAfterEditor();
    expect(useAgentTraceDrawerState().open).toBe(false);
  });

  it("面板本来就关着时不算让位，也不该被恢复弹开", () => {
    expect(useAgentTraceDrawerState().open).toBe(false);

    expect(collapseTraceForEditor()).toBe(false);

    restoreTraceAfterEditor();
    expect(useAgentTraceDrawerState().open).toBe(false);
  });

  it("让位期间用户自己又把面板打开了，恢复时不重复处理", () => {
    openLatestTraceDrawer();
    collapseTraceForEditor();
    // 让位期间用户从工具栏重新打开
    openLatestTraceDrawer();

    restoreTraceAfterEditor();
    expect(useAgentTraceDrawerState().open).toBe(true);
  });

  it("编辑器占位时 Agent 开跑不弹面板，但锁已指向新一轮", () => {
    setTraceEditorSpaceResolver(() => true);
    registerLatestTrace("msg-2", []);
    setTraceGroupResolver((id) => (id === "msg-2" ? [group(2, "新一轮")] : []));

    notifyTraceRunStarted("msg-2");

    // 没弹出来抢编辑器宽度
    expect(useAgentTraceDrawerState().open).toBe(false);
    // 但编辑器让开后恢复的是**这一轮**，不是旧的
    restoreTraceAfterEditor();
    expect(useAgentTraceDrawerState().open).toBe(true);
    expect(resolveTraceRoundGroups()).toEqual([group(2, "新一轮")]);
  });

  it("编辑器没占位时自动弹出照常", () => {
    setTraceEditorSpaceResolver(() => false);
    notifyTraceRunStarted("msg-1");
    expect(useAgentTraceDrawerState().open).toBe(true);
  });

  it("用户主动关掉后，Agent 开跑不弹回来（无视用户指令是 bug）", () => {
    setTraceEditorSpaceResolver(() => false);
    openLatestTraceDrawer();
    closeTraceDrawer();

    notifyTraceRunStarted("msg-1");

    expect(useAgentTraceDrawerState().open).toBe(false);
  });

  it("用户重新点开面板后，自动弹出恢复（撤销别再烦我）", () => {
    openLatestTraceDrawer();
    closeTraceDrawer();
    // 用户反悔了，自己点开消息入口
    openTraceDrawer("msg-1", []);
    closeTraceDrawer();

    // 注意：最后一步又关了，所以仍处于"别再烦我"
    expect(useAgentTraceDrawerState().userDismissedAuto).toBe(true);

    // 再来一次：点开 → 不关 → 下一轮应该能自动弹
    openTraceDrawer("msg-1", []);
    expect(useAgentTraceDrawerState().userDismissedAuto).toBe(false);
  });
});

/**
 * 两个会话同时跑的回归组。
 *
 * bug 现象：轨迹面板闪烁（内容在两个会话之间来回跳）。
 * 根因：抽屉是全应用单例，而"最新消息 id"曾是**单个全局变量**、解析又只查
 * 当前激活会话 —— 两个会话交替注册/解析就互相覆盖，`find` 反复失败再回退。
 * 修复后：目标带会话维度，且回退限定在**同一会话内**，跨会话不再串台。
 */
describe("agentTraceDrawer 双会话隔离（闪烁回归）", () => {
  beforeEach(() => {
    __resetAgentTraceDrawerForTest();
  });

  /** 模拟主视图：按会话 id 去对应会话的消息表里查。 */
  function installTwoSessions() {
    const byId: Record<string, Array<{ id: string; groups: AgentRoundGroup[] }>> = {
      A: [{ id: "a-1", groups: [group(1, "A 的轨迹")] }],
      B: [{ id: "b-1", groups: [group(1, "B 的轨迹")] }],
    };
    const seen: Array<[string | null, string | null]> = [];
    setTraceGroupResolver((id, sid) => {
      seen.push([id, sid ?? null]);
      if (!id) return [];
      const list = byId[sid ?? ""] ?? [];
      return list.find((m) => m.id === id)?.groups ?? [];
    });
    return { seen, byId };
  }

  it("解析只查所属会话，不会跨会话串台", () => {
    installTwoSessions();

    // 两个会话各跑一轮
    notifyTraceRunStarted("a-1", "A");
    notifyTraceRunStarted("b-1", "B");
    // 用户在 A 会话里看
    syncTraceScopeToActiveSession("A");

    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["A 的轨迹"]);
  });

  it("B 会话跑来事件，不会把 A 的轨迹抢走（不闪烁）", () => {
    installTwoSessions();
    syncTraceScopeToActiveSession("A");
    notifyTraceRunStarted("a-1", "A");
    openTraceDrawer("a-1", [group(1, "A 的轨迹")], undefined, "A");

    const before = resolveTraceRoundGroups().map((g) => g.narrative);
    // B 会话（后台运行）开了新一轮 —— 以前这会把锁抢到 b-1，面板内容突变
    notifyTraceRunStarted("b-1", "B");

    expect(useAgentTraceDrawerState().messageId).toBe("a-1");
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(before);
  });

  it("反复切换会话时，两个会话的轨迹各自稳定、互不残留", () => {
    installTwoSessions();

    notifyTraceRunStarted("a-1", "A");
    notifyTraceRunStarted("b-1", "B");

    // 连续来回切 —— 每一步都必须稳定解析出自会话的轨迹
    const expectMap: Array<[string, string]> = [
      ["A", "A 的轨迹"],
      ["B", "B 的轨迹"],
      ["A", "A 的轨迹"],
      ["B", "B 的轨迹"],
    ];
    for (const [sid, narrative] of expectMap) {
      syncTraceScopeToActiveSession(sid);
      expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual([narrative]);
    }
  });

  it("用户显式锁定的跨会话轨迹不被会话切换抢走", () => {
    installTwoSessions();
    // 用户在 A 里点开某条历史消息（显式锁定）
    openTraceDrawer("a-1", [group(1, "A 的轨迹")], undefined, "A");

    // 切到 B 会话：显式锁定优先，面板保持用户看的那条
    syncTraceScopeToActiveSession("B");

    expect(useAgentTraceDrawerState().messageId).toBe("a-1");
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["A 的轨迹"]);
  });

  /**
   * 「首次切回会话，数据流轨迹没内容；第二次再切回来就显示了」回归。
   *
   * 根因：`latestMessageIdBySession` 曾是普通 `Map`（非响应式）。
   * 首次切到一个**没访问过**的会话时，该会话桶里还没有最新消息 id，
   * `syncTraceScopeToActiveSession` 把锁置空 → 面板 computed 算出空态**并缓存**；
   * 紧接着该会话的消息挂载、`registerLatestTrace` 把 id 写进 Map —— 普通 Map 的
   * 这次写入不发响应式信号，compute 不重算，面板就一直空着。
   * 第二次切回来时锁已在桶里，直接解析成功，于是"第二次才显示"。
   */
  it("首次切到未访问过的会话，消息挂载后面板必须能显示（响应式最新 id）", () => {
    setTraceGroupResolver((id) =>
      id === "a-1" ? [group(1, "A 的轨迹")] : id === "b-1" ? [group(1, "B 的轨迹")] : [],
    );
    setTraceMessageExistsResolver((id) => id === "a-1" || id === "b-1");
    let active = "A";
    setTraceActiveSessionResolver(() => active);

    // A 会话跑过一轮：最新 id 已落进 A 桶，面板 computed 先算一次并缓存
    notifyTraceRunStarted("a-1", "A");
    const traced = computed(() => resolveTraceRoundGroups());
    expect(traced.value.map((g) => g.narrative)).toEqual(["A 的轨迹"]);

    // 首次切到 B：B 桶还没有 id → 锁置空，面板当场算出空态
    active = "B";
    syncTraceScopeToActiveSession("B");
    expect(traced.value).toEqual([]);

    // B 的消息挂载，注册最新 id（只有响应式 Map 才能唤醒上面那个 computed）
    registerLatestTrace("b-1", [group(1, "B 的轨迹")]);

    expect(useAgentTraceDrawerState().messageSessionId).toBe("B");
    expect(traced.value.map((g) => g.narrative)).toEqual(["B 的轨迹"]);
  });
});

/**
 * 「第一轮自动弹出 → 面板一直空」回归组。
 *
 * 实测形态：一轮刚开跑时 `notifyTraceRunStarted` 就弹了面板，但那一刻这条 assistant
 * 消息**还没有任何 roundGroups**（第一个 `status` / `turn_request` 事件还没到）。
 * 于是：
 *
 * 1. `resolveTraceRoundGroups` 拿锁去查 → 查到 0 轮 → 把锁记进 `deadLock*` 缓存
 *    （"已确认失效"）；
 * 2. 随后数据真的长出来了，但缓存命中直接**跳过 resolver**，不再回头看这条消息；
 * 3. 回退走 `getLatestMessageId`，而"最新 id"要靠 `registerLatestTrace`
 *    （渲染树里的 watch，要求 `groups.length > 0`）或 `notifyTraceRunStarted` 注册 ——
 *    前者此时同样因为 0 轮而不注册，后者这一轮已经注册过同一个 id，
 *    回退分支又显式排除了 `fallbackId === locked`；
 * 4. 结果：面板恒为空，直到用户手动点某条消息的入口（那是另一条锁路径）。
 *
 * 根因是「空数据」被误判成「失效 id」并永久缓存。空 ≠ 死：消息存在但还没产出内容，
 * 下一帧就会长出数据，不能进失效缓存。
 */
describe("agentTraceDrawer 第一轮自动弹出（空轨迹回归）", () => {
  beforeEach(() => {
    __resetAgentTraceDrawerForTest();
  });

  it("自动弹出时还没有数据，随后产出必须能显示出来", () => {
    // 消息此刻存在、roundGroups 为空（真实运行刚开始的形态）
    const msg = { id: "m1", roundGroups: [] as AgentRoundGroup[] };
    setTraceGroupResolver((id) => (id === "m1" ? msg.roundGroups : []));
    // 消息确实在表里 —— 这是"空 ≠ 死"的关键前提，必须显式声明
    setTraceMessageExistsResolver((id) => id === "m1");

    // Agent 开跑：面板自动弹出并锁到这条消息
    notifyTraceRunStarted("m1");
    expect(useAgentTraceDrawerState().open).toBe(true);

    // 弹窗那一刻没有数据 —— 空态是对的，但**不能**把这条消息判成失效。
    // 求值两次：真实渲染里 computed 会被反复求值，旧实现在第二次就把它记进失效缓存
    // （这正是「第一轮自动弹出后一直空」的触发条件，只求值一次反而复现不出来）。
    expect(resolveTraceRoundGroups()).toEqual([]);
    expect(resolveTraceRoundGroups()).toEqual([]);

    // 第一个事件到达，roundGroups 长出来了
    msg.roundGroups = [group(1, "第一轮推理")];

    // 面板必须显示出来（锁就是这条消息本身，不该被回退逻辑绕过）
    expect(resolveTraceRoundGroups().map((g) => g.narrative)).toEqual(["第一轮推理"]);
  });

  it("空数据不写进失效缓存，后续工具表也能解析到", () => {
    const msg = { id: "m1", roundGroups: [] as AgentRoundGroup[] };
    setTraceGroupResolver((id) => (id === "m1" ? msg.roundGroups : []));
    setTraceMessageExistsResolver((id) => id === "m1");
    setTraceToolsResolver((id) => (id === "m1" ? [{ id: "t1" } as never] : []));

    notifyTraceRunStarted("m1");
    // 多求值几次，确保没有任何"第二次就改判"的缓存行为
    resolveTraceRoundGroups();
    resolveTraceRoundGroups();
    expect(resolveTraceTools()).toHaveLength(1);

    msg.roundGroups = [group(1, "内容")];

    expect(resolveTraceRoundGroups()).toHaveLength(1);
    expect(resolveTraceTools()).toHaveLength(1);
  });
});
