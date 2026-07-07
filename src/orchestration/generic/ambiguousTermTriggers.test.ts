import { describe, expect, it } from "vitest";
import {
  extractUngroundedAmbiguousTerms,
  hasRecentAmbiguityClarificationOffer,
  isSparseProjectContext,
  looksLikeClarificationQuestion,
  looksLikePrematurePlanOrScaffold,
  resolveAmbiguousClarificationTerms,
  userPromptSelfDisambiguates,
} from "./ambiguousTermTriggers";

const emptyContext = { ok: true as const, tree: "", keyFiles: [] as Array<{ path: string; content: string }> };

describe("ambiguousTermTriggers", () => {
  it("detects sparse project context", () => {
    expect(isSparseProjectContext(emptyContext)).toBe(true);
    expect(
      isSparseProjectContext({
        ok: true,
        stackProfile: { manifestFiles: ["package.json"], frameworks: ["vue3"] },
      }),
    ).toBe(false);
    expect(
      isSparseProjectContext({
        ok: true,
        tree: "[dir] src\n  App.vue",
        keyFiles: [{ path: "package.json", content: "{}" }],
      }),
    ).toBe(false);
  });

  it("extracts recipient phrase terms not grounded in repo", () => {
    const terms = extractUngroundedAmbiguousTerms("写一个服务，给 foo 调用", emptyContext);
    expect(terms).toContain("foo");
  });

  it("ignores known stack tokens and generic stopwords", () => {
    expect(extractUngroundedAmbiguousTerms("写一个 .net WebAPI 项目", emptyContext)).toEqual([]);
    expect(extractUngroundedAmbiguousTerms("给后端服务提供接口", emptyContext)).toEqual([]);
  });

  it("skips when user self-disambiguates", () => {
    expect(
      userPromptSelfDisambiguates("foo 指的是外部调度系统，写一个 API"),
    ).toBe(true);
  });

  it("extracts short recipient terms from compact Chinese prompts", () => {
    const terms = extractUngroundedAmbiguousTerms(
      "写一个.net 项目，用于起 webapi，给三维调用",
      emptyContext,
    );
    expect(terms).toContain("三维");
  });

  it("requires clarification on sparse repo with ungrounded term", () => {
    const terms = resolveAmbiguousClarificationTerms({
      prompt: "写一个 net 项目起 webapi，给 bar 调用",
      projectContext: emptyContext,
      mode: "plan",
      isExecutePlan: false,
      isPlanExplore: true,
      readOnlyBuildRun: false,
      implementFollowUpRun: false,
    });
    expect(terms).toContain("bar");
  });

  it("skips after assistant already asked about the term", () => {
    const terms = resolveAmbiguousClarificationTerms({
      prompt: "给 bar 调用",
      history: [
        { role: "assistant", content: "请确认 bar 是指外部系统还是前端模块？" },
      ],
      projectContext: emptyContext,
      mode: "plan",
      isExecutePlan: false,
      isPlanExplore: true,
      readOnlyBuildRun: false,
      implementFollowUpRun: false,
    });
    expect(terms).toEqual([]);
    expect(
      hasRecentAmbiguityClarificationOffer(
        [{ role: "assistant", content: "请确认 bar 是指哪种系统？" }],
        ["bar"],
      ),
    ).toBe(true);
  });

  it("skips plan quote revision follow-ups", () => {
    const terms = resolveAmbiguousClarificationTerms({
      prompt: "> 方案: GET /api/foo\n\n这个不要",
      projectContext: emptyContext,
      mode: "plan",
      isExecutePlan: false,
      isPlanExplore: true,
      readOnlyBuildRun: false,
      implementFollowUpRun: false,
    });
    expect(terms).toEqual([]);
  });

  it("detects premature plan/scaffold output", () => {
    expect(looksLikePrematurePlanOrScaffold("## 修改方案\n\n### 需求概述")).toBe(true);
    expect(looksLikePrematurePlanOrScaffold("请确认 foo 是指哪种系统？")).toBe(false);
  });

  it("detects clarification questions", () => {
    expect(
      looksLikeClarificationQuestion("请确认 foo 是指外部系统还是三维可视化前端？"),
    ).toBe(true);
    expect(looksLikeClarificationQuestion("## 修改方案\nfoo 项目")).toBe(false);
  });
});
