import { describe, expect, it } from "vitest";
import {
  checkOverlappingRead,
  checkPatchOldStringFromReads,
  claimsPrematureCompletion,
  claimsSuccessDespitePatchFailures,
  shouldNudgeAlternateUiPatchStrategy,
  consumePatchRecoveryRead,
  invalidateFileReadState,
  isAnalysisOnlyReplyUnderForcePatch,
  isBlockedGrepAfterLocate,
  isBlockedGrepAfterVisionMisread,
  isEmptyOrInsufficientFinalReply,
  isToolResultFailure,
  isLowSignalVisionLocateGrep,
  isOverlyBroadVisionGrep,
  isSearchFilesContentQuery,
  isVisionGrepLowSpread,
  isSystemRuntimeToolFailure,
  isRuntimeExploreFailureTurn,
  readLineRangeFromArgs,
  readRangesOverlap,
  recordReadRange,
  sanitizeAgentUserVisibleText,
  shouldForcePatchAfterAnchorLocated,
  shouldNudgeEnglishPlanning,
  textConfirmsTeleportToBody,
  textIndicatesPatchAnchor,
  type ToolGuardContext,
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
    expect(
      isAnalysisOnlyReplyUnderForcePatch("明白了——下一步我会只执行代码修改"),
    ).toBe(true);
    expect(
      isAnalysisOnlyReplyUnderForcePatch("需要我实际执行这些修改吗？请确认优先级。"),
    ).toBe(true);
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

  it("allows short UI copy when present in vision narrative", () => {
    const anchors = ["项目切换栏"];
    const narrative = ["底部有虚线边框的「打开新项目」按钮"];
    expect(isOverlyBroadVisionGrep("打开新项目", anchors, narrative)).toBe(false);
    expect(isOverlyBroadVisionGrep("打开新项目", anchors)).toBe(true);
  });

  it("isVisionGrepLowSpread accepts selective match sets", () => {
    expect(isVisionGrepLowSpread([{ relative: "src/Foo.vue" }])).toBe(true);
    expect(
      isVisionGrepLowSpread([
        { relative: "src/Foo.vue" },
        { relative: "src/Foo.vue" },
        { relative: "src/Bar.vue" },
      ]),
    ).toBe(true);
    expect(
      isVisionGrepLowSpread(
        Array.from({ length: 10 }, (_, i) => ({ relative: `src/f${i}.ts` })),
      ),
    ).toBe(false);
  });

  it("blocks low-signal vision locate grep patterns", () => {
    expect(isLowSignalVisionLocateGrep("activeTab")).toBe(true);
    expect(isLowSignalVisionLocateGrep("selectedIndex")).toBe(true);
    expect(isLowSignalVisionLocateGrep("file-panel-tab")).toBe(false);
    expect(isLowSignalVisionLocateGrep("git-badge")).toBe(false);
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

  it("detects premature completion claims", () => {
    expect(claimsPrematureCompletion("检查完成，所有修改都正确无误 ✅")).toBe(true);
    expect(claimsPrematureCompletion("无需再改，链路完整")).toBe(true);
    expect(claimsPrematureCompletion("结论：当前代码没有 bug，无需修改")).toBe(true);
    expect(claimsPrematureCompletion("代码逻辑和 DOM 结构审查结果如下，应正常工作")).toBe(true);
    expect(claimsPrematureCompletion("已修复 foo.ts，改动如下")).toBe(false);
  });

  it("detects success claims despite patch failures", () => {
    expect(claimsSuccessDespitePatchFailures("✅ 两处修改已完成", 1)).toBe(true);
    expect(claimsSuccessDespitePatchFailures("结论：当前代码没有 bug", 2)).toBe(true);
    expect(claimsSuccessDespitePatchFailures("全部修改项均已 patch 成功，无失败项。", 1)).toBe(true);
    expect(claimsSuccessDespitePatchFailures("仍需 read 后再 patch", 1)).toBe(false);
    expect(claimsSuccessDespitePatchFailures("✅ 修复完成", 0)).toBe(false);
  });

  it("nudges alternate UI patch strategy after repeated failures on same file", () => {
    const log = [
      { path: "src/foo.vue", reason: "old_string 未出现在已读片段中" },
      { path: "src/foo.vue", reason: "old_string 未匹配" },
    ];
    expect(shouldNudgeAlternateUiPatchStrategy(log, "src/foo.vue")).toBe(true);
    expect(shouldNudgeAlternateUiPatchStrategy(log.slice(0, 1), "src/foo.vue")).toBe(false);
  });

  it("invalidates read caches and allows patch recovery re-read", () => {
    const readSliceCache = new Map<string, string>([["src/foo.ts:1:50", "cached"]]);
    const readSliceRepeatCounts = new Map<string, number>([["src/foo.ts:1:50", 2]]);
    const readFileRanges = new Map<string, ReturnType<typeof readLineRangeFromArgs>[]>([
      ["src/foo.ts", [readLineRangeFromArgs(1, 50)]],
    ]);
    const toolGuard: ToolGuardContext = {
      readFileRanges,
      patchRecoveryFiles: new Set(["src/foo.ts"]),
    } as ToolGuardContext;

    invalidateFileReadState("src/foo.ts", readSliceCache, readSliceRepeatCounts, readFileRanges);
    expect(readSliceCache.size).toBe(0);
    expect(readSliceRepeatCounts.size).toBe(0);
    expect(readFileRanges.has("src/foo.ts")).toBe(false);

    expect(consumePatchRecoveryRead(toolGuard, "src/foo.ts")).toBe(true);
    expect(toolGuard.patchRecoveryFiles?.has("src/foo.ts")).toBe(false);
  });

  it("detects empty or insufficient final replies", () => {
    expect(isEmptyOrInsufficientFinalReply("")).toBe(true);
    expect(isEmptyOrInsufficientFinalReply("  ")).toBe(true);
    expect(isEmptyOrInsufficientFinalReply("好的，已完成修改并说明测试步骤。")).toBe(false);
  });

  it("detects tool result failure prefixes", () => {
    expect(isToolResultFailure("错误：文件不存在")).toBe(true);
    expect(isToolResultFailure("命令执行失败：\nstderr: foo")).toBe(true);
    expect(isToolResultFailure("stdout:\nok")).toBe(false);
  });

  it("distinguishes runtime tool failures from guard failures", () => {
    expect(isSystemRuntimeToolFailure("错误：isVisionGrepLowSpread is not defined")).toBe(true);
    expect(isSystemRuntimeToolFailure("命令执行失败：\nstderr: boom")).toBe(true);
    expect(isSystemRuntimeToolFailure("错误：grep「foo」过宽，易扫出大量无关命中。")).toBe(false);
    expect(isSystemRuntimeToolFailure("错误：缺少 pattern")).toBe(false);
  });

  it("detects runtime explore failure turns", () => {
    expect(
      isRuntimeExploreFailureTurn([{ result: "错误：is not defined" }]),
    ).toBe(true);
    expect(
      isRuntimeExploreFailureTurn([{ result: "错误：grep「x」过宽，易扫出大量无关命中。" }]),
    ).toBe(false);
    expect(
      isRuntimeExploreFailureTurn([
        { result: "错误：is not defined" },
        { result: "src/foo.ts:1: match" },
      ]),
    ).toBe(false);
  });
});
