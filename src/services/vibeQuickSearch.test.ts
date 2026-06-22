import { describe, expect, it } from "vitest";
import {
  extractSearchSnippet,
  groupQuickSearchItems,
  mapContentResults,
  mapFileResults,
  messageSearchText,
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
});
