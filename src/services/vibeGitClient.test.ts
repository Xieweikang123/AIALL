import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiBatchGroups,
  commitGitChanges,
  fetchGitLog,
  fetchGitStatus,
  generateCommitMessage,
} from "./vibeGitClient";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

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

describe("fetchGitStatus", () => {
  it("HTTP fallback 解析 JSON 结果", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        branch: "main",
        files: [{ path: "a.ts", status: "M", indexStatus: " ", worktreeStatus: "M", staged: false }],
        stagedCount: 0,
        unstagedCount: 1,
        isRepo: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGitStatus("D:/project/demo");
    expect(result.ok).toBe(true);
    expect(result.branch).toBe("main");
    expect(result.unstagedCount).toBe(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/backend/vibe/git/status?path=");
    expect(String(url)).toContain(encodeURIComponent("D:/project/demo"));
  });

  it("网络异常返回错误结果", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    const result = await fetchGitStatus("D:/project/demo");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("commitGitChanges", () => {
  it("POST /backend/vibe/git/commit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, hash: "abc123" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await commitGitChanges("D:/project/demo", "feat: x");
    expect(result.ok).toBe(true);
    expect(result.hash).toBe("abc123");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/backend/vibe/git/commit");
    expect(JSON.parse(String(init.body))).toEqual({ path: "D:/project/demo", message: "feat: x" });
  });
});

describe("fetchGitLog", () => {
  it("拼装查询参数并返回 entries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        entries: [{ hash: "h1", shortHash: "h1", author: "a", date: "d", message: "m", files: [] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGitLog("D:/project/demo", 10, "feat", {
      author: "alice",
      path: "src/a.ts",
      all: true,
    });
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(Array.isArray(result.entries[0].files)).toBe(true);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toContain("count=10");
    expect(String(url)).toContain("search=feat");
    expect(String(url)).toContain("author=alice");
    expect(String(url)).toContain("file=src%2Fa.ts");
    expect(String(url)).toContain("all=1");
  });
});

describe("generateCommitMessage (SSE)", () => {
  it("解析 delta / done 事件并触发 onDelta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: delta\ndata: {"text":"feat: "}\n\n',
        'event: delta\ndata: {"text":"add auth"}\n\n',
        'event: done\ndata: {"message":"feat: add auth","warning":"warn"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const deltas: string[] = [];
    const result = await generateCommitMessage("D:/project/demo", "https://ai.example", "", "gpt-4o", (t) =>
      deltas.push(t),
    );

    expect(deltas).toEqual(["feat: ", "add auth"]);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("feat: add auth");
    expect(result.warning).toBe("warn");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    // key 不下发浏览器：apiKey 传空，服务端注入
    expect(body.apiKey).toBe("");
  });

  it("error 事件返回失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse(['event: error\ndata: {"error":"AI 挂了"}\n\n'])),
    );
    const result = await generateCommitMessage("D:/project/demo", "https://ai.example", "", "gpt-4o", () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("AI 挂了");
  });

  it("HTTP 错误解析 error.message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "no key" }, 502)));
    const result = await generateCommitMessage("D:/project/demo", "https://ai.example", "", "gpt-4o", () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no key");
  });
});

describe("aiBatchGroups (SSE)", () => {
  it("聚合 progress / delta / done 事件", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: progress\ndata: {"step":"读取变更摘要"}\n\n',
        'event: delta\ndata: {"text":"group1"}\n\n',
        'event: done\ndata: {"groups":[{"name":"g1","files":["a.ts"],"message":"m"}]}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const deltas: string[] = [];
    const steps: string[] = [];
    const result = await aiBatchGroups(
      "D:/project/demo",
      "https://ai.example",
      "",
      "gpt-4o",
      (t) => deltas.push(t),
      (s) => steps.push(s),
    );

    expect(steps).toContain("读取变更摘要");
    expect(deltas).toEqual(["group1"]);
    expect(result.ok).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe("g1");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).apiKey).toBe("");
  });

  it("error 事件携带 partialGroups", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'event: error\ndata: {"error":"fail","partialGroups":[{"name":"g","files":[],"message":""}]}\n\n',
        ]),
      ),
    );
    const result = await aiBatchGroups("D:/project/demo", "https://ai.example", "", "gpt-4o");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("fail");
    expect(result.groups).toHaveLength(1);
  });
});
