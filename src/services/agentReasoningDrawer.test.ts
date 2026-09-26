import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetReasoningDrawerForTest,
  closeReasoningDrawer,
  listReasoningEntries,
  notifyReasoningRunFinished,
  openLatestReasoningDrawer,
  openReasoningDrawer,
  registerReasoningEntry,
  resolveReasoningDrawerEntry,
  setReasoningAutoEnabled,
  setReasoningDrawerFollow,
  useReasoningDrawerState,
} from "./agentReasoningDrawer";

describe("agentReasoningDrawer", () => {
  beforeEach(() => {
    __resetReasoningDrawerForTest();
  });

  it("Agent 开始思考时自动展开并展示该段全文", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "先看目录结构", active: true });

    const state = useReasoningDrawerState();
    expect(state.open).toBe(true);
    expect(resolveReasoningDrawerEntry()?.text).toBe("先看目录结构");
  });

  it("这段思考段落结束后抽屉保持打开，不再中途收起", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考中", active: true });
    expect(useReasoningDrawerState().open).toBe(true);

    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考完了", active: false });

    expect(useReasoningDrawerState().open).toBe(true);
  });

  it("整轮结束时才收起自动弹出的抽屉", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考中", active: true });
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考完了", active: false });
    expect(useReasoningDrawerState().open).toBe(true);

    notifyReasoningRunFinished("m1");

    expect(useReasoningDrawerState().open).toBe(false);
  });

  it("整轮结束时若抽屉展示的是另一条消息，则保持打开", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "消息一思考", active: true });
    expect(useReasoningDrawerState().open).toBe(true);

    notifyReasoningRunFinished("m2");

    expect(useReasoningDrawerState().open).toBe(true);
  });

  it("未开始思考时不展开", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "历史思考", active: false });

    expect(useReasoningDrawerState().open).toBe(false);
  });

  it("关掉自动显示后，思考不再自动展开", () => {
    setReasoningAutoEnabled(false);

    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考中", active: true });

    expect(useReasoningDrawerState().open).toBe(false);
  });

  it("关掉自动显示会立刻收起面板", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考中", active: true });
    expect(useReasoningDrawerState().open).toBe(true);

    setReasoningAutoEnabled(false);

    expect(useReasoningDrawerState().open).toBe(false);
  });

  it("重新开启自动显示后，下一段思考会再自动展开", () => {
    setReasoningAutoEnabled(false);
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "第一段", active: true });
    expect(useReasoningDrawerState().open).toBe(false);

    setReasoningAutoEnabled(true);
    registerReasoningEntry({ messageId: "m1", key: "r2", text: "第二段", active: true });

    expect(useReasoningDrawerState().open).toBe(true);
    expect(resolveReasoningDrawerEntry()?.text).toBe("第二段");
  });

  it("自动展开时，同一段文本增长保持展开并跟随", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考", active: true });
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考更多", active: true });

    const state = useReasoningDrawerState();
    expect(state.open).toBe(true);
    expect(state.follow).toBe(true);
    expect(resolveReasoningDrawerEntry()?.text).toBe("思考更多");
  });

  it("连续多段思考逐段接管展示", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "第一段", active: true });
    registerReasoningEntry({ messageId: "m1", key: "r2", text: "第二段", active: true });

    expect(resolveReasoningDrawerEntry()?.text).toBe("第二段");
  });

  it("手动点开面板后不会被「思考结束」自动收起", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "历史思考", active: false });
    openLatestReasoningDrawer();
    expect(useReasoningDrawerState().open).toBe(true);

    registerReasoningEntry({ messageId: "m1", key: "r2", text: "新思考结束", active: false });

    expect(useReasoningDrawerState().open).toBe(true);
  });

  it("手动关掉面板后取消锁定，且思考中会再次自动展开", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考中", active: true });
    closeReasoningDrawer();
    expect(useReasoningDrawerState().open).toBe(false);

    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考中，又长了", active: true });

    expect(useReasoningDrawerState().open).toBe(true);
  });

  it("可以按 key 直接打开指定历史段落", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "旧思考", active: false });
    registerReasoningEntry({ messageId: "m1", key: "r2", text: "新思考", active: false });

    openReasoningDrawer("r2");

    expect(resolveReasoningDrawerEntry()?.text).toBe("新思考");
  });

  it("未登记任何内容时打开面板不抛错，展示空态", () => {
    openLatestReasoningDrawer();

    expect(useReasoningDrawerState().open).toBe(true);
    expect(resolveReasoningDrawerEntry()).toBeNull();
  });

  it("相同文本重复登记不刷新更新时间（避免无意义重渲染）", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考", active: false });
      const first = listReasoningEntries()[0].updatedAt;

      vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
      registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考", active: false });

      expect(listReasoningEntries()[0].updatedAt).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("同一段推理文本增长时原地更新，不新增条目", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考", active: true });
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "思考更多", active: true });

    expect(listReasoningEntries()).toHaveLength(1);
    expect(resolveReasoningDrawerEntry()?.text).toBe("思考更多");
  });

  it("不同消息的同名 key 互不覆盖", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "消息一的思考", active: false });
    registerReasoningEntry({ messageId: "m2", key: "r1", text: "消息二的思考", active: false });

    expect(listReasoningEntries()).toHaveLength(2);
  });

  it("用户暂停跟随后，新活跃段不抢走当前展示", () => {
    registerReasoningEntry({ messageId: "m1", key: "r1", text: "第一段", active: true });
    setReasoningDrawerFollow(false);

    registerReasoningEntry({ messageId: "m1", key: "r2", text: "第二段", active: true });

    expect(useReasoningDrawerState().follow).toBe(false);
  });

  it("条目按更新时间升序排列", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
      registerReasoningEntry({ messageId: "m1", key: "r1", text: "早", active: false });
      vi.setSystemTime(new Date("2024-01-01T00:01:00Z"));
      registerReasoningEntry({ messageId: "m1", key: "r2", text: "晚", active: false });

      expect(listReasoningEntries().map((entry) => entry.text)).toEqual(["早", "晚"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
