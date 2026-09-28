import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentSSEConnection } from "./useAgentSSEConnection";
import type { VibeAgentSseEvent } from "../services/vibeAgentClient";
import type { VibeChatMessage } from "../types/vibeChat";

function makeMsg(id: string): VibeChatMessage {
  return { id, role: "assistant", content: "" } as VibeChatMessage;
}

function makeEvent(type: string): VibeAgentSseEvent {
  return { type, data: {} } as VibeAgentSseEvent;
}

describe("useAgentSSEConnection per-session dispatch", () => {
  let rafQueue: Array<(t: number) => void>;
  let nextRafId: number;

  beforeEach(() => {
    rafQueue = [];
    nextRafId = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      rafQueue.push(cb);
      nextRafId += 1;
      return nextRafId;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function drainRafs() {
    const queued = rafQueue;
    rafQueue = [];
    for (const cb of queued) cb(0);
  }

  it("dispatches each session's events under its own identity (no cross-contamination)", () => {
    const handleAgentEvent = vi.fn();
    const conn = useAgentSSEConnection({ handleAgentEvent });

    const msgA = makeMsg("msg-a");
    const msgB = makeMsg("msg-b");
    const eventA = makeEvent("message_delta");
    const eventB = makeEvent("reasoning_delta");

    // Two concurrent runs enqueue before any frame fires.
    conn.enqueueAgentEvent(eventA, msgA, 11, "session-a");
    conn.enqueueAgentEvent(eventB, msgB, 22, "session-b");

    // Each session owns its own rAF — the second enqueue must not be starved.
    expect(rafQueue.length).toBe(2);

    drainRafs();

    expect(handleAgentEvent).toHaveBeenCalledTimes(2);
    expect(handleAgentEvent).toHaveBeenCalledWith(eventA, msgA, 11, "session-a");
    expect(handleAgentEvent).toHaveBeenCalledWith(eventB, msgB, 22, "session-b");
    // The event from session B must never be dispatched under session A's identity.
    expect(handleAgentEvent).not.toHaveBeenCalledWith(eventB, msgA, 11, "session-a");
  });

  it("clearing one session leaves another session's queued events intact", () => {
    const handleAgentEvent = vi.fn();
    const conn = useAgentSSEConnection({ handleAgentEvent });

    const msgA = makeMsg("msg-a");
    const msgB = makeMsg("msg-b");
    conn.enqueueAgentEvent(makeEvent("message_delta"), msgA, 11, "session-a");
    conn.enqueueAgentEvent(makeEvent("message_delta"), msgB, 22, "session-b");

    conn.clearPendingAgentEvents("session-a");

    expect(conn.pendingEventCount("session-a")).toBe(0);
    expect(conn.pendingEventCount("session-b")).toBe(1);

    drainRafs();

    expect(handleAgentEvent).toHaveBeenCalledTimes(1);
    expect(handleAgentEvent).toHaveBeenCalledWith(expect.anything(), msgB, 22, "session-b");
  });

  it("stamps the identity at enqueue time so a resumed run does not replay old events", () => {
    const handleAgentEvent = vi.fn();
    const conn = useAgentSSEConnection({ handleAgentEvent });

    const oldMsg = makeMsg("msg-old");
    const newMsg = makeMsg("msg-new");
    const oldEvent = makeEvent("message_delta");

    // Old connection's event is queued, then a resume replaces the run slot for
    // the same sessionId with a new msg/generation before the frame drains.
    conn.enqueueAgentEvent(oldEvent, oldMsg, 1, "session-a");
    conn.enqueueAgentEvent(makeEvent("turn_request"), newMsg, 2, "session-a");

    drainRafs();

    // The stale event must still dispatch under the OLD identity it was stamped with.
    expect(handleAgentEvent).toHaveBeenCalledWith(oldEvent, oldMsg, 1, "session-a");
    expect(handleAgentEvent).not.toHaveBeenCalledWith(oldEvent, newMsg, 2, "session-a");
  });
});
