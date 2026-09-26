import { describe, expect, it } from "vitest";
import {
  FALLBACK_CONTEXT_TOKENS,
  lookupReportedModelWindow,
  normalizeModelId,
  parseContextWindowFromError,
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

  // 回归：曾用一条裸 `deepseek` 前缀把所有代次都按 64K 算，于是 deepseek-v4.1-flash
  // （官方 1M）显示成 64K —— 分母小了 16 倍。细粒度条目必须先于裸前缀命中。
  it("prefers a generation-specific entry over the bare vendor prefix", () => {
    expect(resolveContextWindowTokens("deepseek-v4.1-flash", undefined).tokens).toBe(1_000_000);
    expect(resolveContextWindowTokens("deepseek-v4.1-flash:cloud", undefined).tokens).toBe(1_000_000);
    expect(resolveContextWindowTokens("deepseek-v4-flash", undefined).tokens).toBe(1_000_000);
    // 老代次仍按各自的窗口走，不能被新代次的条目顺带带偏
    expect(resolveContextWindowTokens("deepseek-v3.2", undefined).tokens).toBe(128_000);
    expect(resolveContextWindowTokens("deepseek-chat", undefined).tokens).toBe(64_000);
    // 未列出的 deepseek 仍落到裸前缀兜底，而不是某个具体代次
    expect(resolveContextWindowTokens("deepseek-some-future", undefined).tokens).toBe(64_000);
  });

  it("keeps prefix length ordering independent of declaration order", () => {
    // `gpt-4.1` 必须赢过 `gpt-4`，`claude-3-5` 必须赢过 `claude-3`。
    // 断言的是"最长前缀优先"这个行为，不是具体数值 —— 数值随官方调整会变。
    expect(staticContextWindowForModel("gpt-4.1")).not.toBe(staticContextWindowForModel("gpt-4"));
    expect(staticContextWindowForModel("claude-3-5-sonnet")).toBe(staticContextWindowForModel("claude-3-7"));
  });

  it("strips a provider/routing prefix before matching", () => {
    // 断的是"前缀剥掉后仍能命中"这个行为，不是具体数值 ——
    // 表里的数会随官方调整，用 claude（各代同值）避免这条测试被无关改动弄红。
    expect(staticContextWindowForModel("openai/gpt-4.1")).not.toBeUndefined();
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

describe("parseContextWindowInput", () => {  it("parses plain digits", () => {
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

describe("normalizeModelId", () => {
  it("lowercases and strips the provider/routing prefix", () => {
    expect(normalizeModelId("  OpenAI/GPT-4o ")).toBe("gpt-4o");
  });

  it("keeps a bare id as-is (lowercased)", () => {
    expect(normalizeModelId("DeepSeek-Chat")).toBe("deepseek-chat");
  });
});

describe("lookupReportedModelWindow", () => {
  // 回归：这张表的 key 是 /models 返回的原始 id，用户填的可能是别名 / 带前缀 / 大小写不同。
  // 之前 VibeCodingView 的 modelWindowForLabel 用 `?.[model]` 精确取值，
  // 对不上就静默退回内置表估算 —— 明明抓到了真值却当分母显示猜的数。
  it("matches exactly first, then by normalized id", () => {
    const windows = { "openai/gpt-4o": 128_000 };
    expect(lookupReportedModelWindow(windows, "openai/gpt-4o")).toBe(128_000);
    expect(lookupReportedModelWindow(windows, "gpt-4o")).toBe(128_000);
    expect(lookupReportedModelWindow(windows, "OpenAI/GPT-4o")).toBe(128_000);
  });

  it("prefers the exact key over a normalized collision", () => {
    // 两个不同模型归一化后撞名：精确命中必须赢，否则会串到别的模型头上。
    const windows = { "vendor-a/gpt-4o": 65_536, "vendor-b/gpt-4o": 200_000 };
    expect(lookupReportedModelWindow(windows, "vendor-b/gpt-4o")).toBe(200_000);
    expect(lookupReportedModelWindow(windows, "gpt-4o")).toBe(65_536);
  });

  it("returns undefined for missing / empty input", () => {
    expect(lookupReportedModelWindow({ "gpt-4o": 128_000 }, "claude-3")).toBeUndefined();
    expect(lookupReportedModelWindow(undefined, "gpt-4o")).toBeUndefined();
    expect(lookupReportedModelWindow({ "gpt-4o": 128_000 }, "  ")).toBeUndefined();
  });

  it("skips non-positive stored values", () => {
    expect(lookupReportedModelWindow({ "gpt-4o": 0 }, "gpt-4o")).toBeUndefined();
    expect(lookupReportedModelWindow({ "gpt-4o": -1 }, "gpt-4o")).toBeUndefined();
  });
});

describe("parseContextWindowFromError", () => {
  // 官方接口的 /models 不报窗口，唯一能拿到真值的途径就是从超窗报错里抠。
  // 下面每条都是 provider 真实报过的措辞形态。
  it("reads the OpenAI/DeepSeek style limit", () => {
    expect(
      parseContextWindowFromError(
        "This model's maximum context length is 128000 tokens. However, your messages resulted in 132041 tokens.",
      ),
    ).toBe(128_000);
  });

  it("takes the SECOND number in the Anthropic style (first is the request size)", () => {
    expect(
      parseContextWindowFromError("prompt is too long: 210000 tokens > 200000 maximum"),
    ).toBe(200_000);
  });

  it("tolerates comma separators and 'of' phrasing", () => {
    expect(parseContextWindowFromError("max context length of 131,072 exceeded")).toBe(131_072);
  });

  it("returns undefined when the error is unrelated", () => {
    expect(parseContextWindowFromError("Request failed: HTTP 401, invalid api key")).toBeUndefined();
    expect(parseContextWindowFromError("")).toBeUndefined();
  });

  // 误报比漏报更糟：抓错一个数会被当成真值存下来，比保留内置表估算更坏。
  it("does not invent a window from unrelated numbers", () => {
    expect(parseContextWindowFromError("rate limit exceeded, retry after 30 seconds")).toBeUndefined();
    expect(parseContextWindowFromError("max_tokens: 2000")).toBeUndefined();
  });
});
