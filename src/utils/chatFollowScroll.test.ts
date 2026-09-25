import { describe, expect, it } from "vitest";
import {
  FOLLOW_BOTTOM_TOLERANCE_PX,
  canScrollContainer,
  decideFollowAfterContentGrowth,
  decideFollowAfterUserInput,
  isTrulyAtBottom,
} from "./chatFollowScroll";

/** 视口高度（真实日志里是 688）。 */
const VIEW = 688;

function atBottomState(scrollHeight: number, scrollTop?: number) {
  return { scrollTop: scrollTop ?? scrollHeight - VIEW, scrollHeight, clientHeight: VIEW };
}

describe("canScrollContainer", () => {
  it("内容不足一屏 → 不可滚", () => {
    expect(canScrollContainer(500, VIEW)).toBe(false);
    expect(canScrollContainer(VIEW, VIEW)).toBe(false);
  });

  it("内容超过一屏 → 可滚", () => {
    expect(canScrollContainer(VIEW + 2, VIEW)).toBe(true);
  });
});

describe("isTrulyAtBottom", () => {
  it("贴底判定", () => {
    expect(isTrulyAtBottom(100, 788, VIEW)).toBe(true);
  });

  it("容差内算触底", () => {
    expect(isTrulyAtBottom(100 - FOLLOW_BOTTOM_TOLERANCE_PX, 788, VIEW)).toBe(true);
  });

  it("超出容差不触底", () => {
    expect(isTrulyAtBottom(97, 788, VIEW)).toBe(false);
  });
});

describe("decideFollowAfterUserInput", () => {
  it("用户在底部滚动 → 保持跟随", () => {
    const s = atBottomState(1200);
    expect(decideFollowAfterUserInput({ ...s, wasFollowing: true })).toBe(true);
  });

  it("用户往上翻 → 停止跟随", () => {
    const s = atBottomState(1200, 100);
    expect(decideFollowAfterUserInput({ ...s, wasFollowing: true })).toBe(false);
  });

  it("用户翻回底部 → 恢复跟随", () => {
    const s = atBottomState(1200);
    expect(decideFollowAfterUserInput({ ...s, wasFollowing: false })).toBe(true);
  });

  it("容器不足一屏时滚轮无效 → 不改变跟随状态", () => {
    // 边界：内容还没满屏，用户随手滚了下滚轮。此时滚不动，不能算「离开底部」，
    // 否则回复长起来后就再也不跟随了。
    expect(
      decideFollowAfterUserInput({ scrollTop: 0, scrollHeight: 500, clientHeight: VIEW, wasFollowing: true }),
    ).toBe(true);
    expect(
      decideFollowAfterUserInput({ scrollTop: 0, scrollHeight: 500, clientHeight: VIEW, wasFollowing: false }),
    ).toBe(false);
  });
});

describe("decideFollowAfterContentGrowth", () => {
  it("跟随中内容增长 → 继续跟随（历史 bug：内容长高不该解除跟随）", () => {
    // 真实日志现场：scrollHeight 745→780（+35px），弹簧一帧只推 3px，
    // remaining 冲到 33。旧实现用 30px 阈值判定 → 误判「用户离开」→ 永久停止跟随。
    expect(
      decideFollowAfterContentGrowth({ scrollTop: 60, scrollHeight: 780, clientHeight: VIEW, wasFollowing: true }),
    ).toBe(true);
  });

  it("未跟随时内容增长但没触底 → 保持不跟随", () => {
    expect(
      decideFollowAfterContentGrowth({ scrollTop: 100, scrollHeight: 1200, clientHeight: VIEW, wasFollowing: false }),
    ).toBe(false);
  });

  it("未跟随时内容增长且已触底 → 恢复跟随", () => {
    const s = atBottomState(1200);
    expect(decideFollowAfterContentGrowth({ ...s, wasFollowing: false })).toBe(true);
  });
});

describe("回归：内容连续增长不应打断跟随", () => {
  it("模拟一次流式回复中的连续长高", () => {
    // 弹簧跟随会持续把 scrollTop 推向底部；只要没触底过一次，就必须一直跟随。
    let following = true;
    let scrollTop = 0;
    // 取自真实探针日志的 scrollHeight 序列（688 → 719 → 742 → 752 → 780 → …）。
    const heights = [688, 719, 742, 752, 780, 814, 875, 956, 1200];

    for (const h of heights) {
      following = decideFollowAfterContentGrowth({
        scrollTop,
        scrollHeight: h,
        clientHeight: VIEW,
        wasFollowing: following,
      });
      // 跟随中：模拟弹簧把 scrollTop 推到当前底部
      scrollTop = Math.max(scrollTop, h - VIEW);
    }

    expect(following).toBe(true);
    expect(scrollTop).toBe(1200 - VIEW);
  });
});
