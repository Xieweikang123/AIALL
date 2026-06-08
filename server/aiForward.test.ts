import { describe, expect, it } from "vitest";
import {
  AGENT_AI_MAX_RETRIES,
  DEFAULT_AI_MAX_RETRIES,
  MODEL_FIRST_BYTE_TIMEOUT_MS,
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
