import { describe, expect, it } from "vitest";
import {
  runVibeAgentSse,
  shouldRetryAgentFetch,
  type VibeAgentRunRequest,
  type VibeAgentSseEvent,
} from "./vibeAgentClient";
import { WEB_REQUIRES_TAURI_MESSAGE } from "./tauriInvoke";

const baseRequest: VibeAgentRunRequest = {
  prompt: "implement feature",
  projectPath: "D:/project/demo",
  endpoint: "https://example.test/v1/chat/completions",
  apiKey: "test-key",
  model: "test-model",
};

function waitForDone(events: VibeAgentSseEvent[]) {
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (events.some((event) => event.type === "done")) {
        clearInterval(timer);
        resolve();
      }
    }, 0);
  });
}

describe("runVibeAgentSse", () => {
  it("emits desktop-only error in browser preview (no sidecar)", async () => {
    const events: VibeAgentSseEvent[] = [];
    runVibeAgentSse(baseRequest, (event) => events.push(event));
    await waitForDone(events);

    expect(events).toEqual([
      { type: "error", data: { message: WEB_REQUIRES_TAURI_MESSAGE } },
      { type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } },
    ]);
  });

  it("abort is a no-op in browser preview", async () => {
    const events: VibeAgentSseEvent[] = [];
    const run = runVibeAgentSse(baseRequest, (event) => events.push(event));
    run.abort();
    await waitForDone(events);
    expect(events).toHaveLength(2);
  });
});

describe("shouldRetryAgentFetch", () => {
  it("skips auto-retry once server events were already received", () => {
    const error = new TypeError("Failed to fetch");
    expect(shouldRetryAgentFetch(error, false, 0)).toBe(true);
    expect(shouldRetryAgentFetch(error, true, 0)).toBe(false);
  });
});
