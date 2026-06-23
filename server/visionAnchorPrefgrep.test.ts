import { describe, expect, it } from "vitest";
import {
  buildVisionConsultativeAutoGrepContinueHint,
  buildVisionConsultativeReadAfterPrefgrepHint,
  formatVisionAnchorPrefgrepBlock,
  isRuntimeVisibleTextGrepPattern,
  selectVisionAnchorGrepPatterns,
} from "./visionAnchorPrefgrep";
import {
  shouldBlockConsultativeVisionLocateFinalize,
  shouldRunVisionAnchorPrefgrep,
} from "./visionMessage";

describe("visionAnchorPrefgrep", () => {
  it("selectVisionAnchorGrepPatterns extracts full quote and CJK substrings", () => {
    const patterns = selectVisionAnchorGrepPatterns(["+ 新建"]);
    expect(patterns).toContain("+ 新建");
    expect(patterns).toContain("新建");
  });

  it("selectVisionAnchorGrepPatterns filters overly broad patterns", () => {
    const anchors = ["多会话同时进行，好实现吗？", "今天·14条"];
    expect(selectVisionAnchorGrepPatterns(anchors)).not.toContain("会话");
    expect(selectVisionAnchorGrepPatterns(anchors)).toContain("多会话同时进行，好实现吗？");
  });

  it("selectVisionAnchorGrepPatterns skips runtime label+count patterns", () => {
    expect(selectVisionAnchorGrepPatterns(["Git 30", "新建"])).not.toContain("Git 30");
    expect(selectVisionAnchorGrepPatterns(["Git 30", "新建"])).toContain("新建");
    expect(isRuntimeVisibleTextGrepPattern("Git 30")).toBe(true);
    expect(isRuntimeVisibleTextGrepPattern("30")).toBe(true);
  });

  it("formatVisionAnchorPrefgrepBlock summarizes matches", () => {
    const block = formatVisionAnchorPrefgrepBlock(["新建"], [
      { file: "D:/proj/src/Foo.vue", relative: "src/Foo.vue", line: 10, text: '<span>新建</span>' },
    ]);
    expect(block).toContain("【读图锚点·服务端 grep】");
    expect(block).toContain("src/Foo.vue:10:");
    expect(block).toContain("read_file");
  });

  it("formatVisionAnchorPrefgrepBlock handles empty matches", () => {
    const block = formatVisionAnchorPrefgrepBlock(["占位符文案"], []);
    expect(block).toContain("（无匹配）");
  });

  it("buildVisionConsultativeAutoGrepContinueHint differs for hit vs miss", () => {
    expect(buildVisionConsultativeAutoGrepContinueHint(true)).toContain("已预 grep");
    expect(buildVisionConsultativeAutoGrepContinueHint(false)).toContain("无命中");
  });

  it("shouldRunVisionAnchorPrefgrep requires consultative locate with anchors", () => {
    expect(
      shouldRunVisionAnchorPrefgrep({
        consultativeVisionRun: true,
        prompt: "知道是哪儿的按钮吗？",
        anchorQuotes: ["+ 新建"],
      }),
    ).toBe(true);
    expect(
      shouldRunVisionAnchorPrefgrep({
        consultativeVisionRun: true,
        prompt: "ai生成注释准确吗？",
        anchorQuotes: ["AI 生成"],
      }),
    ).toBe(true);
    expect(
      shouldRunVisionAnchorPrefgrep({
        consultativeVisionRun: true,
        prompt: "帮我把按钮改小",
        anchorQuotes: ["+ 新建"],
      }),
    ).toBe(false);
    expect(
      shouldRunVisionAnchorPrefgrep({
        consultativeVisionRun: false,
        prompt: "知道是哪儿的按钮吗？",
        anchorQuotes: ["+ 新建"],
      }),
    ).toBe(false);
  });

  it("shouldBlockConsultativeVisionLocateFinalize requires read after auto grep hits", () => {
    expect(
      shouldBlockConsultativeVisionLocateFinalize({
        consultativeVisionRun: true,
        visionLocateActive: true,
        visionLocateToolsUsed: true,
        visionAutoGrepHadMatches: true,
        visionLocateReadUsed: false,
        prompt: "知道是哪儿的按钮吗？",
        replyText: "可能在 FilePanel.vue。",
      }),
    ).toBe(true);
    expect(
      shouldBlockConsultativeVisionLocateFinalize({
        consultativeVisionRun: true,
        visionLocateActive: true,
        visionLocateToolsUsed: true,
        visionAutoGrepHadMatches: true,
        visionLocateReadUsed: true,
        prompt: "知道是哪儿的按钮吗？",
        replyText: "位于 src/Foo.vue 的 session-action-btn。",
      }),
    ).toBe(false);
  });

  it("buildVisionConsultativeReadAfterPrefgrepHint mentions hit files", () => {
    const hint = buildVisionConsultativeReadAfterPrefgrepHint(["src/Foo.vue", "src/Bar.vue"]);
    expect(hint).toContain("read_file");
    expect(hint).toContain("src/Foo.vue");
  });
});
