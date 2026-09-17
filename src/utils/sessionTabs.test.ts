import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOpenedSessionTabs,
  decideSessionTabsRestore,
  readSessionTabs,
  sessionTabsStorageKey,
  writeSessionTabs,
} from "./sessionTabs";
import type { VibeChatSessionMeta } from "../services/vibeChatStorage";

function meta(id: string, overrides: Partial<VibeChatSessionMeta> = {}): VibeChatSessionMeta {
  return {
    id,
    title: `会话 ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messageCount: 2,
    ...overrides,
  };
}

function installLocalStorageMock() {
  const storage: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in storage ? storage[key] : null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      for (const key of Object.keys(storage)) delete storage[key];
    },
    key: (index: number) => Object.keys(storage)[index] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  });
  return storage;
}

describe("sessionTabs", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  // ─── 回归：刷新/切项目后 tab 丢失（历史两次复发） ──────────────
  describe("decideSessionTabsRestore — 索引未就绪保护", () => {
    it("knownIds 为空时必须跳过，不得产出空列表", () => {
      const decision = decideSessionTabsRestore({
        persisted: ["s1", "s2", "s3"],
        current: [],
        activeId: "",
        knownIds: [],
      });
      expect(decision.next).toBeNull();
      expect(decision.persist).toBe(false);
    });

    it("项目切换中途：resetSessionUi 清空后的空列表不得清掉存档", () => {
      const storage = installLocalStorageMock();
      const project = "D:/project/demo";
      writeSessionTabs(project, ["s1", "s2", "s3"]);

      // 模拟 resetUiForProjectSwitch → sessionList=[] 触发 watch
      const decision = decideSessionTabsRestore({
        persisted: readSessionTabs(project),
        current: [],
        activeId: "",
        knownIds: [],
      });
      if (decision.next !== null && decision.persist) {
        writeSessionTabs(project, decision.next);
      }

      expect(storage[sessionTabsStorageKey(project)]).toBe(JSON.stringify(["s1", "s2", "s3"]));
      expect(readSessionTabs(project)).toEqual(["s1", "s2", "s3"]);
    });

    it("索引就绪后恢复全部 tab，而非只剩当前激活会话", () => {
      const decision = decideSessionTabsRestore({
        persisted: ["s1", "s2", "s3"],
        current: [],
        activeId: "s2",
        knownIds: ["s1", "s2", "s3"],
      });
      expect(decision.next).toEqual(["s1", "s2", "s3"]);
    });
  });

  describe("合并与过滤", () => {
    it("保留持久化顺序，内存新增的 tab 追加在后", () => {
      const decision = decideSessionTabsRestore({
        persisted: ["s1", "s3"],
        current: ["s3", "s4"],
        activeId: "s4",
        knownIds: ["s1", "s2", "s3", "s4"],
      });
      expect(decision.next).toEqual(["s1", "s3", "s4"]);
    });

    it("过滤已删除会话的 tab", () => {
      const decision = decideSessionTabsRestore({
        persisted: ["s1", "gone", "s3"],
        current: [],
        activeId: "s1",
        knownIds: ["s1", "s3"],
      });
      expect(decision.next).toEqual(["s1", "s3"]);
    });

    it("当前激活会话即使不在持久化记录里也要补上", () => {
      const decision = decideSessionTabsRestore({
        persisted: [],
        current: [],
        activeId: "s9",
        knownIds: ["s9"],
      });
      expect(decision.next).toEqual(["s9"]);
    });

    it("去重：同一会话重复出现只保留一次", () => {
      const decision = decideSessionTabsRestore({
        persisted: ["s1", "s1"],
        current: ["s1", "s2"],
        activeId: "s1",
        knownIds: ["s1", "s2"],
      });
      expect(decision.next).toEqual(["s1", "s2"]);
    });

    it("持久化与内存都为空时不应 persist", () => {
      const decision = decideSessionTabsRestore({
        persisted: [],
        current: [],
        activeId: "",
        knownIds: ["s1"],
      });
      expect(decision.next).toEqual([]);
      expect(decision.persist).toBe(false);
    });

    it("清理了已删除 tab 时应 persist", () => {
      const decision = decideSessionTabsRestore({
        persisted: ["s1", "gone"],
        current: [],
        activeId: "s1",
        knownIds: ["s1"],
      });
      expect(decision.next).toEqual(["s1"]);
      expect(decision.persist).toBe(true);
    });

    it("激活的草稿会话不在索引里也要保留 tab（点 + 立刻可见）", () => {
      const decision = decideSessionTabsRestore({
        persisted: ["s1"],
        current: ["s1", "draft1"],
        activeId: "draft1",
        knownIds: ["s1"],
      });
      expect(decision.next).toEqual(["s1", "draft1"]);
    });

    it("非激活的未知 id 仍被过滤（不给已删除会话留 tab）", () => {
      const decision = decideSessionTabsRestore({
        persisted: ["s1", "gone"],
        current: [],
        activeId: "s1",
        knownIds: ["s1"],
      });
      expect(decision.next).toEqual(["s1"]);
    });
  });

  describe("buildOpenedSessionTabs — 草稿占位 tab", () => {
    it("草稿会话渲染成「新会话」占位 tab，标题为空", () => {
      const tabs = buildOpenedSessionTabs(["s1", "draft1"], [meta("s1")], "draft1");
      expect(tabs.map((t) => t.id)).toEqual(["s1", "draft1"]);
      expect(tabs[1].title).toBe("");
      expect(tabs[1].messageCount).toBe(0);
      expect(tabs[1].status).toBe("draft");
    });

    it("草稿转正后由真实元数据接管（标题/消息数来自 sessionList）", () => {
      const tabs = buildOpenedSessionTabs(
        ["draft1"],
        [meta("draft1", { title: "第一条消息", messageCount: 2 })],
        "draft1",
      );
      expect(tabs).toHaveLength(1);
      expect(tabs[0].title).toBe("第一条消息");
      expect(tabs[0].messageCount).toBe(2);
    });

    it("切走后草稿 tab 消失（id 不在 openedIds 里）", () => {
      const tabs = buildOpenedSessionTabs(["s1"], [meta("s1")], "s1");
      expect(tabs.map((t) => t.id)).toEqual(["s1"]);
    });

    it("只给激活的未知 id 补占位，非激活未知 id 丢弃", () => {
      const tabs = buildOpenedSessionTabs(["s1", "ghost"], [meta("s1")], "s1");
      expect(tabs.map((t) => t.id)).toEqual(["s1"]);
    });

    it("激活会话不在 openedIds 时不凭空造 tab", () => {
      const tabs = buildOpenedSessionTabs([], [meta("s1")], "s1");
      expect(tabs).toEqual([]);
    });
  });

  describe("读写存储", () => {
    it("round-trips per project", () => {
      writeSessionTabs("D:/project/demo", ["s1", "s2"]);
      expect(readSessionTabs("D:/project/demo")).toEqual(["s1", "s2"]);
      expect(readSessionTabs("D:/project/other")).toEqual([]);
    });

    it("空列表移除存储键", () => {
      const project = "D:/project/demo";
      writeSessionTabs(project, ["s1"]);
      writeSessionTabs(project, []);
      expect(localStorage.getItem(sessionTabsStorageKey(project))).toBeNull();
      expect(readSessionTabs(project)).toEqual([]);
    });

    it("兼容旧存档：非法项被过滤，非数组返回空", () => {
      const project = "D:/project/demo";
      localStorage.setItem(sessionTabsStorageKey(project), JSON.stringify(["s1", 42, "", "s2"]));
      expect(readSessionTabs(project)).toEqual(["s1", "s2"]);

      localStorage.setItem(sessionTabsStorageKey(project), JSON.stringify({ tabs: ["s1"] }));
      expect(readSessionTabs(project)).toEqual([]);
    });

    it("空项目路径不读写", () => {
      writeSessionTabs("   ", ["s1"]);
      expect(readSessionTabs("   ")).toEqual([]);
    });
  });
});
