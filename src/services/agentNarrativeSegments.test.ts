import { describe, expect, it } from "vitest";
import {
  assignToolsToNarrativeSegments,
  buildNarrativeSegments,
  splitAssistantNarrative,
} from "./agentNarrativeSegments";

describe("splitAssistantNarrative", () => {
  it("splits chained Chinese intents", () => {
    const text =
      "好的，我先读取需要修改的文件，然后进行改动。现在让我找到使用 ChatComposerEditor 的父组件：现在让我看看服务端是否已经支持图片：";
    const parts = splitAssistantNarrative(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain("好的");
    expect(parts.some((part) => part.includes("ChatComposerEditor"))).toBe(true);
  });
});

describe("buildNarrativeSegments", () => {
  it("assigns tools to segments in order", () => {
    const segments = buildNarrativeSegments("第一句。现在第二句。现在第三句。", [
      { id: "1", name: "read_file", icon: "📄", title: "读取", detail: "a.ts", label: "读取", summary: "ok", ok: true },
      { id: "2", name: "grep", icon: "🔎", title: "搜索", detail: "x", label: "搜索", summary: "ok", ok: true },
      { id: "3", name: "grep", icon: "🔎", title: "搜索", detail: "y", label: "搜索", summary: "ok", ok: true },
    ]);
    expect(segments).toHaveLength(3);
    expect(segments[0].tools).toHaveLength(1);
    expect(segments[1].tools).toHaveLength(1);
    expect(segments[2].tools).toHaveLength(1);
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
