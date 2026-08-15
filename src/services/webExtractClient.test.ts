import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWebText } from "./webExtractClient";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractWebText (web/HTTP 模式)", () => {
  it("无 onProgress 时解析 JSON 结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, status: 200, kind: "html", title: "T", text: "content" }),
          { status: 200 },
        ),
      ),
    );

    const result = await extractWebText({ url: "https://example.com" });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("html");
    expect(result.text).toBe("content");
  });

  it("HTTP 错误解析 error 字段", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "抓取失败" }), { status: 502 }),
      ),
    );
    const result = await extractWebText({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("抓取失败");
  });

  it("onProgress 时解析 SSE progress + result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'event: progress\ndata: {"message":"抓取网页…"}\n\n',
          'event: result\ndata: {"httpStatus":200,"body":{"ok":true,"status":200,"kind":"html","text":"hello"}}\n\n',
        ]),
      ),
    );

    const progress: string[] = [];
    const result = await extractWebText({
      url: "https://example.com",
      onProgress: (m) => progress.push(m),
    });

    expect(progress).toEqual(["抓取网页…"]);
    expect(result.ok).toBe(true);
    expect(result.text).toBe("hello");
  });

  it("SSE result 无 ok 字段时按 HTTP 状态返回错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse(['event: result\ndata: {"httpStatus":500,"body":{}}\n\n']),
      ),
    );
    const result = await extractWebText({ url: "https://example.com", onProgress: () => {} });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("流结束未收到 result 时返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(['event: progress\ndata: {"message":"x"}\n\n'])));
    const result = await extractWebText({ url: "https://example.com", onProgress: () => {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("未收到结果");
  });

  it("网络异常返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const result = await extractWebText({ url: "https://example.com" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
