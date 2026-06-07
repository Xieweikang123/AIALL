import { describe, expect, it } from "vitest";
import {
  filterDuplicateFeedThoughts,
  resolveAssistantBubbleContent,
  thoughtDuplicatesBubble,
} from "./agentMessageDisplay";
import type { CursorFeedItem } from "./agentCursorFeed";

describe("resolveAssistantBubbleContent", () => {
  it("prefers direct content", () => {
    expect(resolveAssistantBubbleContent({ content: "## 标题\n正文" })).toBe("## 标题\n正文");
  });

  it("falls back to final turn response text", () => {
    expect(
      resolveAssistantBubbleContent({
        roundGroups: [
          {
            turn: 2,
            modelSteps: [],
            toolIds: [],
            response: { assistantText: "## 最终答案", toolCalls: [], hasToolCalls: false, isFinal: true },
          },
        ],
      }),
    ).toBe("## 最终答案");
  });

  it("falls back to last narrative when content and final response are empty", () => {
    expect(
      resolveAssistantBubbleContent({
        roundGroups: [
          { turn: 1, narrative: "中间步骤", modelSteps: [], toolIds: [] },
          { turn: 2, narrative: "## 总结\n表格", modelSteps: [], toolIds: [] },
        ],
      }),
    ).toBe("## 总结\n表格");
  });
});

describe("filterDuplicateFeedThoughts", () => {
  const thought: CursorFeedItem = { kind: "thought", key: "t1", text: "## 最终答案\n正文内容足够长以便触发去重逻辑" };
  const action: CursorFeedItem = {
    kind: "action",
    key: "a1",
    step: {
      id: "a1",
      turn: 1,
      name: "read_file",
      icon: "📄",
      title: "读取",
      detail: "a.ts",
      label: "读取",
      summary: "ok",
      ok: true,
    },
  };

  it("suppresses all thoughts during live preview when bubble has content", () => {
    const items = filterDuplicateFeedThoughts([thought, action], "streaming answer", {
      suppressAllWhenBubble: true,
    });
    expect(items).toEqual([action]);
  });

  it("removes thoughts that duplicate the final bubble after run", () => {
    const bubble = "## 最终答案\n正文内容足够长以便触发去重逻辑";
    const items = filterDuplicateFeedThoughts([thought, action], bubble);
    expect(items).toEqual([action]);
  });

  it("keeps non-duplicate intermediate thoughts", () => {
    const intermediate: CursorFeedItem = {
      kind: "thought",
      key: "t0",
      text: "我先读取配置文件，确认项目结构后再修改组件。",
    };
    const bubble = "## 最终答案\n已完成修改";
    const items = filterDuplicateFeedThoughts([intermediate, action], bubble);
    expect(items).toHaveLength(2);
    expect(thoughtDuplicatesBubble(intermediate.text, bubble)).toBe(false);
  });
});
