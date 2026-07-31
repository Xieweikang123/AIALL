import { describe, expect, it } from "vitest";
import {
  hasConsultativeAccuracyTraceDepth,
  isDeferredBehaviorAnswerReply,
  isSpeculativeImplementationReply,
  shouldBlockConsultativeAccuracyFinalize,
} from "./consultativeAccuracyTrace";

describe("consultativeAccuracyTrace", () => {
  it("requires two distinct reads without assuming repository directories", () => {
    expect(
      hasConsultativeAccuracyTraceDepth([
        "ui/editor.ts",
        "api/handler.py",
      ]),
    ).toBe(true);
    expect(
      hasConsultativeAccuracyTraceDepth([
        "frontend/view.tsx",
        "frontend/client.ts",
      ]),
    ).toBe(true);
    expect(hasConsultativeAccuracyTraceDepth(["ui/editor.ts"])).toBe(false);
    expect(hasConsultativeAccuracyTraceDepth(["UI\\Editor.ts", "ui/editor.ts"])).toBe(false);
  });

  it("detects deferred behavior answers", () => {
    expect(isDeferredBehaviorAnswerReply("想让我深入看一下 prompt 的具体构造方式吗？")).toBe(true);
    expect(isDeferredBehaviorAnswerReply("好，基于已有信息直接回答你的问题。")).toBe(true);
    expect(isDeferredBehaviorAnswerReply("middleware 中已注入 staged diff。")).toBe(false);
  });

  it("detects speculative implementation replies", () => {
    const speculative =
      "如果 prompt 里包含了 git diff --staged 的实际变更内容，准确度会比较高。如果只是给文件名列表，容易泛泛而谈。";
    expect(isSpeculativeImplementationReply(speculative)).toBe(true);
    expect(
      isSpeculativeImplementationReply("prompt 已注入 staged diff 与文件列表（见 middleware L1804）。"),
    ).toBe(false);
  });

  it("shouldBlockConsultativeAccuracyFinalize blocks shallow trace and speculation", () => {
    const badReply =
      "好，基于已有信息直接回答。如果 prompt 包含 diff 则较准。想让我深入看一下 vibeGitClient.ts 吗？";
    expect(
      shouldBlockConsultativeAccuracyFinalize({
        accuracyConsultative: true,
        visionLocateToolsUsed: true,
        consultativeReadPaths: ["src/composables/useGitPanel.ts"],
        replyText: badReply,
      }),
    ).toBe(true);
    expect(
      shouldBlockConsultativeAccuracyFinalize({
        accuracyConsultative: true,
        visionLocateToolsUsed: true,
        consultativeReadPaths: [
          "src/composables/useGitPanel.ts",
          "src-tauri/src/agent/context.rs",
        ],
        replyText: "prompt 注入 staged diff 与文件状态列表，准确度取决于 diff 规模。",
      }),
    ).toBe(false);
    expect(
      shouldBlockConsultativeAccuracyFinalize({
        accuracyConsultative: false,
        visionLocateToolsUsed: true,
        consultativeReadPaths: [],
        replyText: badReply,
      }),
    ).toBe(false);
  });
});
