import { describe, expect, it } from "vitest";
import {
  hasBehaviorUsageEvidenceInReply,
  hasUnfulfilledExplorePreamble,
  isEnumListingWithoutUsageReply,
  isSpeculativeBehaviorPurposeReply,
  shouldBlockBehaviorPurposeFinalize,
} from "./consultativeBehaviorTrace";

describe("consultativeBehaviorTrace", () => {
  it("detects speculative behavior-purpose replies", () => {
    expect(
      isSpeculativeBehaviorPurposeReply(
        "可能在某流程中作为状态标识。具体使用位置需要查看引用该枚举的方法。",
      ),
    ).toBe(true);
    expect(
      isSpeculativeBehaviorPurposeReply(
        "当 statusFlag 为 FlagFull 时，ProcessFooLogic 会把汇总 status 改为 1。",
      ),
    ).toBe(false);
  });

  it("detects unfulfilled explore preambles", () => {
    const reply =
      "让我在源代码中搜索类型的实际使用：\n\nFlagPartial=1 可能在流程中作为标识。";
    expect(hasUnfulfilledExplorePreamble(reply)).toBe(true);
  });

  it("detects enum listing without usage evidence", () => {
    const listing =
      "`FlagNone = 0` 无\n`FlagPartial = 1` 部分\n`FlagFull = 2` 全部\n用于区分三种类型。";
    expect(isEnumListingWithoutUsageReply(listing)).toBe(true);
    expect(
      isEnumListingWithoutUsageReply(
        "FlagPartial=1 时只改 amount；FlagFull=2 时把 status 改为已处理。",
      ),
    ).toBe(false);
  });

  it("detects usage evidence in replies", () => {
    expect(hasBehaviorUsageEvidenceInReply("if (statusFlag == FlagFull) 则更新汇总表 status。")).toBe(
      true,
    );
    expect(hasBehaviorUsageEvidenceInReply("共有三种枚举值。")).toBe(false);
  });

  it("shouldBlockBehaviorPurposeFinalize blocks shallow purpose answers", () => {
    const badReply =
      "FlagPartial = 1 部分，FlagFull = 2 全部。可能在流程中作为标识，具体使用位置需要查看。";
    expect(
      shouldBlockBehaviorPurposeFinalize({
        behaviorPurpose: true,
        consultativeReadPaths: ["foo/FooController.cs"],
        replyText: badReply,
      }),
    ).toBe(true);
    expect(
      shouldBlockBehaviorPurposeFinalize({
        behaviorPurpose: true,
        consultativeReadPaths: ["foo/FooController.cs", "foo/FooRecord.cs"],
        replyText: "FlagPartial 时 UpdateSummary 只改 amount；FlagFull 时 status 改为 1。",
      }),
    ).toBe(false);
    expect(
      shouldBlockBehaviorPurposeFinalize({
        behaviorPurpose: false,
        consultativeReadPaths: [],
        replyText: badReply,
      }),
    ).toBe(false);
  });
});
