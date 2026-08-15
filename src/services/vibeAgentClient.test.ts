import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runVibeAgentSse,
  shouldRetryAgentFetch,
  type VibeAgentRunRequest,
  type VibeAgentSseEvent,
} from "./vibeAgentClient";

const baseRequest: VibeAgentRunRequest = {
  prompt: "implement feature",
  projectPath: "D:/project/demo",
  endpoint: "https://example.test/v1/chat/completions",
  apiKey: "test-key",
  model: "test-model",
};

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runVibeAgentSse", () => {
  it("web mode posts to agent-server and forwards streamed events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"status","data":{"phase":"starting"}}\n\n',
        'data: {"type":"message","data":{"text":"hi"}}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const events: VibeAgentSseEvent[] = [];
    const run = runVibeAgentSse(baseRequest, (event) => events.push(event));
    await run.promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    expect(String(url)).toContain("/api/agent/run");
    const body = JSON.parse(String(init.body));
    expect(body.prompt).toBe("implement feature");
    expect(body.projectPath).toBe("D:/project/demo");
    expect(events.map((e) => e.type)).toEqual(["status", "message"]);
  });

  it("abort cancels the HTTP stream and posts cancel", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const events: VibeAgentSseEvent[] = [];
    const run = runVibeAgentSse(baseRequest, (event) => events.push(event));
    run.abort();
    await run.promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const cancelUrl = String(fetchMock.mock.calls[1][0]);
    expect(cancelUrl).toContain("/api/agent/cancel");
  });
});

describe("shouldRetryAgentFetch", () => {
  it("skips auto-retry once server events were already received", () => {
    const error = new TypeError("Failed to fetch");
    expect(shouldRetryAgentFetch(error, false, 0)).toBe(true);
    expect(shouldRetryAgentFetch(error, true, 0)).toBe(false);
  });
});
