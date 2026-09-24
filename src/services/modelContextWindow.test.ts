import { describe, expect, it } from "vitest";
import {
  FALLBACK_CONTEXT_TOKENS,
  parseContextWindowInput,
  resolveContextWindowTokens,
  staticContextWindowForModel,
} from "./modelContextWindow";

describe("resolveContextWindowTokens", () => {
  it("prefers a manual override over everything", () => {
    const result = resolveContextWindowTokens("gpt-4o", 65_536, 1_000_000);
    expect(result.tokens).toBe(1_000_000);
    expect(result.source).toBe("override");
  });

  it("prefers a provider-reported window over the static table", () => {
    const result = resolveContextWindowTokens("gpt-4o", 65_536);
    expect(result.tokens).toBe(65_536);
    expect(result.source).toBe("reported");
  });

  it("falls back to the static table by model prefix", () => {
    const result = resolveContextWindowTokens("deepseek-chat", undefined);
    expect(result.tokens).toBe(64_000);
    expect(result.source).toBe("static");
  });

  it("strips a provider/routing prefix before matching", () => {
    expect(staticContextWindowForModel("openai/gpt-4o")).toBe(128_000);
    expect(staticContextWindowForModel("anthropic/claude-3-5-sonnet")).toBe(200_000);
  });

  it("uses the conservative fallback for unknown models", () => {
    const result = resolveContextWindowTokens("totally-unknown-model", undefined);
    expect(result.tokens).toBe(FALLBACK_CONTEXT_TOKENS);
    expect(result.source).toBe("fallback");
  });

  it("ignores a non-positive reported value", () => {
    expect(resolveContextWindowTokens("gpt-4o", 0).source).toBe("static");
  });
});

describe("parseContextWindowInput", () => {
  it("parses plain digits", () => {
    expect(parseContextWindowInput("1000000")).toBe(1_000_000);
  });

  it("parses k / m shorthand", () => {
    expect(parseContextWindowInput("128k")).toBe(128_000);
    expect(parseContextWindowInput("1m")).toBe(1_000_000);
    expect(parseContextWindowInput("1.5m")).toBe(1_500_000);
  });

  it("tolerates separators and case", () => {
    expect(parseContextWindowInput(" 128,000 ")).toBe(128_000);
    expect(parseContextWindowInput("200K")).toBe(200_000);
  });

  it("rejects empty or invalid input", () => {
    expect(parseContextWindowInput("")).toBeUndefined();
    expect(parseContextWindowInput("abc")).toBeUndefined();
    expect(parseContextWindowInput("0")).toBeUndefined();
    expect(parseContextWindowInput("-5")).toBeUndefined();
  });
});
