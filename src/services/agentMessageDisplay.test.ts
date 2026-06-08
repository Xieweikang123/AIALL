import { describe, expect, it } from "vitest";
import {
  buildWrittenFilesSummary,
  filterDuplicateFeedThoughts,
  finalizeAssistantBubbleContent,
  hasSubstantiveAgentSummary,
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

  it("strips leaked tool summaries from bubble content", () => {
    expect(
      resolveAssistantBubbleContent({
        content: "已完成修改。\n\n[工具摘要]\n- 读取文件: 读取 20 行内容",
      }),
    ).toBe("已完成修改。");
  });

  it("prefers long narrative over thin final content after tool turns", () => {
    const longAnswer =
      "从截图看，这是一个输入框。聚焦方式：点击输入框内部任何区域都会聚焦。如果点击没有反应，可能是因为 disabled。";
    const shortFinal = "修改后，即使输入框被禁用，点击时也会允许聚焦，方便查看内容。";
    expect(
      resolveAssistantBubbleContent({
        content: shortFinal,
        turnTraces: [{ assistantText: longAnswer }],
        roundGroups: [
          {
            turn: 12,
            narrative: longAnswer,
            modelSteps: [],
            toolIds: [],
            response: {
              assistantText: longAnswer,
              toolCalls: [{ id: "1", name: "patch_file", arguments: "{}" }],
              hasToolCalls: true,
              isFinal: false,
            },
          },
          {
            turn: 13,
            narrative: shortFinal,
            modelSteps: [],
            toolIds: [],
            response: {
              assistantText: shortFinal,
              toolCalls: [],
              hasToolCalls: false,
              isFinal: true,
            },
          },
        ],
      }),
    ).toContain("聚焦方式");
    expect(
      resolveAssistantBubbleContent({
        content: shortFinal,
        turnTraces: [{ assistantText: longAnswer }],
        roundGroups: [
          {
            turn: 12,
            narrative: longAnswer,
            modelSteps: [],
            toolIds: [],
            response: {
              assistantText: longAnswer,
              toolCalls: [{ id: "1", name: "patch_file", arguments: "{}" }],
              hasToolCalls: true,
              isFinal: false,
            },
          },
          {
            turn: 13,
            narrative: shortFinal,
            modelSteps: [],
            toolIds: [],
            response: {
              assistantText: shortFinal,
              toolCalls: [],
              hasToolCalls: false,
              isFinal: true,
            },
          },
        ],
      }),
    ).toContain(shortFinal);
  });
});

describe("finalizeAssistantBubbleContent", () => {
  it("appends written-files summary after planning-only text", () => {
    const result = finalizeAssistantBubbleContent({
      content: "现在开始批量修改：",
      writtenFiles: ["src/views/VibeCodingView.vue"],
      roundGroups: [
        {
          turn: 1,
          modelSteps: [],
          toolIds: [],
          response: {
            assistantText: "现在开始批量修改：",
            toolCalls: [{ id: "1", name: "patch_file", arguments: "{}" }],
            hasToolCalls: true,
            isFinal: false,
          },
        },
      ],
    });
    expect(result).toContain("现在开始批量修改：");
    expect(result).toContain("## 修改完成");
    expect(result).toContain("`src/views/VibeCodingView.vue`");
  });

  it("keeps substantive final summaries", () => {
    const msg = {
      content: "中间说明",
      writtenFiles: ["a.ts"],
      roundGroups: [
        {
          turn: 2,
          modelSteps: [],
          toolIds: [],
          response: {
            assistantText: "## 修改完成\n已将 Pop 改为 Apply，并更新了后端路由与前端客户端。",
            toolCalls: [],
            hasToolCalls: false,
            isFinal: true,
          },
        },
      ],
    };
    expect(hasSubstantiveAgentSummary(msg)).toBe(true);
    expect(finalizeAssistantBubbleContent(msg)).toBe(resolveAssistantBubbleContent(msg));
  });

  it("builds aborted partial-write summary", () => {
    expect(buildWrittenFilesSummary(["a.ts"], true)).toContain("运行中断");
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
