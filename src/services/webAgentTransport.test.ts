import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentServerSse, type WebAgentSseEvent } from "./webAgentTransport";

function sseResponse(chunks: string[], status = 200, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status, headers },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runAgentServerSse", () => {
  it("POST 到指定 URL 并转发流式事件", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"status","data":{"phase":"starting"}}\n\n',
        'data: {"type":"tool_start","data":{"name":"read_file"}}\n\n',
        'data: {"type":"done","data":{}}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const events: WebAgentSseEvent[] = [];
    await runAgentServerSse("http://127.0.0.1:8787/api/agent/run", { prompt: "hi" }, (e) => events.push(e));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:8787/api/agent/run");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ prompt: "hi" }));
    expect(events.map((e) => e.type)).toEqual(["status", "tool_start", "done"]);
  });

  it("事件被 \n\n 分割但可跨多个 chunk 到达", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"a","data":{}}\n\ndata: {"ty',
        'pe":"b","data":{}}\n\ndata: {"type":"c","data":{}}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const events: WebAgentSseEvent[] = [];
    await runAgentServerSse("http://x/api/agent/run", {}, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(["a", "b", "c"]);
  });

  it("忽略非 data: 行与坏 JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: status\n',
        'data: {"type":"a","data":{}}\n\n',
        'data: {bad json\n\n',
        ': keep-alive comment\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const events: WebAgentSseEvent[] = [];
    await runAgentServerSse("http://x/api/agent/run", {}, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(["a"]);
  });

  it("401 抛出未登录错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    await expect(
      runAgentServerSse("http://x/api/agent/run", {}, () => {}),
    ).rejects.toThrow("未登录或会话已过期");
  });

  it("非 2xx 抛出 HTTP 错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 502 })));
    await expect(runAgentServerSse("http://x/api/agent/run", {}, () => {})).rejects.toThrow(
      "HTTP 502: boom",
    );
  });

  it("响应无 body 抛出错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(runAgentServerSse("http://x/api/agent/run", {}, () => {})).rejects.toThrow(
      "响应没有 body",
    );
  });

  it("携带认证头（登录后）", async () => {
    vi.stubGlobal(
      "localStorage",
      {
        getItem: vi.fn(() => JSON.stringify({ token: "tok-sess", expiresAt: Date.now() + 60_000 })),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    );
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await runAgentServerSse("http://x/api/agent/run", {}, () => {});
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok-sess");
  });

  it("支持 AbortSignal 透传", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await runAgentServerSse("http://x/api/agent/run", {}, () => {}, controller.signal);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});
