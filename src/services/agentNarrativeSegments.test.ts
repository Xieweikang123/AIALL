import { describe, expect, it } from "vitest";
import {
  assignToolsToNarrativeSegments,
  buildNarrativeSegments,
  splitAssistantNarrative,
} from "./agentNarrativeSegments";

describe("splitAssistantNarrative", () => {
  it("merges chained intents instead of splitting every Let me / 现在让我", () => {
    const text =
      "好的，我先读取需要修改的文件，然后进行改动。现在让我找到使用 ChatComposerEditor 的父组件：现在让我看看服务端是否已经支持图片：";
    const parts = splitAssistantNarrative(text);
    expect(parts.length).toBeLessThanOrEqual(2);
    expect(parts[0]).toContain("好的");
    expect(parts.some((part) => part.includes("ChatComposerEditor"))).toBe(true);
  });

  it("does not split English tool preambles on their own", () => {
    const text =
      "Let me check the full template for any button. Now let me read EditorPanel.vue since that is the wrapper.";
    const parts = splitAssistantNarrative(text);
    expect(parts).toHaveLength(1);
  });

  it("keeps a markdown header and short following body in one segment", () => {
    const text =
      "### 1. 修改 ChatComposerEditor.vue —— 添加图片支持\nI noticed some typos in my write. Let me fix them:";
    const parts = splitAssistantNarrative(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("ChatComposerEditor");
    expect(parts[0]).toContain("I noticed");
  });

  it("splits on subsequent markdown headers", () => {
    const text = "### 1. edit a\n\n### 2. edit b\nApply both changes.";
    const parts = splitAssistantNarrative(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain("edit a");
    expect(parts.some((part) => part.includes("edit b"))).toBe(true);
  });

  it("merges consecutive segments with the same markdown header", () => {
    const text = "## 截图描述\n## 截图描述\n\n第二段。";
    const parts = splitAssistantNarrative(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("第二段");
  });

  it("drops standalone hr separators instead of gluing them into prose", () => {
    const text = [
      "集成了 **微信支付、微信登录（OAuth）、分享、地图、推送** 等原生能力。",
      "",
      "---",
      "",
      "### 4. `Document/` — 项目文档",
    ].join("\n");
    const parts = splitAssistantNarrative(text);
    for (const part of parts) {
      expect(part).not.toMatch(/。 ---$/);
      expect(part).not.toMatch(/： ---$/);
    }
    expect(parts.every((part) => !/^[-*_]{3,}\s*$/.test(part))).toBe(true);
  });

  it("keeps a fenced code block whole when it contains blank lines", () => {
    const text = [
      "**2. 样式改动** — `GitPanel.scss`：",
      "",
      "```scss",
      ".git-sync-row {",
      "  display: flex;",
      "}",
      "",
      ".git-sync-right {",
      "  display: flex;",
      "}",
      "",
      ".git-remote-link {",
      "  flex-shrink: 0;",
      "}",
      "```",
    ].join("\n");
    const parts = splitAssistantNarrative(text);
    const code = parts.find((part) => part.includes("```"));
    expect(code).toBeDefined();
    // The opening fence, the middle rule blocks and the closing fence stay together.
    expect(code).toContain("```scss");
    expect(code).toContain(".git-sync-row");
    expect(code).toContain(".git-sync-right");
    expect(code).toContain(".git-remote-link");
    expect(code.trim().endsWith("```")).toBe(true);
    // No fragment may end with a dangling lone closing fence.
    for (const part of parts) {
      expect(part.split("\n").filter((l) => /^\s*```/.test(l)).length % 2).toBe(0);
    }
  });

  it("does not leave a lone closing-fence fragment behind", () => {
    const text = [
      "```scss",
      ".git-remote-link {",
      "  flex-shrink: 0;",
      "}",
      "```",
    ].join("\n");
    const parts = splitAssistantNarrative(text);
    expect(parts).toHaveLength(1);
    expect(parts[0].startsWith("```scss")).toBe(true);
    expect(parts[0].trimEnd().endsWith("```")).toBe(true);
  });

  it("does not space-merge a fenced code segment into adjacent prose", () => {
    const text = "说明：\n\n```js\ncode();\n```";
    const parts = splitAssistantNarrative(text);
    const code = parts.find((part) => part.includes("```"));
    expect(code).toBeDefined();
    expect(code).toContain("code();");
    expect(code).not.toContain("说明");
    expect(code.trimEnd().endsWith("```")).toBe(true);
  });
});

describe("buildNarrativeSegments", () => {
  it("assigns tools one-to-one when segment count matches", () => {
    const segments = assignToolsToNarrativeSegments(
      ["### 1. edit a", "### 2. edit b"],
      [
        { id: "1", name: "write_file", icon: "✏️", title: "写入", detail: "a.ts", label: "写入", summary: "ok", ok: true },
        { id: "2", name: "write_file", icon: "✏️", title: "写入", detail: "b.ts", label: "写入", summary: "ok", ok: true },
      ],
    );
    expect(segments[0].tools[0].id).toBe("1");
    expect(segments[1].tools[0].id).toBe("2");
  });

  it("assigns tools across merged narrative segments", () => {
    const segments = buildNarrativeSegments("第一句。现在第二句。现在第三句。", [
      { id: "1", name: "read_file", icon: "📄", title: "读取", detail: "a.ts", label: "读取", summary: "ok", ok: true },
      { id: "2", name: "grep", icon: "🔎", title: "搜索", detail: "x", label: "搜索", summary: "ok", ok: true },
      { id: "3", name: "grep", icon: "🔎", title: "搜索", detail: "y", label: "搜索", summary: "ok", ok: true },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.tools).toHaveLength(3);
  });

  it("keeps orphan tools when narrative is empty", () => {
    const segments = assignToolsToNarrativeSegments([], [{
      id: "1",
      name: "grep",
      icon: "🔎",
      title: "搜索",
      detail: "x",
      label: "搜索",
      summary: "ok",
      ok: true,
    }]);
    expect(segments[0].tools).toHaveLength(1);
  });
});
