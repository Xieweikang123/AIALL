import { afterEach, describe, expect, it, vi } from "vitest";
import { annotateCodeMapDocument } from "./codeMapAnnotateClient";
import type { CodeMapDocument } from "../../shared/codeMapTypes";

function makeDocument(): CodeMapDocument {
  return {
    version: 1,
    projectPath: "D:/project/demo",
    generatedAt: "2026-08-15T00:00:00Z",
    gitHead: "abc",
    summary: "",
    directories: [],
    files: [],
    modules: [],
    nodes: [
      { id: "n1", name: "a.ts", type: "file", path: "a.ts", summary: "" },
      { id: "n2", name: "b.ts", type: "file", path: "b.ts", summary: "" },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("annotateCodeMapDocument (web/HTTP 模式)", () => {
  it("AI 配置不完整时直接失败", async () => {
    const result = await annotateCodeMapDocument({
      document: makeDocument(),
      endpoint: "",
      model: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("AI 配置不完整");
  });

  it("无待标注节点时返回 skipped", async () => {
    const doc = makeDocument();
    doc.nodes = [{ id: "n1", name: "a.ts", type: "file", path: "a.ts", summary: "already" }];
    const result = await annotateCodeMapDocument({
      document: doc,
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("流式标注成功并回写 document", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"[{\\"n1\\":\\"annotation\\"}]"}}]}\n\n',
              ),
            );
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await annotateCodeMapDocument({
      document: makeDocument(),
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
    });

    expect(result.ok).toBe(true);
    expect(result.document).toBeTruthy();
    const node = result.document?.nodes.find((n) => n.id === "n1");
    expect(node?.summary).toBe("annotation");
  });

  it("模型返回空内容时报错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    const result = await annotateCodeMapDocument({
      document: makeDocument(),
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("空");
  });

  it("HTTP 错误返回错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "boom" } }), { status: 502 })),
    );
    const result = await annotateCodeMapDocument({
      document: makeDocument(),
      endpoint: "https://ai.example/v1",
      model: "gpt-4o",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("boom");
  });
});
