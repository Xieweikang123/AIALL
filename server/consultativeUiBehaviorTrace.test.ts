import { describe, expect, it } from "vitest";
import {
  buildConsultativeUiBehaviorTraceRetryHint,
  isShallowStateIndependenceClaim,
  isUiStateBehaviorQuestion,
  replyClaimsCodeWithoutToolEvidence,
  shouldBlockConsultativeUiBehaviorFinalize,
} from "./consultativeUiBehaviorTrace";

describe("consultativeUiBehaviorTrace", () => {
  it("detects UI state behavior questions by shape", () => {
    expect(isUiStateBehaviorQuestion("切到 foo 再切回，bar 还会再次打开吗？")).toBe(true);
    expect(isUiStateBehaviorQuestion("explain foo.ts")).toBe(false);
  });

  it("blocks code citations without successful reads", () => {
    expect(
      replyClaimsCodeWithoutToolEvidence(
        "根据代码分析，`src/components/foo.vue` 第 75 行不会自动打开。",
        [],
        false,
      ),
    ).toBe(true);
    expect(
      replyClaimsCodeWithoutToolEvidence(
        "根据 read 结果，watch 会 collapse。",
        ["src/views/FooView.vue"],
        true,
      ),
    ).toBe(false);
  });

  it("blocks shallow independence claims after partial view read", () => {
    expect(
      isShallowStateIndependenceClaim(
        "modeA 与 modeB 是两个独立状态，切换 tab 只改 modeA，不会触动 modeB，因此仍然是展开的。",
        ["src/views/FooView.vue"],
        ["modeA"],
      ),
    ).toBe(true);
    expect(
      isShallowStateIndependenceClaim(
        "watch modeA 时会调用 collapsePanel()。",
        ["src/views/FooView.vue"],
        ["modeA", "collapsePanel"],
      ),
    ).toBe(false);
  });

  it("shouldBlockConsultativeUiBehaviorFinalize for unread hallucinated paths", () => {
    expect(
      shouldBlockConsultativeUiBehaviorFinalize({
        readOnlyBuildRun: true,
        prompt: "切到 bar 再切回，panel 还会再次打开吗？",
        replyText: "查阅了 `src/missing.vue`，不会再次打开。",
        consultativeReadPaths: [],
        consultativeReadFailedPaths: ["src/missing.vue"],
        visionLocateToolsUsed: false,
      }),
    ).toBe(true);
  });

  it("builds retry hint with failed paths", () => {
    const hint = buildConsultativeUiBehaviorTraceRetryHint([], ["src/missing.vue"]);
    expect(hint).toContain("read 失败");
    expect(hint).toContain("禁止继续引用");
  });
});
