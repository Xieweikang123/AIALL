import { describe, expect, it } from "vitest";
import { isRetryableAiError, MODEL_FIRST_BYTE_TIMEOUT_MS } from "../../shared/aiRetry";
import { toolsCharSize } from "../../shared/agentMessageCompact";

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

describe("toolsCharSize", () => {
  it("is zero for empty / null and positive for schemas", () => {
    expect(toolsCharSize([])).toBe(0);
    expect(toolsCharSize(null)).toBe(0);
    expect(toolsCharSize(undefined)).toBe(0);
    expect(toolsCharSize([{ function: { name: "x" } }])).toBeGreaterThan(0);
  });
});
