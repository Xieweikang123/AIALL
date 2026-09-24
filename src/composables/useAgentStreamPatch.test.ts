import { describe, expect, it, vi } from "vitest";
import { useAgentStreamPatch } from "./useAgentStreamPatch";
import type { VibeChatMessage } from "../types/vibeChat";

function makeMsg(overrides: Partial<VibeChatMessage> = {}): VibeChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    roundGroups: [],
    agentTurn: 1,
    ...overrides,
  } as VibeChatMessage;
}

function buildPatch() {
  const msg = makeMsg();
  const patchAssistantMsg = vi.fn();
  const patch = useAgentStreamPatch({
    chatSending: { value: true } as never,
    isChatPinnedToBottom: () => false,
    scrollChatToBottom: async () => {},
    patchAssistantMsg,
    findRunForMsg: () => undefined,
    isAgentRunning: () => false,
    isRunVisible: () => false,
    formatLiveStatus: () => "",
    bumpLiveRevision: () => {},
    scrollStatusLogToBottomInternal: () => {},
    getRunPhase: () => "streaming_model",
    getRunAssistantMsg: () => msg,
  });
  return { msg, patch };
}

describe("useAgentStreamPatch delivery-time turn stamping", () => {
  it("keeps a previous turn's buffered delta out of the next turn's round group", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const { msg, patch } = buildPatch();

    // Turn 1 streams a tail fragment that stays buffered (rAF never fires).
    patch.enqueueStreamDelta(msg.id, msg, "第一轮尾部片段。");

    // Next turn arrives (turn_request handler writes agentTurn) before the rAF flush.
    msg.agentTurn = 2;

    // Turn 2 delta arrives; enqueue must flush turn 1's buffer under its own stamp.
    patch.enqueueStreamDelta(msg.id, msg, "第二轮开头。");
    patch.clearStreamDeltaBuffer();

    const turn1 = msg.roundGroups?.find((g) => g.turn === 1);
    const turn2 = msg.roundGroups?.find((g) => g.turn === 2);

    expect(turn1?.narrative).toBe("第一轮尾部片段。");
    expect(turn2?.narrative).toBe("第二轮开头。");
    // The turn-1 tail must not bleed into turn 2's narrative.
    expect(turn2?.narrative).not.toContain("第一轮尾部片段。");

    vi.unstubAllGlobals();
  });

  it("stamps reasoning deltas with the delivery-time turn too", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const { msg, patch } = buildPatch();

    patch.enqueueReasoningDelta(msg.id, msg, "第一轮推理。");
    msg.agentTurn = 2;
    patch.enqueueReasoningDelta(msg.id, msg, "第二轮推理。");
    patch.clearStreamDeltaBuffer();

    expect(msg.roundGroups?.find((g) => g.turn === 1)?.reasoning).toBe("第一轮推理。");
    expect(msg.roundGroups?.find((g) => g.turn === 2)?.reasoning).toBe("第二轮推理。");

    vi.unstubAllGlobals();
  });
});
