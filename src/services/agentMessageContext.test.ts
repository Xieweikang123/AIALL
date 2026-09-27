import { describe, expect, it } from "vitest";
import { isRetryableAiError, MODEL_FIRST_BYTE_TIMEOUT_MS } from "../../shared/aiRetry";
import { compactMessagesForModel, SOFT_COMPACT_CONTEXT_CHARS, toolsCharSize } from "../../shared/agentMessageCompact";
import { EXECUTE_PLAN_MAX_CONTEXT_CHARS } from "../../shared/agentContextLimits";
import type { ChatCompletionMessage } from "../../shared/chatCompletionTypes";

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
    const long = "x".repeat(50_000 + 100);
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "1", content: long },
    ];
    const compacted = compactMessagesForModel(messages);
    expect(compacted[2].content?.length || 0).toBeLessThan(long.length);
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

  it("compacts when over the shared context ceiling", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "s".repeat(90_000) },
      { role: "user", content: "u".repeat(90_000) },
      { role: "tool", tool_call_id: "1", content: `lines 1-100\n${"a".repeat(40_000)}` },
      { role: "tool", tool_call_id: "2", content: `lines 101-200\n${"b".repeat(40_000)}` },
      { role: "tool", tool_call_id: "3", content: `lines 201-300\n${"c".repeat(40_000)}` },
    ];
    expect(EXECUTE_PLAN_MAX_CONTEXT_CHARS).toBe(256_000);
    expect(compactMessagesForModel(messages)[2].content).toContain("已压缩");
    expect(compactMessagesForModel(messages, [], EXECUTE_PLAN_MAX_CONTEXT_CHARS)[2].content).toContain("已压缩");
  });

  it("soft-compacts older tool outputs before hitting hard context ceiling", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "s".repeat(80_000) },
      { role: "user", content: "u".repeat(80_000) },
      { role: "tool", tool_call_id: "1", content: `lines 1-100\n${"a".repeat(40_000)}` },
      { role: "tool", tool_call_id: "2", content: `lines 101-200\n${"b".repeat(40_000)}` },
      { role: "tool", tool_call_id: "3", content: `lines 201-300\n${"c".repeat(40_000)}` },
    ];
    expect(SOFT_COMPACT_CONTEXT_CHARS).toBe(256_000);
    const totalBefore = messages.reduce((sum, m) => sum + String(m.content || "").length, 0);
    expect(totalBefore).toBeGreaterThan(SOFT_COMPACT_CONTEXT_CHARS);
    const compacted = compactMessagesForModel(messages);
    expect(compacted[2].content).toContain("已压缩");
    expect(compacted[4].content).toContain("lines 201-300");
  });

  it("counts tools toward context size", () => {
    const messages: ChatCompletionMessage[] = [
      { role: "system", content: "s".repeat(60_000) },
      { role: "user", content: "u".repeat(60_000) },
      { role: "tool", tool_call_id: "1", content: "a".repeat(30_000) },
      { role: "tool", tool_call_id: "2", content: "b".repeat(30_000) },
      { role: "tool", tool_call_id: "3", content: "c".repeat(30_000) },
    ];
    const tools = [{ type: "function", function: { name: "read_file", description: "d".repeat(50_000) } }];
    // Messages alone stay under the ceiling …
    expect(compactMessagesForModel(messages, [])[2].content).not.toContain("已压缩");
    // … but adding the tool schemas pushes the real request over it.
    expect(compactMessagesForModel(messages, tools)[2].content).toContain("已压缩");
  });

  it("toolsCharSize is zero for empty / null and positive for schemas", () => {
    expect(toolsCharSize([])).toBe(0);
    expect(toolsCharSize(null)).toBe(0);
    expect(toolsCharSize(undefined)).toBe(0);
    expect(toolsCharSize([{ function: { name: "x" } }])).toBeGreaterThan(0);
  });
});
