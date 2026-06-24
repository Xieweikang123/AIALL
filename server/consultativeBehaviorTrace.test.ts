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
        "可能在售后、退款流程中作为状态标识。具体使用位置需要查看引用该枚举的方法。",
      ),
    ).toBe(true);
    expect(
      isSpeculativeBehaviorPurposeReply(
        "当 refundType 为 FullRefund 时，ProcessWorkOrderSpecialLogic 会把订单汇总 status 改为 1。",
      ),
    ).toBe(false);
  });

  it("detects unfulfilled explore preambles", () => {
    const reply =
      "让我在源代码文件中搜索退款类型的实际使用：\n\nPartialRefund=1 部分退款，可能在流程中作为标识。";
    expect(hasUnfulfilledExplorePreamble(reply)).toBe(true);
  });

  it("detects enum listing without usage evidence", () => {
    const listing =
      "`NoRefund = 0` 无退款\n`PartialRefund = 1` 部分退款\n`FullRefund = 2` 全部退款\n用于区分三种退款类型。";
    expect(isEnumListingWithoutUsageReply(listing)).toBe(true);
    expect(
      isEnumListingWithoutUsageReply(
        "PartialRefund=1 时只改 orderAmount；FullRefund=2 时把 status 改为已退款。",
      ),
    ).toBe(false);
  });

  it("detects usage evidence in replies", () => {
    expect(hasBehaviorUsageEvidenceInReply("if (refundType == FullRefund) 则更新汇总表 status。")).toBe(
      true,
    );
    expect(hasBehaviorUsageEvidenceInReply("共有三种枚举值。")).toBe(false);
  });

  it("shouldBlockBehaviorPurposeFinalize blocks shallow purpose answers", () => {
    const badReply =
      "PartialRefund = 1 部分退款，FullRefund = 2 全部退款。可能在流程中作为标识，具体使用位置需要查看。";
    expect(
      shouldBlockBehaviorPurposeFinalize({
        behaviorPurpose: true,
        consultativeReadPaths: ["foo/WorkOrderController.cs"],
        replyText: badReply,
      }),
    ).toBe(true);
    expect(
      shouldBlockBehaviorPurposeFinalize({
        behaviorPurpose: true,
        consultativeReadPaths: ["foo/WorkOrderController.cs", "foo/WorkOrder.cs"],
        replyText:
          "PartialRefund 时 UpdateCustomerOrderSummary 只改 orderAmount；FullRefund 时 status 改为 1。",
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
