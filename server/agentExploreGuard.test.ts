import { describe, expect, it } from "vitest";
import {
  checkOverlappingRead,
  isAnalysisOnlyReplyUnderForcePatch,
  isBlockedGrepAfterVisionMisread,
  readLineRangeFromArgs,
  readRangesOverlap,
  recordReadRange,
  sanitizeAgentUserVisibleText,
  shouldForcePatchAfterAnchorLocated,
  shouldNudgeEnglishPlanning,
  textIndicatesPatchAnchor,
} from "./agentExploreGuard";

describe("agentExploreGuard", () => {
  it("detects overlapping read windows on the same file", () => {
    const a = readLineRangeFromArgs(1270, 30);
    const b = readLineRangeFromArgs(1270, 80);
    expect(readRangesOverlap(a, b)).toBe(true);

    const ranges = new Map<string, ReturnType<typeof readLineRangeFromArgs>[]>();
    recordReadRange("src/foo.ts", a, ranges);
    recordReadRange("src/foo.ts", b, ranges);
    const err = checkOverlappingRead("src/foo.ts", readLineRangeFromArgs(1280, 40), ranges);
    expect(err).toMatch(/高度重叠/);
  });

  it("detects patch anchor symbols in tool output", () => {
    expect(textIndicatesPatchAnchor("async function showQuoteButtonAt(anchor: DOMRect)")).toBe(true);
    expect(textIndicatesPatchAnchor(".quote-floating { position: fixed; }")).toBe(true);
    expect(textIndicatesPatchAnchor("export function unrelated()")).toBe(false);
  });

  it("blocks misleading grep after vision misread", () => {
    expect(isBlockedGrepAfterVisionMisread("chat-action-row|chat-status-row", true)).toBe(true);
    expect(isBlockedGrepAfterVisionMisread("quote-floating", true)).toBe(false);
    expect(isBlockedGrepAfterVisionMisread("chat-action-row", false)).toBe(false);
  });

  it("nudges English-only planning preambles", () => {
    expect(shouldNudgeEnglishPlanning("Now let me check the template")).toBe(true);
    expect(shouldNudgeEnglishPlanning("让我查看定位逻辑")).toBe(false);
  });

  it("strips vision marker from user-visible text", () => {
    expect(sanitizeAgentUserVisibleText("分析完毕 [图已理解]")).toBe("分析完毕");
  });

  it("detects analysis-only reply under force-patch", () => {
    const analysis =
      "核心问题：getSelectionAnchorRect 坐标异常，getClientRects 可能不对 [图已理解]";
    expect(isAnalysisOnlyReplyUnderForcePatch(analysis)).toBe(true);
    expect(isAnalysisOnlyReplyUnderForcePatch("已修复 getSelectionAnchorRect，改动如下：…")).toBe(false);
  });

  it("force-patch when anchor located and pending", () => {
    expect(shouldForcePatchAfterAnchorLocated(true, true, false)).toBe(true);
    expect(shouldForcePatchAfterAnchorLocated(true, false, true)).toBe(true);
    expect(shouldForcePatchAfterAnchorLocated(true, false, false)).toBe(false);
    expect(shouldForcePatchAfterAnchorLocated(false, true, true)).toBe(false);
  });
});
