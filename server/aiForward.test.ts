import { describe, expect, it } from "vitest";
import {
  AGENT_AI_MAX_RETRIES,
  DEFAULT_AI_MAX_RETRIES,
  MODEL_FIRST_BYTE_TIMEOUT_MS,
  formatAiHttpError,
  normalizeMessagesForChatApi,
  resolveFirstByteTimeoutMs,
} from "./aiForward";

describe("resolveFirstByteTimeoutMs", () => {
  it("returns base timeout for empty context", () => {
    expect(resolveFirstByteTimeoutMs(0)).toBe(MODEL_FIRST_BYTE_TIMEOUT_MS);
  });

  it("scales with context size up to +120s", () => {
    expect(resolveFirstByteTimeoutMs(30_000)).toBe(MODEL_FIRST_BYTE_TIMEOUT_MS + 20_000);
    expect(resolveFirstByteTimeoutMs(500_000)).toBe(MODEL_FIRST_BYTE_TIMEOUT_MS + 120_000);
  });
});

describe("agent retry budget", () => {
  it("allows one extra retry for agent runs", () => {
    expect(AGENT_AI_MAX_RETRIES).toBe(DEFAULT_AI_MAX_RETRIES + 1);
  });
});

describe("formatAiHttpError", () => {
  it("adds actionable hints for HTTP 400 provider errors", () => {
    const message = formatAiHttpError(
      400,
      JSON.stringify({ error: { message: "Error from provider (Xiaomi): Request Error" } }),
    );
    expect(message).toContain("HTTP 400");
    expect(message).toContain("Xiaomi");
    expect(message).toContain("AI 配置");
  });
});

describe("normalizeMessagesForChatApi", () => {
  it("uses empty string instead of null content when tool_calls are present", () => {
    const normalized = normalizeMessagesForChatApi([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }],
      },
    ]);
    expect(normalized[0].content).toBe("");
  });

  it("drops tool_calls missing id or name", () => {
    const normalized = normalizeMessagesForChatApi([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "", type: "function", function: { name: "grep", arguments: "{}" } },
          { id: "ok", type: "function", function: { name: "read_file", arguments: "{}" } },
        ],
      },
    ]);
    expect(normalized[0].tool_calls).toHaveLength(1);
    expect(normalized[0].tool_calls?.[0].id).toBe("ok");
  });
});
