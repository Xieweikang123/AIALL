import { describe, expect, it } from "vitest";
import {
  computeChatRailAnchors,
  computeRailThumb,
  pickActiveChatRailAnchor,
  railThumbTopToScrollTop,
  RAIL_BAND_END,
  RAIL_BAND_START,
  type ChatRailAnchorInput,
} from "./chatScrollRail";

/** 四消息布局：每条 400 高，内容 1600，视口 400。 */
const ANCHORS: ChatRailAnchorInput[] = [
  { id: "m1", top: 0, height: 400 },
  { id: "m2", top: 400, height: 400 },
  { id: "m3", top: 800, height: 400 },
  { id: "m4", top: 1200, height: 400 },
];

describe("computeChatRailAnchors", () => {
  it("distributes anchors evenly across the centered band", () => {
    const marks = computeChatRailAnchors(ANCHORS, {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 1600,
    });
    // 4 条 → i/(n-1) = 0,1/3,2/3,1 → 压进 0.2~0.8
    expect(marks.map((m) => m.pos)).toEqual([
      RAIL_BAND_START,
      RAIL_BAND_START + (1 / 3) * (RAIL_BAND_END - RAIL_BAND_START),
      RAIL_BAND_START + (2 / 3) * (RAIL_BAND_END - RAIL_BAND_START),
      RAIL_BAND_END,
    ]);
  });

  it("gives equal spacing even when message heights differ wildly", () => {
    const uneven: ChatRailAnchorInput[] = [
      { id: "a", top: 0, height: 20 },
      { id: "b", top: 20, height: 2000 },
      { id: "c", top: 2020, height: 20 },
    ];
    const marks = computeChatRailAnchors(uneven, {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 4000,
    });
    const [p0, p1, p2] = marks.map((m) => m.pos);
    expect(p1! - p0!).toBeCloseTo(p2! - p1!, 10);
  });

  it("keeps first/last off the extreme edges of the rail", () => {
    const marks = computeChatRailAnchors(ANCHORS, {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 1600,
    });
    expect(marks[0]?.pos).toBeGreaterThan(0);
    expect(marks[marks.length - 1]?.pos).toBeLessThan(1);
  });

  it("keeps marks stable when scrollHeight grows (lazy content)", () => {
    // 回归：往上滚时懒渲染的回复撑大 scrollHeight，旧实现会因分母变大把刻度压成一团。
    const before = computeChatRailAnchors(ANCHORS, {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 1600,
    });
    const after = computeChatRailAnchors(ANCHORS, {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 5200,
    });
    expect(after.map((m) => m.pos)).toEqual(before.map((m) => m.pos));
  });

  it("spans first to last question across the band", () => {
    const marks = computeChatRailAnchors(ANCHORS, {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 1600,
    });
    expect(marks[0]?.pos).toBe(RAIL_BAND_START);
    expect(marks[marks.length - 1]?.pos).toBe(RAIL_BAND_END);
  });

  it("centers a single question instead of pinning it to the top", () => {
    const marks = computeChatRailAnchors(
      [{ id: "only", top: 900, height: 300 }],
      { scrollTop: 0, clientHeight: 400, scrollHeight: 1600 },
    );
    expect(marks[0]?.pos).toBe((RAIL_BAND_START + RAIL_BAND_END) / 2);
  });

  it("flags anchors intersecting the viewport", () => {
    const marks = computeChatRailAnchors(ANCHORS, {
      scrollTop: 500,
      clientHeight: 400,
      scrollHeight: 1600,
    });
    // 视口 500~900：m2(400~800) 与 m3(800~1200) 相交，m1/m4 不相交
    expect(marks.map((m) => m.inView)).toEqual([false, true, true, false]);
  });

  it("returns no marks when content does not scroll", () => {
    const marks = computeChatRailAnchors(ANCHORS, {
      scrollTop: 0,
      clientHeight: 1600,
      scrollHeight: 1600,
    });
    expect(marks).toEqual([]);
  });

  it("returns no marks for an empty session", () => {
    expect(
      computeChatRailAnchors([], { scrollTop: 0, clientHeight: 400, scrollHeight: 400 }),
    ).toEqual([]);
  });
});

describe("pickActiveChatRailAnchor", () => {
  it("picks the anchor nearest the viewport center", () => {
    // 视口中心 600（scrollTop 400 + 半屏 200）→ m2 中心 600 命中
    expect(
      pickActiveChatRailAnchor(ANCHORS, {
        scrollTop: 400,
        clientHeight: 400,
        scrollHeight: 1600,
      }),
    ).toBe("m2");
  });

  it("picks the last anchor when scrolled to the bottom", () => {
    expect(
      pickActiveChatRailAnchor(ANCHORS, {
        scrollTop: 1200,
        clientHeight: 400,
        scrollHeight: 1600,
      }),
    ).toBe("m4");
  });

  it("returns null when content does not scroll", () => {
    expect(
      pickActiveChatRailAnchor(ANCHORS, {
        scrollTop: 0,
        clientHeight: 1600,
        scrollHeight: 1600,
      }),
    ).toBeNull();
  });
});

describe("computeRailThumb", () => {
  it("returns null when the content does not scroll", () => {
    expect(
      computeRailThumb({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 }),
    ).toBeNull();
  });

  it("sizes the thumb by viewport / content ratio", () => {
    const thumb = computeRailThumb({ scrollTop: 0, clientHeight: 400, scrollHeight: 1600 });
    expect(thumb?.size).toBeCloseTo(0.25, 10);
    expect(thumb?.top).toBe(0);
  });

  it("moves the thumb to the end when scrolled to the bottom", () => {
    const thumb = computeRailThumb({ scrollTop: 1200, clientHeight: 400, scrollHeight: 1600 });
    // top + size 应落在轨道末端
    expect((thumb?.top ?? 0) + (thumb?.size ?? 0)).toBeCloseTo(1, 10);
  });

  it("maps a mid scroll position proportionally", () => {
    const thumb = computeRailThumb({ scrollTop: 600, clientHeight: 400, scrollHeight: 1600 });
    expect(thumb?.top).toBeCloseTo(0.5 * (1 - 0.25), 10);
  });
});

describe("railThumbTopToScrollTop", () => {
  it("is the inverse of computeRailThumb", () => {
    const viewport = { clientHeight: 400, scrollHeight: 1600 };
    for (const scrollTop of [0, 300, 600, 900, 1200]) {
      const thumb = computeRailThumb({ ...viewport, scrollTop });
      expect(railThumbTopToScrollTop(thumb!.top, viewport)).toBeCloseTo(scrollTop, 6);
    }
  });

  it("clamps out-of-range thumb positions", () => {
    const viewport = { clientHeight: 400, scrollHeight: 1600 };
    expect(railThumbTopToScrollTop(-1, viewport)).toBe(0);
    expect(railThumbTopToScrollTop(2, viewport)).toBe(1200);
  });

  it("returns zero when the content does not scroll", () => {
    expect(railThumbTopToScrollTop(0.5, { clientHeight: 400, scrollHeight: 400 })).toBe(0);
  });
});
