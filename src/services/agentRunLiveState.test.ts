import { describe, expect, it } from "vitest";
import {
  appendStatusDetail,
  isRedundantAgentStatusDetail,
} from "../utils/vibeHelpers";
import {
  createInitialLiveState,
  agentRunStageLabel,
  formatAgentLiveStatus,
  patchLiveFromStatusEvent,
  resolveAgentRunStage,
  resolveModelWaitElapsedSeconds,
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

  it("ignores server elapsedMs heartbeat of zero", () => {
    const waiting = patchLiveFromStatusEvent(createInitialLiveState(), "waiting_model", {
      elapsedMs: 0,
    });
    expect(waiting.elapsedMs).toBeUndefined();

    const updated = patchLiveFromStatusEvent(waiting, "waiting_model", {
      elapsedMs: 4000,
    });
    expect(updated.elapsedMs).toBe(4000);
  });

  it("resolveModelWaitElapsedSeconds uses client clock when server sends 0", () => {
    const now = 1_700_000_010_000;
    const live = {
      phase: "waiting_model",
      waitStartedAt: now - 12_000,
      elapsedMs: 0,
    };
    expect(resolveModelWaitElapsedSeconds(live, now)).toBe(12);
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

  it("maps live phases and tool details to coarse UI stages", () => {
    expect(agentRunStageLabel(resolveAgentRunStage({ phase: "building_context" }))).toBe("检索中");
    expect(
      agentRunStageLabel(resolveAgentRunStage({ phase: "executing_tool", toolTitle: "写入文件" })),
    ).toBe("修改中");
    expect(
      agentRunStageLabel(resolveAgentRunStage({ phase: "executing_tool", toolTitle: "运行测试" })),
    ).toBe("验证中");
    expect(agentRunStageLabel(resolveAgentRunStage({ phase: "waiting_model" }))).toBe("思考中");
    expect(agentRunStageLabel(resolveAgentRunStage({ phase: "pending_approval" }))).toBe("等待确认");
  });
});
