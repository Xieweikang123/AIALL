import { describe, expect, it } from "vitest";
import { isRetryableAiError, MODEL_FIRST_BYTE_TIMEOUT_MS } from "../../server/aiForward";
import { compactMessagesForModel, EXECUTE_PLAN_MAX_CONTEXT_CHARS } from "../../server/vibeAgent";
import type { ChatCompletionMessage } from "../../server/aiForward";

describe("isRetryableAiError", () => {
  it("retries empty model responses", () => {
    expect(isRetryableAiError({ error: "模型返回为空" })).toBe(true);
  });

  it("retries first-byte model timeouts", () => {
    expect(isRetryableAiError({ error: "模型响应超时（等待首包超过 60s）" })).toBe(true);
  });
});

describe("MODEL_FIRST_BYTE_TIMEOUT_MS", () => {
  it("caps first-byte wait at one minute", () => {
    expect(MODEL_FIRST_BYTE_TIMEOUT_MS).toBe(60_000);
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

  it("uses a lower context ceiling for execute_plan runs", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "s".repeat(40_000) },
      { role: "user", content: "u".repeat(40_000) },
      { role: "tool", tool_call_id: "1", content: `lines 1-100\n${"a".repeat(30_000)}` },
      { role: "tool", tool_call_id: "2", content: `lines 101-200\n${"b".repeat(30_000)}` },
      { role: "tool", tool_call_id: "3", content: `lines 201-300\n${"c".repeat(30_000)}` },
    ];
    expect(EXECUTE_PLAN_MAX_CONTEXT_CHARS).toBe(100_000);
    expect(compactMessagesForModel(messages)[2].content).not.toContain("已压缩");
    expect(compactMessagesForModel(messages, EXECUTE_PLAN_MAX_CONTEXT_CHARS)[2].content).toContain("已压缩");
  });
});
