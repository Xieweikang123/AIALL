/**
 * 回归：轨迹面板的展开态必须跨组件卸载保留。
 *
 * 历史 bug：面板（`AgentTracePanel.vue`）的 `openTurns` / `expandedKeys` 是组件内 ref。
 * 关闭抽屉（✕ / Esc / 工具栏）/ 切列宽 / 切会话都会让面板**卸载**，ref 随之丢失 ——
 * 重开就是初始态（「再次打开不是之前那个样子」）。Esc 争用只是其中一条路径。
 *
 * 修法：展开态存到模块级单例（`agentTraceDrawer.ts` 的 `expandByMessage`），按消息 id
 * 分桶，面板挂载时恢复、任何变化时写回。本测试不依赖 DOM（vitest 环境为 node），
 * 直接对源码文本做结构断言，并直接调用服务层存取函数验证往返。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetAgentTraceDrawerForTest,
  currentTraceExpandKey,
  loadTraceExpandSnapshot,
  saveTraceExpandSnapshot,
} from "../services/agentTraceDrawer";

const here = dirname(fileURLToPath(import.meta.url));
const panelSrc = readFileSync(resolve(here, "AgentTracePanel.vue"), "utf8");
const drawerSrc = readFileSync(resolve(here, "../services/agentTraceDrawer.ts"), "utf8");

describe("轨迹展开态 · 服务层存取往返", () => {
  beforeEach(() => {
    __resetAgentTraceDrawerForTest();
  });

  it("存取往返：写入的展开态能按同一个 key 读回", () => {
    saveTraceExpandSnapshot("msg-1", {
      openTurns: [1, 3],
      expandedKeys: [
        ["req-1-0-system", true],
        ["reason-1", false],
      ],
    });
    const snap = loadTraceExpandSnapshot("msg-1");
    expect(snap?.openTurns).toEqual([1, 3]);
    expect(snap?.expandedKeys).toEqual([
      ["req-1-0-system", true],
      ["reason-1", false],
    ]);
  });

  it("按消息 id 分桶：不同消息互不串", () => {
    saveTraceExpandSnapshot("msg-a", { openTurns: [1], expandedKeys: [] });
    saveTraceExpandSnapshot("msg-b", { openTurns: [2], expandedKeys: [] });
    expect(loadTraceExpandSnapshot("msg-a")?.openTurns).toEqual([1]);
    expect(loadTraceExpandSnapshot("msg-b")?.openTurns).toEqual([2]);
    expect(loadTraceExpandSnapshot("msg-c")).toBeUndefined();
  });

  it("写入的是快照副本：外部数组后续被改不影响已存值", () => {
    const openTurns = [1, 2];
    saveTraceExpandSnapshot("msg-1", { openTurns, expandedKeys: [] });
    openTurns.push(9);
    expect(loadTraceExpandSnapshot("msg-1")?.openTurns).toEqual([1, 2]);
  });

  it("无显式锁（messageId 为空）时落到 latest 桶", () => {
    expect(currentTraceExpandKey()).toBe("__latest__");
  });

  it("reset 清空展开态（测试隔离）", () => {
    saveTraceExpandSnapshot("msg-1", { openTurns: [1], expandedKeys: [] });
    __resetAgentTraceDrawerForTest();
    expect(loadTraceExpandSnapshot("msg-1")).toBeUndefined();
  });

  it("服务层确实提供了 currentTraceExpandKey / load / save 三个出口", () => {
    expect(drawerSrc).toMatch(/export function currentTraceExpandKey/);
    expect(drawerSrc).toMatch(/export function loadTraceExpandSnapshot/);
    expect(drawerSrc).toMatch(/export function saveTraceExpandSnapshot/);
  });
});

describe("轨迹展开态 · 面板接进单例", () => {
  it("openTurns / expandedKeys 初值从单例恢复", () => {
    expect(panelSrc).toMatch(/loadTraceExpandSnapshot\(currentTraceExpandKey\(\)\)/);
    expect(panelSrc).toMatch(/new Set\(restoredSnapshot\?\.openTurns/);
    expect(panelSrc).toMatch(/new Map\(restoredSnapshot\?\.expandedKeys/);
  });

  it("展开态变化时写回单例（watch 覆盖所有写入点，不靠 unmount 钩子）", () => {
    expect(panelSrc).toMatch(/saveTraceExpandSnapshot\(currentTraceExpandKey\(\)/);
    expect(panelSrc).toMatch(/watch\(\s*\[openTurns, expandedKeys\]/);
  });

  it("有存档时挂载首次不自动展开最新一轮（否则覆盖用户折叠意图）", () => {
    expect(panelSrc).toMatch(/let skipAutoOpenLatestOnce = Boolean\(restoredSnapshot\)/);
    expect(panelSrc).toMatch(/if \(skipAutoOpenLatestOnce\) \{/);
  });
});
