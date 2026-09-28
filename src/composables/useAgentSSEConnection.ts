import type { VibeAgentSseEvent } from "../services/vibeAgentClient";
import type { VibeChatMessage } from "../types/vibeChat";

export interface UseAgentSSEConnectionDeps {
  handleAgentEvent: (
    event: VibeAgentSseEvent,
    assistantMsg: VibeChatMessage,
    runGen: number,
    sessionId: string,
  ) => void;
}

const AGENT_EVENT_FRAME_BUDGET_MS = 12;

/**
 * One queued event together with the run identity it must be dispatched under.
 *
 * The identity is captured at enqueue time. It can NOT live on the bucket: a
 * resumed run reuses the same `sessionId` with a new `assistantMsg`/`runGen`, so
 * events from the old connection may still be draining when the new one starts.
 * Dispatching them under the new identity would attribute stale deltas to the
 * new run.
 */
type QueuedAgentEvent = {
  event: VibeAgentSseEvent;
  assistantMsg: VibeChatMessage;
  runGen: number;
  sessionId: string;
};

/** Per-session event queue + its own rAF handle. */
type SessionEventBucket = {
  items: QueuedAgentEvent[];
  raf: number;
};

/**
 * Per-session SSE event queue with per-frame budget.
 *
 * ⚠️ Must stay per-session. The previous single global array dropped each
 * event's owner: whichever session enqueued first "won" the one shared rAF, and
 * the flush then dispatched EVERY queued event — including the other session's —
 * under that first session's `assistantMsg`/`sessionId`/`runGen`. With two
 * concurrent runs that wrote one session's stream deltas into the other
 * session's message (cross-session contamination), and also defeated the
 * `runManager.isValid(sessionId, runGen)` gate because the wrong identity passed
 * it. Bucketing by session (and stamping each event) keeps every frame scoped to
 * the run that produced it.
 */
export function useAgentSSEConnection(deps: UseAgentSSEConnectionDeps) {
  const { handleAgentEvent } = deps;

  const buckets = new Map<string, SessionEventBucket>();

  function bucketFor(sessionId: string): SessionEventBucket {
    let bucket = buckets.get(sessionId);
    if (!bucket) {
      bucket = { items: [], raf: 0 };
      buckets.set(sessionId, bucket);
    }
    return bucket;
  }

  function flushBucket(bucket: SessionEventBucket) {
    bucket.raf = 0;
    const start = performance.now();
    while (bucket.items.length > 0) {
      const item = bucket.items.shift();
      if (!item) continue;
      // Dispatch under the identity captured at enqueue time, never a bucket-level
      // one — a resumed run shares the sessionId but has its own assistantMsg/runGen.
      handleAgentEvent(item.event, item.assistantMsg, item.runGen, item.sessionId);
      if (performance.now() - start > AGENT_EVENT_FRAME_BUDGET_MS) {
        break;
      }
    }
    if (bucket.items.length > 0) {
      scheduleBucketFlush(bucket);
    } else {
      // Idle bucket: drop it so a removed/replaced run leaves nothing behind.
      for (const [sessionId, candidate] of buckets) {
        if (candidate === bucket) {
          buckets.delete(sessionId);
          break;
        }
      }
    }
  }

  function scheduleBucketFlush(bucket: SessionEventBucket) {
    if (bucket.raf) return;
    bucket.raf = requestAnimationFrame(() => flushBucket(bucket));
  }

  /**
   * Clear queued events. Pass a `sessionId` to scope the clear to one run
   * (interrupt / done); omit it to clear every session (session teardown).
   */
  function clearPendingAgentEvents(sessionId?: string) {
    if (sessionId) {
      const bucket = buckets.get(sessionId);
      if (!bucket) return;
      bucket.items.length = 0;
      if (bucket.raf) {
        cancelAnimationFrame(bucket.raf);
        bucket.raf = 0;
      }
      buckets.delete(sessionId);
      return;
    }
    for (const bucket of buckets.values()) {
      bucket.items.length = 0;
      if (bucket.raf) cancelAnimationFrame(bucket.raf);
    }
    buckets.clear();
  }

  function enqueueAgentEvent(
    event: VibeAgentSseEvent,
    assistantMsg: VibeChatMessage,
    runGen: number,
    sessionId: string,
  ) {
    const bucket = bucketFor(sessionId);
    bucket.items.push({ event, assistantMsg, runGen, sessionId });
    scheduleBucketFlush(bucket);
  }

  /** Pending event count, optionally for one session. Test/debug only. */
  function pendingEventCount(sessionId?: string): number {
    if (sessionId) return buckets.get(sessionId)?.items.length ?? 0;
    let total = 0;
    for (const bucket of buckets.values()) total += bucket.items.length;
    return total;
  }

  return {
    clearPendingAgentEvents,
    enqueueAgentEvent,
    pendingEventCount,
  };
}
