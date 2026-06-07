import { describe, expect, it } from "vitest";
import {
  buildModelIdentityHint,
  buildVisionTaskText,
  buildVisionUserContent,
  contentCharSize,
  contentDisplayText,
  isVisionUnsupportedError,
  sanitizeImageDataUrls,
} from "./visionMessage";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("visionMessage", () => {
  it("sanitizeImageDataUrls keeps only data:image URLs", () => {
    expect(sanitizeImageDataUrls(["http://x/a.png", PNG_DATA_URL, "data:text/plain,x"])).toEqual([PNG_DATA_URL]);
  });

  it("buildVisionUserContent returns plain text when no images", () => {
    expect(buildVisionUserContent("hello", [])).toBe("hello");
  });

  it("buildVisionUserContent builds multimodal parts with default text", () => {
    const content = buildVisionUserContent("", [PNG_DATA_URL]);
    expect(content).toEqual([
      { type: "text", text: expect.stringContaining("请描述并分析附带的图片") },
      { type: "image_url", image_url: { url: PNG_DATA_URL } },
    ]);
  });

  it("buildVisionTaskText prioritizes screenshot description for UI questions", () => {
    const text = buildVisionTaskText("你知道截图的是哪块内容吗？", 1);
    expect(text).toContain("附图为本消息重点");
    expect(text).toContain("不要跳过读图");
  });

  it("buildModelIdentityHint uses configured model id", () => {
    expect(buildModelIdentityHint("mimo-v2.5-pro")).toContain("mimo-v2.5-pro");
    expect(buildModelIdentityHint("mimo-v2.5-pro")).toContain("不要自称 Claude");
  });

  it("contentDisplayText hides base64 and shows image count", () => {
    const content = buildVisionUserContent("看看这个", [PNG_DATA_URL, PNG_DATA_URL]);
    expect(contentDisplayText(content)).toContain("看看这个");
    expect(contentDisplayText(content)).toContain("[附带 2 张图片]");
    expect(contentCharSize(content)).toBeGreaterThan("看看这个".length);
  });

  it("isVisionUnsupportedError detects common API errors", () => {
    expect(isVisionUnsupportedError("Model does not support image input")).toBe(true);
    expect(isVisionUnsupportedError("HTTP 500 internal error")).toBe(false);
  });
});
