import { describe, expect, it, vi } from "vitest";
import { runVibeAgentSse, type VibeAgentRunRequest, type VibeAgentSseEvent } from "./vibeAgentClient";

const baseRequest: VibeAgentRunRequest = {
  prompt: "implement feature",
  projectPath: "D:/project/demo",
  endpoint: "https://example.test/v1/chat/completions",
  apiKey: "test-key",
  model: "test-model",
};

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

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
  it("parses SSE events and forwards done", async () => {
    const events: VibeAgentSseEvent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'event: status\ndata: {"phase":"running","turn":1}\n\n',
          'event: message_delta\ndata: {"delta":"hello"}\n\n',
          'event: tool_start\ndata: {"id":"1","name":"read_file","args":{"path":"a.ts"}}\n\n',
          'event: done\ndata: {"writtenFiles":["a.ts"],"pendingFiles":[],"turns":1}\n\n',
        ]),
      ),
    );

    runVibeAgentSse(baseRequest, (event) => events.push(event));
    await waitForDone(events);

    expect(events).toEqual([
      { type: "status", data: { phase: "connecting_local" } },
      { type: "status", data: { phase: "stream_connected" } },
      { type: "status", data: { phase: "running", turn: 1 } },
      { type: "message_delta", data: { delta: "hello" } },
      { type: "tool_start", data: { id: "1", name: "read_file", args: { path: "a.ts" } } },
      { type: "done", data: { writtenFiles: ["a.ts"], pendingFiles: [], turns: 1 } },
    ]);
  });

  it("emits error when the agent request fails", async () => {
    const events: VibeAgentSseEvent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("backend unavailable", { status: 503 })),
    );

    runVibeAgentSse(baseRequest, (event) => events.push(event));
    await waitForDone(events);

    expect(events).toContainEqual({ type: "error", data: { message: "backend unavailable" } });
    expect(events.at(-1)).toEqual({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
  });

  it("adds a synthetic done event when the stream ends without done", async () => {
    const events: VibeAgentSseEvent[] = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(['event: message\ndata: {"text":"complete"}\n\n'])));

    runVibeAgentSse(baseRequest, (event) => events.push(event));
    await waitForDone(events);

    expect(events).toContainEqual({ type: "message", data: { text: "complete" } });
    expect(events.at(-1)).toEqual({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
  });

  it("reports unknown events with raw data when JSON parsing fails", async () => {
    const events: VibeAgentSseEvent[] = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(["event: custom\ndata: not-json\n\n"])));

    runVibeAgentSse(baseRequest, (event) => events.push(event));
    await waitForDone(events);

    expect(events).toContainEqual({ type: "unknown", data: "not-json" });
  });

  it("emits aborted status and done when abort is called", async () => {
    const events: VibeAgentSseEvent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );

    const run = runVibeAgentSse(baseRequest, (event) => events.push(event));
    run.abort();
    await waitForDone(events);

    expect(events).toContainEqual({ type: "status", data: { phase: "aborted" } });
    expect(events.at(-1)).toEqual({ type: "done", data: { writtenFiles: [], pendingFiles: [], turns: 0 } });
  });
});
