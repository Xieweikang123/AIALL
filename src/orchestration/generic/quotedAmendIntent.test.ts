import { describe, expect, it } from "vitest";
import {
  detectTaskAnchorPolarity,
  expandQuotedAmendPrompt,
  isQuotedAmendPrompt,
  resolveQuotedAmendIntent,
} from "./quotedAmendIntent";

describe("resolveQuotedAmendIntent", () => {
  it("parses agent quote + 也移除 as remove scoped amend", () => {
    const prompt = "> Agent: scopeA：保留 `TargetSymbol`（说明）\n\n也移除";
    const resolved = resolveQuotedAmendIntent(prompt);
    expect(resolved).toMatchObject({
      kind: "remove",
      scopeHint: "scopeA",
      symbolHints: ["TargetSymbol"],
      amendBody: "也移除",
    });
  });

  it("parses code quote + 不要这个 as remove", () => {
    const prompt = [
      "> ConfigureBlock = new BlockType",
      "> {",
      ">     Handler = (a, b) => { b.Name = Transform(b.Name); }",
      "> }",
      "",
      "不要这个",
    ].join("\n");
    const resolved = resolveQuotedAmendIntent(prompt);
    expect(resolved?.kind).toBe("remove");
    expect(resolved?.symbolHints).toContain("ConfigureBlock");
  });

  it("returns ambiguous when remove intent lacks symbol hints", () => {
    const prompt = "> Agent: 已完成修改\n\n也移除";
    expect(resolveQuotedAmendIntent(prompt)).toMatchObject({ kind: "ambiguous" });
    expect(isQuotedAmendPrompt(prompt)).toBe(false);
  });

  it("returns null without quoted lines", () => {
    expect(resolveQuotedAmendIntent("也移除")).toBeNull();
  });
});

describe("expandQuotedAmendPrompt", () => {
  it("embeds remove operation markers for finish gate", () => {
    const prompt = "> Agent: scopeA：保留 `TargetSymbol`\n\n也移除";
    const resolved = resolveQuotedAmendIntent(prompt)!;
    const expanded = expandQuotedAmendPrompt(prompt, resolved);
    expect(expanded).toContain("操作：remove");
    expect(expanded).toContain("目标符号：TargetSymbol");
    expect(expanded).toContain("scope：scopeA");
    expect(detectTaskAnchorPolarity(expanded).polarity).toBe("must_exclude");
  });
});

describe("detectTaskAnchorPolarity", () => {
  it("detects must_exclude from expanded remove prompt", () => {
    const prompt = "> Agent: scopeA：保留 `TargetSymbol`\n\n也移除";
    const resolved = resolveQuotedAmendIntent(prompt)!;
    const expanded = expandQuotedAmendPrompt(prompt, resolved);
    expect(detectTaskAnchorPolarity(expanded)).toEqual({
      polarity: "must_exclude",
      excludeAnchors: ["TargetSymbol"],
    });
  });

  it("stays neutral for unrelated implement prompts", () => {
    expect(detectTaskAnchorPolarity("请改 `src/foo.ts` 里的常量")).toEqual({
      polarity: "neutral",
      excludeAnchors: [],
    });
  });
});
