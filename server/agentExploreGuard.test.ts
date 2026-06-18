import { describe, expect, it } from "vitest";
import {
  checkOverlappingRead,
  checkPatchOldStringFromReads,
  isAnalysisOnlyReplyUnderForcePatch,
  isBlockedGrepAfterLocate,
  isBlockedGrepAfterVisionMisread,
  isOverlyBroadVisionGrep,
  isSearchFilesContentQuery,
  readLineRangeFromArgs,
  readRangesOverlap,
  recordReadRange,
  sanitizeAgentUserVisibleText,
  shouldForcePatchAfterAnchorLocated,
  shouldNudgeEnglishPlanning,
  textConfirmsTeleportToBody,
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
    expect(textIndicatesPatchAnchor(".token-detail-popover { position: absolute; }")).toBe(false);
    expect(textIndicatesPatchAnchor(".project-memory-overlay { }")).toBe(false);
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

  it("dedupes repeated planning clauses", () => {
    expect(sanitizeAgentUserVisibleText("让我看看定位逻辑。。让我看看定位逻辑。")).toBe("让我看看定位逻辑。");
  });

  it("confirms Teleport to body from file content", () => {
    expect(textConfirmsTeleportToBody('<Teleport to="body">')).toBe(true);
    expect(textConfirmsTeleportToBody("<div>no teleport</div>")).toBe(false);
  });

  it("blocks transform grep after anchor or Teleport confirmed", () => {
    expect(isBlockedGrepAfterLocate("transform", false, true)).toBe(true);
    expect(isBlockedGrepAfterLocate("chat-action-row", true, false)).toBe(true);
    expect(isBlockedGrepAfterLocate("quote-floating", true, false)).toBe(false);
  });

  it("detects analysis-only reply under force-patch", () => {
    const analysis =
      "核心问题：getSelectionAnchorRect 坐标异常，getClientRects 可能不对 [图已理解]";
    expect(isAnalysisOnlyReplyUnderForcePatch(analysis)).toBe(true);
    expect(isAnalysisOnlyReplyUnderForcePatch("已修复 getSelectionAnchorRect，改动如下：…")).toBe(false);
    expect(isAnalysisOnlyReplyUnderForcePatch("请将这两处修改应用到 src/views/VibeCodingView.vue")).toBe(true);
  });

  it("force-patch when anchor located and pending", () => {
    expect(shouldForcePatchAfterAnchorLocated(true, true, false)).toBe(true);
    expect(shouldForcePatchAfterAnchorLocated(true, false, true)).toBe(true);
    expect(shouldForcePatchAfterAnchorLocated(true, false, false)).toBe(false);
    expect(shouldForcePatchAfterAnchorLocated(false, true, true)).toBe(false);
  });

  it("force-patch on implement follow-up even before tool anchor in this run", () => {
    expect(shouldForcePatchAfterAnchorLocated(false, true, false, true)).toBe(true);
  });

  it("blocks overly broad vision grep when anchors exist", () => {
    const anchors = ["多会话同时进行，好实现吗？", "今天·14条"];
    expect(isOverlyBroadVisionGrep("会话", anchors)).toBe(true);
    expect(isOverlyBroadVisionGrep("多会话同时进行", anchors)).toBe(false);
    expect(isOverlyBroadVisionGrep("session-item", anchors)).toBe(false);
  });

  it("detects search_files queries that look like UI copy not filenames", () => {
    expect(isSearchFilesContentQuery("会话列表")).toBe(true);
    expect(isSearchFilesContentQuery("SessionList.vue")).toBe(false);
    expect(isSearchFilesContentQuery("file-panel")).toBe(false);
  });

  it("requires patch old_string to appear in prior read slices", () => {
    const slices = new Map<string, string>([
      ["src/foo.ts:1:200", ".real { color: red; }\n"],
    ]);
    expect(checkPatchOldStringFromReads("src/foo.ts", ".real { color: red; }", slices)).toBeNull();
    expect(checkPatchOldStringFromReads("src/foo.ts", ".fake { gap: 1px; }", slices)).toMatch(
      /未出现在你对 src\/foo.ts 的已读片段中/,
    );
  });
});
