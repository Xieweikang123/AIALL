import { describe, expect, it } from "vitest";
import { isRetryableAiError } from "../../server/aiForward";
import { compactMessagesForModel } from "../../server/vibeAgent";
import type { ChatCompletionMessage } from "../../server/aiForward";

describe("isRetryableAiError", () => {
  it("retries empty model responses", () => {
    expect(isRetryableAiError({ error: "模型返回为空" })).toBe(true);
  });
});

describe("compactMessagesForModel", () => {
  it("truncates oversized tool results", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "1", content: "x".repeat(20_000) },
    ];
    const compacted = compactMessagesForModel(messages);
    expect(compacted[2].content?.length || 0).toBeLessThan(20_000);
    expect(compacted[2].content).toContain("截断");
  });

  it("compresses older tool outputs when total context is too large", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "s".repeat(90_000) },
      { role: "user", content: "u".repeat(90_000) },
      { role: "tool", tool_call_id: "1", content: `// lines 1-200 of 9000\n${"a".repeat(60_000)}` },
      { role: "tool", tool_call_id: "2", content: `// lines 201-400 of 9000\n${"b".repeat(60_000)}` },
      { role: "tool", tool_call_id: "3", content: `// lines 401-600 of 9000\n${"c".repeat(60_000)}` },
    ];
    const compacted = compactMessagesForModel(messages);
    expect(compacted[2].content).toContain("已压缩");
    expect(compacted[3].content).toContain("lines 201-400");
    expect(compacted[4].content).toContain("lines 401-600");
  });
});
