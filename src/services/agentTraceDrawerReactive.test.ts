import { describe, expect, it } from "vitest";
import { computed, reactive, ref } from "vue";
import {
  __resetAgentTraceDrawerForTest,
  registerLatestTrace,
  resolveTraceRoundGroups,
  setTraceGroupResolver,
} from "./agentTraceDrawer";
import type { AgentRoundGroup } from "./agentRoundGroups";

/**
 * 这组用例锁的是「抽屉不实时」那个 bug 的**机制**：
 * 消息对象被原地改写 + 底层 registry 非响应式，所以数据源必须显式读
 * `agentLiveRevision` 才能让 computed 重新求值。
 */
describe("agentTraceDrawer 实时性契约", () => {
  it("数据源读 revision 时，原地改写 roundGroups 能驱动 computed 重算", () => {
    __resetAgentTraceDrawerForTest();

    const revision = ref(0);
    const msg = reactiveMsg([{ turn: 1, narrative: "第一轮", modelSteps: [], toolIds: [] }]);

    setTraceGroupResolver((id) => {
      void revision.value;
      if (id !== "m1") return [];
      void msg.roundGroups;
      return msg.roundGroups;
    });
    registerLatestTrace("m1", msg.roundGroups);

    const traced = computed(() => resolveTraceRoundGroups());
    expect(traced.value.map((g) => g.narrative)).toEqual(["第一轮"]);

    // 模拟 flushPendingReasoningDelta：整体换数组 + bump revision（原地改消息对象）
    msg.roundGroups = [
      { turn: 1, narrative: "第一轮", reasoning: "在想", modelSteps: [], toolIds: [] },
    ];
    revision.value += 1;

    expect(traced.value[0]?.reasoning).toBe("在想");
  });

  it("消息是 reactive proxy 时，只读 roundGroups 就足以驱动重算", () => {
    __resetAgentTraceDrawerForTest();

    const revision = ref(0);
    const msg = reactiveMsg([{ turn: 1, narrative: "第一轮", modelSteps: [], toolIds: [] }]);

    // 不读 revision —— 验证「revision 是不是真必需」
    setTraceGroupResolver((id) => (id === "m1" ? msg.roundGroups : []));
    registerLatestTrace("m1", msg.roundGroups);

    const traced = computed(() => resolveTraceRoundGroups());
    expect(traced.value[0]?.reasoning).toBeUndefined();

    msg.roundGroups = [
      { turn: 1, narrative: "第一轮", reasoning: "在想", modelSteps: [], toolIds: [] },
    ];
    revision.value += 1;

    // reactive proxy 的字段读取本身就会登记依赖 → 重算
    expect(traced.value[0]?.reasoning).toBe("在想");
  });
});

/** 最小的 reactive 消息壳，模拟 chatMessages 里的元素（reactive proxy）。 */
function reactiveMsg(roundGroups: AgentRoundGroup[]) {
  return reactive({ id: "m1", roundGroups, tools: [] as unknown[] });
}
