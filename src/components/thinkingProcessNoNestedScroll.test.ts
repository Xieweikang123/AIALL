/**
 * 回归：思考过程（过程 feed）不得再有内部滚动容器。
 *
 * 历史 bug：思考过程区域有两个内层滚动容器，
 *   1. `.process-step-list`（工具步骤列表）—— `max-height: 240px; overflow-y: auto`
 *   2. `.stream-reasoning-body--clamped`（推理文本）—— `max-height: ~3 行; overflow-y: auto;
 *      overscroll-behavior: contain`
 *
 * 鼠标落在这些区域时，滚轮被内层容器优先吃掉（它先把自己滚到底），
 * 外层对话的跟随 /「回到底部」逻辑收不到 wheel，用户没法顺畅滚动查看上下文。
 *
 * 修法：折叠态「一行显示 + 手动展开」，高度靠裁切而非固定高度 + 内部滚动条。
 *   - 步骤列表：只渲染 1 行（`COLLAPSED_ROWS`），展开渲染全部
 *   - 推理文本：`REASONING_COLLAPSED_LINES = 1`，容器 `overflow: hidden` 纯裁切
 *
 * 本测试不依赖 DOM（vitest 环境为 node），直接对源码文本做结构断言。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

const stepListSrc = read("./AgentProcessStepList.vue");
const feedSrc = read("./AgentInlineFeedItems.vue");

/** 取出 <style scoped> 段落，避免误伤模板里的 class 绑定。 */
function styleBlock(src: string): string {
  const match = src.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return match ? match[1] : "";
}

/**
 * 剥掉 CSS 注释再断言 —— 说明性注释里会提到「曾经是 overflow-y: auto」这类字样，
 * 不剥离会产生假失败。
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 取出某条选择器的基础规则声明体（取第一个匹配的花括号块）。 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match ? match[1] : "";
}

/** 所有以该选择器开头的规则（含 `.x--modifier` 变体）。 */
function rulesStartingWith(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}[^{]*\\{[^}]*\\}`, "g")) ?? [];
}

describe("思考过程 · 步骤列表：无内部滚动容器", () => {
  const css = stripCssComments(styleBlock(stepListSrc));
  const baseRule = ruleBody(css, ".process-step-list");

  it("能找到 .process-step-list 基础规则", () => {
    expect(baseRule).not.toBe("");
  });

  it("基础规则不得声明 overflow-y: auto（滚轮陷阱来源）", () => {
    expect(baseRule).not.toMatch(/overflow-y\s*:\s*auto/);
  });

  it("基础规则不得声明 max-height（固定高度窗口）", () => {
    expect(baseRule).not.toMatch(/max-height\s*:/);
  });

  it("所有 .process-step-list 规则都不得使用 overflow-y: auto", () => {
    const offenders = rulesStartingWith(css, ".process-step-list").filter((r) =>
      /overflow-y\s*:\s*auto/.test(r),
    );
    expect(offenders).toEqual([]);
  });

  it("折叠态常量为 1 行", () => {
    expect(stepListSrc).toMatch(/const COLLAPSED_ROWS\s*=\s*1\s*;/);
  });

  it("折叠态渲染最后 N 行，展开态渲染全部", () => {
    expect(stepListSrc).toMatch(/rows\.value\.slice\(-COLLAPSED_ROWS\)/);
    expect(stepListSrc).toMatch(/if \(expanded\.value\) return rows\.value;/);
  });

  it("保留了手动展开 / 收起入口", () => {
    expect(stepListSrc).toMatch(/展开全部/);
    expect(stepListSrc).toMatch(/收起/);
  });

  it("不再有临时探针残留", () => {
    expect(stepListSrc).not.toMatch(/thinkingScrollProbe/);
    expect(stepListSrc).not.toMatch(/onProbeWheel/);
  });
});

describe("思考过程 · 推理文本：无内部滚动容器", () => {
  const css = stripCssComments(styleBlock(feedSrc));
  const clampedRule = ruleBody(css, ".stream-reasoning-body--clamped");

  it("能找到 .stream-reasoning-body--clamped 规则", () => {
    expect(clampedRule).not.toBe("");
  });

  it("不得声明 overflow-y: auto", () => {
    expect(clampedRule).not.toMatch(/overflow-y\s*:\s*auto/);
  });

  it("不得声明 overflow-x: hidden（改由 overflow: hidden 统一裁切）", () => {
    expect(clampedRule).not.toMatch(/overflow-x\s*:\s*hidden/);
  });

  it("不得声明 overscroll-behavior: contain（那是主动锁死滚动）", () => {
    expect(clampedRule).not.toMatch(/overscroll-behavior/);
  });

  it("使用 overflow: hidden 做纯裁切", () => {
    expect(clampedRule).toMatch(/overflow\s*:\s*hidden/);
  });

  it("折叠行数为 1 行", () => {
    expect(feedSrc).toMatch(/const REASONING_COLLAPSED_LINES\s*=\s*1\s*;/);
  });

  it("展开 / 收起时把 scrollTop 归零（保证露出第 1 行）", () => {
    const toggle = feedSrc.match(/function toggleReasoning[\s\S]*?\n\}/);
    expect(toggle).not.toBeNull();
    expect(toggle![0]).toMatch(/scrollTop\s*=\s*0/);
  });

  it("已移除隐藏滚动条的 webkit 规则（容器不再可滚）", () => {
    expect(css).not.toMatch(/stream-reasoning-body--clamped::-webkit-scrollbar/);
  });
});
