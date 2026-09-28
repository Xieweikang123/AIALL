/**
 * 回归：轨迹条目的「全屏查看」与数据流轨迹抽屉的 Esc 争用。
 *
 * 历史 bug：抽屉（`AgentTraceDrawer.vue`）和全屏层（`AgentTracePanel.vue`）各自监听
 * `window` 的 keydown。全屏打开时按一次 Esc，两个监听都触发 —— 全屏关了，**抽屉也一起关**。
 * 抽屉一关，里面的 `AgentTracePanel` 整个卸载，`openTurns` / `expandedKeys` 状态随之丢失，
 * 于是「再次打开就不是之前那个样子」。
 *
 * 修法：全屏层在**捕获阶段**注册 keydown，并 `stopImmediatePropagation` 阻断同目标
 * 上的抽屉监听 —— Esc 只关全屏这一层。本测试不依赖 DOM（vitest 环境为 node），
 * 直接对组件源码做结构断言。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "AgentTracePanel.vue"), "utf8");

describe("轨迹全屏查看 · Esc 只关全屏，不关抽屉", () => {
  it("捕获阶段注册 keydown（第三参 true），先于抽屉的冒泡监听", () => {
    expect(src).toMatch(/window\.addEventListener\(\s*"keydown"\s*,\s*onFullscreenKeydown\s*,\s*true\s*\)/);
    expect(src).toMatch(/window\.removeEventListener\(\s*"keydown"\s*,\s*onFullscreenKeydown\s*,\s*true\s*\)/);
  });

  it("全屏开着时 Esc 阻断同目标上的其它监听（stopImmediatePropagation）", () => {
    const handler = src.match(/function onFullscreenKeydown[\s\S]*?\n\}/);
    expect(handler).not.toBeNull();
    expect(handler![0]).toMatch(/event\.key\s*!==\s*"Escape"/);
    expect(handler![0]).toMatch(/event\.stopImmediatePropagation\(\)/);
    expect(handler![0]).toMatch(/closeEntryFullscreen\(\)/);
  });

  it("拦截必须先于关闭判断之前就生效（只在全屏开着时拦）", () => {
    const handler = src.match(/function onFullscreenKeydown[\s\S]*?\n\}/)![0];
    // 条件里带 fullscreenEntry 判空，避免全屏没开时空吞 Esc（那会挡掉抽屉的关闭）
    expect(handler).toMatch(/!fullscreenEntry\.value/);
  });
});

describe("轨迹全屏查看 · 结构与入口", () => {
  it("全屏层 Teleport 到 body（铺满窗口，不受抽屉限高约束）", () => {
    expect(src).toMatch(/<Teleport to="body">/);
    expect(src).toMatch(/agent-trace-fs-overlay/);
  });

  it("每个条目行有全屏按钮，点击不触发行的展开/折叠", () => {
    expect(src).toMatch(/class="agent-trace-row-fs"/);
    expect(src).toMatch(/@click\.stop="openEntryFullscreen\(entry\)"/);
  });

  it("全屏存的是条目对象快照，不是 key（实时重建下 key 会失配）", () => {
    expect(src).toMatch(/const fullscreenEntry = ref<AgentTraceEntry \| null>\(null\)/);
  });
});
