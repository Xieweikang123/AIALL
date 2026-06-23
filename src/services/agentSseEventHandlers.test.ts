import { describe, expect, it } from "vitest";
import {
  AGENT_SSE_PROGRESS_EVENT_TYPES,
  isAgentSseProgressEvent,
} from "./agentSseEventHandlers";

describe("agentSseEventHandlers", () => {
  it("lists progress event types used for stall detection", () => {
    expect(AGENT_SSE_PROGRESS_EVENT_TYPES).toContain("tool_end");
    expect(AGENT_SSE_PROGRESS_EVENT_TYPES).toContain("message_delta");
    expect(AGENT_SSE_PROGRESS_EVENT_TYPES).not.toContain("done");
  });

  it("isAgentSseProgressEvent matches known progress types", () => {
    expect(isAgentSseProgressEvent("status")).toBe(true);
    expect(isAgentSseProgressEvent("done")).toBe(false);
  });
});
