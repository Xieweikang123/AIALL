import { describe, expect, it } from "vitest";
import {
  sanitizeUserVisibleAssistantText,
  stripConsultativeImplementOfferTail,
  stripVisionInternalMarkers,
} from "./agentVisibleText";

describe("agentVisibleText", () => {
  it("stripVisionInternalMarkers removes vision marker", () => {
    expect(stripVisionInternalMarkers("结论。[图已理解]")).toBe("结论。");
    expect(stripVisionInternalMarkers("[图已理解]结论")).toBe("结论");
  });

  it("stripConsultativeImplementOfferTail removes trailing implement offer", () => {
    expect(
      stripConsultativeImplementOfferTail("背景是实色。\n\n需要我调整弹窗背景颜色，让它更明显地区分于底部栏吗？"),
    ).toBe("背景是实色。");
  });

  it("sanitizeUserVisibleAssistantText applies both cleaners", () => {
    expect(
      sanitizeUserVisibleAssistantText(
        "根据代码不是透明。[图已理解]\n\n需要我调整颜色吗？",
      ),
    ).toBe("根据代码不是透明。");
  });
});
