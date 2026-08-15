import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAvailableModels,
  formatAiHttpError,
  streamChatHttp,
  testAiModel,
  testTtsModel,
} from "./aiClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** SSE / OpenAI-style stream response */
function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    }),
    { status },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("testAiModel (web/HTTP 模式)", () => {
  it("非流式：POST /backend/ai/test 并返回解析结果", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok!" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testAiModel({
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
      prompt: "hi",
      stream: false,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.parsed).toEqual({ choices: [{ message: { content: "ok!" } }] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/backend/ai/test");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(false);
  });

  it("非流式：HTTP 非 2xx 时返回错误（含 401 提示）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "bad key" } }, 401)));
    const result = await testAiModel({
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
      prompt: "hi",
      stream: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("鉴权失败");
  });

  it("流式：聚合 data: 行并触发 onStreamChunk", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const result = await testAiModel({
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
      prompt: "hi",
      stream: true,
      onStreamChunk: (c) => chunks.push(c),
    });

    expect(result.ok).toBe(true);
    expect(result.rawText).toBe("Hello");
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("流式：网络异常返回带提示的错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const result = await testAiModel({
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
      prompt: "hi",
      stream: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("后端");
  });
});

describe("streamChatHttp", () => {
  it("POST /backend/ai/test，apiKey 传空由服务端注入，流式聚合", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const result = await streamChatHttp({
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      onStreamChunk: (c) => chunks.push(c),
    });

    expect(result.ok).toBe(true);
    expect(result.rawText).toBe("ab");
    expect(chunks).toEqual(["a", "b"]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.apiKey).toBe("");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("HTTP 错误时返回错误信息", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "nope" } }, 500)));
    const result = await streamChatHttp({
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("nope");
  });

  it("网络异常返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("boom")));
    const result = await streamChatHttp({
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});

describe("fetchAvailableModels", () => {
  it("HTTP 路径解析 /models 并返回模型列表", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAvailableModels({
      endpoint: "https://ai.example/v1/chat/completions",
      forceRefresh: true,
    });

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(["gpt-4o", "gpt-4o-mini"]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/backend/ai/models");
    const body = JSON.parse(String(init.body));
    expect(body.endpoint).toContain("/models");
  });

  it("HTTP 非 2xx 返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 502)));
    const result = await fetchAvailableModels({
      endpoint: "https://ai.example/v1/chat/completions",
      forceRefresh: true,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });
});

describe("testTtsModel", () => {
  it("HTTP 路径返回音频 Blob", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["audio"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testTtsModel({
      endpoint: "https://ai.example/v1/chat/completions",
      model: "tts-1",
      input: "hello",
      voice: "alloy",
      format: "mp3",
    });

    expect(result.ok).toBe(true);
    expect(result.audioBlob).toBeInstanceOf(Blob);
  });

  it("HTTP 错误时解析 error.message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "quota exceeded" } }, 402)),
    );
    const result = await testTtsModel({
      endpoint: "https://ai.example/v1",
      model: "tts-1",
      input: "hello",
      voice: "alloy",
      format: "mp3",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("quota exceeded");
  });
});

describe("formatAiHttpError", () => {
  it("解析 JSON error.message", () => {
    const msg = formatAiHttpError(500, JSON.stringify({ error: { message: "server blew up" } }));
    expect(msg).toContain("server blew up");
  });

  it("401 附加鉴权提示", () => {
    const msg = formatAiHttpError(401, "{}");
    expect(msg).toContain("鉴权失败");
  });

  it("HTML 响应提取 title", () => {
    const msg = formatAiHttpError(502, "<html><title>Bad Gateway</title></html>");
    expect(msg).toContain("Bad Gateway");
  });
});
