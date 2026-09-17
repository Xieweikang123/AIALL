import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideSessionTabsRestore,
  readSessionTabs,
  sessionTabsStorageKey,
  writeSessionTabs,
} from "./sessionTabs";

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
