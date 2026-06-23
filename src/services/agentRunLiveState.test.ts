import { describe, expect, it } from "vitest";
import {
  appendStatusDetail,
  isRedundantAgentStatusDetail,
} from "../utils/vibeHelpers";
import {
  createInitialLiveState,
  formatAgentLiveStatus,
  patchLiveFromStatusEvent,
} from "./agentRunLiveState";

describe("agentRunLiveState", () => {
  it("dedupes redundant sending_request detail", () => {
    expect(
      appendStatusDetail("正在发送模型请求…", "正在发送请求…"),
    ).toBe("正在发送模型请求…");
    expect(isRedundantAgentStatusDetail("正在发送模型请求…", "正在发送请求…")).toBe(true);
  });

  it("drops server turn preamble from waiting_model compact line", () => {
    expect(
      appendStatusDetail("正在等待模型响应（第 3 轮）…", "第 3 轮：等待模型响应"),
    ).toBe("正在等待模型响应（第 3 轮）…");
  });

  it("tracks waitStartedAt on model-wait phases only", () => {
    const t0 = 1_700_000_000_000;
    const waiting = patchLiveFromStatusEvent(createInitialLiveState(), "waiting_model", {
      turn: 2,
    });
    expect(waiting.waitStartedAt).toBeTypeOf("number");

    const streaming = patchLiveFromStatusEvent(
      { ...waiting, waitStartedAt: t0 },
      "streaming_model",
      { streamChars: 12 },
    );
    expect(streaming.waitStartedAt).toBeUndefined();
    expect(streaming.streamChars).toBe(12);
  });

  it("formats live status from run state", () => {
    const text = formatAgentLiveStatus(
      { phase: "sending_request", contextChars: 22_900 },
      { chatMode: "build" },
    );
    expect(text).toBe("正在发送模型请求…");
  });
});
