import { describe, expect, it, vi } from "vitest";
import {
  extractSearchSnippet,
  groupQuickSearchItems,
  mapContentResults,
  mapFileResults,
  messageSearchText,
  runQuickSearchRemote,
  searchSessionsLocally,
} from "./vibeQuickSearch";

describe("vibeQuickSearch", () => {
  it("searches session titles and message content locally", () => {
    const items = searchSessionsLocally({
      query: "featureFlag",
      sessions: [
        {
          id: "s1",
          title: "讨论 featureFlag",
          createdAt: "",
          updatedAt: "",
          messageCount: 2,
        },
        {
          id: "s2",
          title: "无关会话",
          createdAt: "",
          updatedAt: "",
          messageCount: 1,
        },
      ],
      sessionMessages: new Map([
        [
          "s2",
          [
            { id: "u1", role: "user", content: "请修改 src/foo.ts 里的 featureFlag" },
            { id: "a1", role: "assistant", content: "好的" },
          ],
        ],
      ]),
    });

    expect(items.some((i) => i.kind === "session-title" && i.sessionId === "s1")).toBe(true);
    expect(items.some((i) => i.kind === "session-message" && i.messageId === "u1")).toBe(true);
    expect(items.find((i) => i.messageId === "u1")?.snippet).toContain("featureFlag");
  });

  it("strips agent tool log blocks from searchable text", () => {
    const text = messageSearchText("hello world\n\n<!-- agent-tool-log -->\n- 读取文件 foo.ts");
    expect(text).toBe("hello world");
  });

  it("extracts snippet around query match", () => {
    const snippet = extractSearchSnippet("alpha beta GAMMA delta epsilon zeta", "gamma");
    expect(snippet.toLowerCase()).toContain("gamma");
  });

  it("maps remote file and content results", () => {
    expect(mapFileResults([{ name: "foo.ts", path: "src/foo.ts", isDirectory: false }])[0]?.kind).toBe("file");
    expect(
      mapContentResults([{ path: "src/foo.ts", relative: "src/foo.ts", line: 12, text: "const x = 1" }])[0]?.line,
    ).toBe(12);
  });

  it("groups search results by category", () => {
    const groups = groupQuickSearchItems({
      files: [{ id: "f1", kind: "file", title: "a", subtitle: "b", filePath: "a" }],
      content: [],
      sessions: [{ id: "s1", kind: "session-title", title: "t", subtitle: "会话", sessionId: "x" }],
    });
    expect(groups.map((g) => g.label)).toEqual(["会话", "文件"]);
  });

  it("files-only scope skips content, symbols and sessions", async () => {
    const searchFiles = vi.fn().mockResolvedValue({
      ok: true,
      results: [{ name: "foo.ts", path: "src/foo.ts", isDirectory: false }],
    });
    const grepContent = vi.fn().mockResolvedValue({ ok: true, results: [] });
    const searchSymbols = vi.fn().mockResolvedValue({ ok: true, results: [] });
    const loadSessionMessages = vi.fn().mockResolvedValue([]);

    const result = await runQuickSearchRemote({
      projectPath: "/proj",
      query: "foo",
      scope: "files",
      sessions: [{ id: "s1", title: "t", createdAt: "", updatedAt: "", messageCount: 1 }],
      sessionMessages: new Map(),
      searchFiles,
      grepContent,
      searchSymbols,
      loadSessionMessages,
    });

    expect(result.files.map((f) => f.filePath)).toEqual(["src/foo.ts"]);
    expect(result.content).toEqual([]);
    expect(result.symbols).toEqual([]);
    expect(result.sessions).toEqual([]);
    expect(grepContent).not.toHaveBeenCalled();
    expect(searchSymbols).not.toHaveBeenCalled();
    expect(loadSessionMessages).not.toHaveBeenCalled();
  });

  it("short query in all scope skips content/symbol scans but still searches sessions", async () => {
    const searchFiles = vi.fn().mockResolvedValue({
      ok: true,
      results: [{ name: "foo.ts", path: "src/foo.ts", isDirectory: false }],
    });
    const grepContent = vi.fn().mockResolvedValue({ ok: true, results: [] });
    const searchSymbols = vi.fn().mockResolvedValue({ ok: true, results: [] });
    const loadSessionMessages = vi.fn().mockResolvedValue([
      { id: "u1", role: "user", content: "看看 foo 的实现" },
    ]);

    const result = await runQuickSearchRemote({
      projectPath: "/proj",
      query: "f",
      scope: "all",
      sessions: [{ id: "s1", title: "t", createdAt: "", updatedAt: "", messageCount: 1 }],
      sessionMessages: new Map(),
      searchFiles,
      grepContent,
      searchSymbols,
      loadSessionMessages,
    });

    expect(result.files.map((f) => f.filePath)).toEqual(["src/foo.ts"]);
    expect(grepContent).not.toHaveBeenCalled();
    expect(searchSymbols).not.toHaveBeenCalled();
    expect(loadSessionMessages).toHaveBeenCalled();
    expect(result.sessions.length).toBeGreaterThan(0);
  });
});
