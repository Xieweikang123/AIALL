import { describe, expect, it } from "vitest";
import {
  AGENT_PROGRESS_MARKER,
  buildWrittenFilesSummary,
  filterDuplicateFeedThoughts,
  finalizeAssistantBubbleContent,
  hasAgentFinalAnswer,
  commitAgentFinalAnswerIfMissing,
  hasAgentRunStructure,
  hasSubstantiveAgentSummary,
  isEnglishToolNarration,
  isAgentTimelineAnswerStreaming,
  isStorageCompactedAssistantText,
  isSubstantiveProgressSummary,
  isTruncatedAssistantAnswer,
  appendAssistantStreamDelta,
  mergeAssistantTurnText,
  preferFullContentOverCompactedRoundGroup,
  resolveAgentTimelineAnswer,
  resolveAssistantBubbleContent,
  resolveCompletedAgentBubbleContent,
  resolveLatestAgentProgressNarrative,
  resolveLiveAgentAnswerPreview,
  resolveLiveAgentAnswerText,
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

  it("does not treat tool-turn narrative as a completed answer", () => {
    expect(
      resolveAssistantBubbleContent({
        content: "让我看看 `useProjectMemory.ts` 中的归档保存流程。",
        roundGroups: [
          {
            turn: 3,
            narrative: "让我看看 `useProjectMemory.ts` 中的归档保存流程。",
            modelSteps: [],
            toolIds: ["t1"],
            response: {
              assistantText: "让我看看 `useProjectMemory.ts` 中的归档保存流程。",
              toolCalls: [{ id: "t1", name: "read_file", arguments: "{}" }],
              hasToolCalls: true,
              isFinal: false,
            },
          },
        ],
        tools: [{ running: false, turn: 3 }],
      }),
    ).toBe("");
  });

  it("falls back to last narrative when content and final response are empty", () => {
    expect(
      resolveAssistantBubbleContent({
        roundGroups: [
          { turn: 1, narrative: "中间步骤", modelSteps: [], toolIds: [] },
          { turn: 2, narrative: "## 总结\n表格", modelSteps: [], toolIds: [] },
        ],
      }),
    ).toBe("");
  });

  it("strips leaked tool summaries from bubble content", () => {
    expect(
      resolveAssistantBubbleContent({
        content: "已完成修改。\n\n[工具摘要]\n- 读取文件: 读取 20 行内容",
      }),
    ).toBe("已完成修改。");
  });

  it("uses only the final turn answer after tool exploration", () => {
    const shortFinal = "修改后，即使输入框被禁用，点击时也会允许聚焦，方便查看内容。";
    expect(
      resolveAssistantBubbleContent({
        content: shortFinal,
        roundGroups: [
          {
            turn: 12,
            narrative: "从截图看，这是一个输入框。聚焦方式：点击输入框内部任何区域都会聚焦。",
            modelSteps: [],
            toolIds: [],
            response: {
              assistantText: "从截图看，这是一个输入框。聚焦方式：点击输入框内部任何区域都会聚焦。",
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
    ).toBe(shortFinal);
  });

  it("ignores english tool narration when merging turns", () => {
    const chinese = "## 读图描述\n\n占位符「描述要改什么」表明这是 Vibe 助手输入框。";
    const english = "Now let me search for the chat-input-box styles:";
    expect(mergeAssistantTurnText(chinese, english)).toBe(chinese);
    expect(isEnglishToolNarration(english)).toBe(true);
  });

  it("drops english stream preamble when final answer was already appended", () => {
    const preamble =
      "Now I have enough context to make all 3 patches. Let me also quickly check what session-related props ChatPanel has to ensure the button can emit the right data:";
    const finalAnswer = "全部验证完毕，所有代码已在磁盘上就位，无需再改。\n\n**已完成的功能全链路：**";
    const polluted = `${preamble}${finalAnswer}`;
    expect(mergeAssistantTurnText(polluted, finalAnswer)).toBe(finalAnswer);
  });
});

describe("appendAssistantStreamDelta", () => {
  it("concatenates incremental chunks without inserting paragraph breaks", () => {
    let content = "";
    for (const chunk of ["从截图", "和代码", "两个维度", "来回答"]) {
      content = appendAssistantStreamDelta(content, chunk);
    }
    expect(content).toBe("从截图和代码两个维度来回答");
    expect(content.includes("\n\n")).toBe(false);
  });

  it("ignores english tool narration deltas", () => {
    const prev = "已有中文正文。";
    expect(appendAssistantStreamDelta(prev, "Now let me grep the styles:")).toBe(prev);
  });

  it("preserves leading spaces in incremental chunks", () => {
    expect(appendAssistantStreamDelta("句号。", " 下一句")).toBe("句号。 下一句");
  });

  it("breaks latin tool preamble from following chinese answer chunks", () => {
    const existing =
      "Now I have enough context to make all 3 patches. Let me also quickly check what session-related props ChatPanel has to ensure the button can emit the right data:";
    const delta = "全部验证完毕，所有代码已在磁盘上就位，无需再改。";
    expect(appendAssistantStreamDelta(existing, delta)).toBe(`${existing}\n\n${delta}`);
  });
});

describe("resolveCompletedAgentBubbleContent", () => {
  it("uses final turn and prepends vision region when missing", () => {
    const vision =
      "占位符「描述要改什么」表明这是 Vibe 助手 Build 模式底栏的对话输入框。";
    const finalAnswer = "## 回答\n\n点击整个矩形区域即可聚焦，::before 不会拦截点击。";
    const result = resolveCompletedAgentBubbleContent({
      content: `${vision}\n\nNow let me read the component\n\n${finalAnswer}`,
      roundGroups: [
        {
          turn: 1,
          narrative: vision,
          modelSteps: [],
          toolIds: [],
          response: {
            assistantText: vision,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: false,
          },
        },
        {
          turn: 5,
          modelSteps: [],
          toolIds: [],
          response: {
            assistantText: finalAnswer,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: true,
          },
        },
      ],
    });
    expect(result).toContain("Vibe 助手");
    expect(result).toContain("## 回答");
    expect(result).not.toContain("Now let me");
  });

  it("prefers full msg.content when persisted round-group final text was compacted", () => {
    const fullAnswer =
      `${"根据项目代码分析，工单处理修改订单汇总表的时机主要有以下几个：\n\n".repeat(30)}` +
      "## 五、特殊注意事项\n\n**总结**：工单处理修改订单汇总表主要发生在工单状态变为已处理时。";
    expect(fullAnswer.length).toBeGreaterThan(800);
    const compacted = `${fullAnswer.slice(0, 800)}…`;
    expect(isStorageCompactedAssistantText(compacted)).toBe(true);
    expect(preferFullContentOverCompactedRoundGroup(compacted, fullAnswer)).toBe(fullAnswer);

    const result = resolveCompletedAgentBubbleContent({
      content: fullAnswer,
      roundGroups: [
        {
          turn: 16,
          modelSteps: [],
          toolIds: [],
          response: {
            assistantText: compacted,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: true,
          },
        },
      ],
    });
    expect(result).toContain("## 五、特殊注意事项");
    expect(result).toContain("**总结**");
    expect(result).not.toMatch(/包含…$/);
  });

  it("prefers longer streamed narrative over shorter isFinal snapshot", () => {
    const streamed = "这是一段较长的流式输出内容，用于验证不会被更短的响应覆盖。";
    const shortFinal = "这是一段较长的流式";
    expect(
      resolveCompletedAgentBubbleContent({
        content: streamed,
        roundGroups: [
          {
            turn: 1,
            narrative: streamed,
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
    ).toBe(streamed);
  });

  it("prefers full msg.content over shorter final-group narrative fragment", () => {
    const full =
      "根据代码分析，项目选择弹窗的背景色由 CSS 变量控制，实际值为 transparent。";
    expect(
      resolveCompletedAgentBubbleContent({
        content: full,
        roundGroups: [
          {
            turn: 5,
            narrative: "的实际值：",
            modelSteps: [],
            toolIds: [],
            response: {
              assistantText: full,
              toolCalls: [],
              hasToolCalls: false,
              isFinal: true,
            },
          },
        ],
      }),
    ).toBe(full);
  });
});

describe("finalizeAssistantBubbleContent", () => {
  it("shows written-files summary when run ends without a final answer", () => {
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
    expect(result).not.toContain("现在开始批量修改：");
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
    expect(buildWrittenFilesSummary(["a.ts"], true)).toContain("点击下方");
  });

  it("detects truncated final answers ending with a colon", () => {
    expect(
      isTruncatedAssistantAnswer(
        "已添加 padding: 6px 10px，确保输入框内有足够点击区域。同时确保占位文字覆盖全宽，点击任意位置都能聚焦输入：",
      ),
    ).toBe(true);
  });

  it("does not flag written-files summary ending with closed inline code", () => {
    const summary = buildWrittenFilesSummary(["src/components/vibe/AppToolbar.vue"], false);
    expect(isTruncatedAssistantAnswer(summary)).toBe(false);
  });

  it("does not flag short model answer plus appended written-files summary", () => {
    const modelAnswer = "已改回纯色 #0b1220 (深蓝黑色)，和应用主背景一致。";
    const result = finalizeAssistantBubbleContent({
      content: modelAnswer,
      writtenFiles: ["src/components/vibe/AppToolbar.vue"],
      roundGroups: [
        {
          turn: 1,
          modelSteps: [],
          toolIds: ["t1"],
          response: {
            assistantText: modelAnswer,
            toolCalls: [],
            hasToolCalls: false,
            isFinal: true,
          },
        },
      ],
    });
    expect(result).toContain("AppToolbar.vue");
    expect(isTruncatedAssistantAnswer(result)).toBe(false);
  });

  it("does not flag written-files list header ending with a colon", () => {
    expect(
      isTruncatedAssistantAnswer(
        "已改回纯色 #0b1220 (深蓝黑色)，和应用主背景一致。\n\n## 修改完成\n\n已写入 1 个文件：",
      ),
    ).toBe(false);
  });

  it("appends written-files summary when final answer is truncated", () => {
    const msg = {
      content:
        "已添加 padding: 6px 10px，确保输入框内有足够点击区域。同时确保占位文字覆盖全宽，点击任意位置都能聚焦输入：",
      writtenFiles: ["src/components/ChatComposerEditor.vue"],
      roundGroups: [
        {
          turn: 7,
          modelSteps: [],
          toolIds: ["t1"],
          narrative: "需要在父容器转发 focus，而不是只改 padding。",
          response: {
            assistantText:
              "已添加 padding: 6px 10px，确保输入框内有足够点击区域。同时确保占位文字覆盖全宽，点击任意位置都能聚焦输入：",
            toolCalls: [],
            hasToolCalls: false,
            isFinal: true,
          },
        },
      ],
    };
    expect(hasSubstantiveAgentSummary(msg)).toBe(false);
    const result = finalizeAssistantBubbleContent(msg);
    expect(result).toContain("## 修改完成");
    expect(result).toContain("ChatComposerEditor.vue");
  });
});

describe("resolveLiveAgentAnswerPreview", () => {
  it("reads narrative from the active agent turn", () => {
    expect(
      resolveLiveAgentAnswerPreview({
        agentTurn: 2,
        roundGroups: [
          { turn: 1, narrative: "旧轮次", modelSteps: [], toolIds: [] },
          { turn: 2, narrative: "正在流式输出最终回答", modelSteps: [], toolIds: [] },
        ],
      }),
    ).toBe("正在流式输出最终回答");
  });

  it("prefers longer msg.content over stale round narrative while streaming", () => {
    const full = "根据代码分析，项目选择弹窗的背景色由 CSS 变量控制，实际值为 transparent。";
    expect(
      resolveLiveAgentAnswerPreview({
        agentTurn: 5,
        agentPhase: "streaming_model",
        content: full,
        roundGroups: [
          {
            turn: 5,
            narrative: "的实际值：",
            modelSteps: [],
            toolIds: [],
          },
        ],
      }),
    ).toBe(full);
  });

  it("hides stale partial answer while waiting for the next model turn", () => {
    expect(
      resolveLiveAgentAnswerPreview({
        agentTurn: 7,
        agentPhase: "waiting_model",
        content: "`-primary)` resolves to",
        roundGroups: [
          {
            turn: 7,
            narrative: "",
            modelSteps: [],
            toolIds: [],
          },
          {
            turn: 6,
            narrative: "`-primary)` resolves to",
            modelSteps: [],
            toolIds: [],
            response: {
              assistantText: "`-primary)` resolves to",
              toolCalls: [{ id: "1", name: "grep", arguments: "{}" }],
              hasToolCalls: true,
              isFinal: false,
            },
          },
        ],
      }),
    ).toBe("");
  });

  it("hides orphaned msg.content from a prior turn while waiting on a new turn", () => {
    expect(
      resolveLiveAgentAnswerText({
        agentTurn: 6,
        agentPhase: "waiting_model",
        content: "上一轮残留的短片段文本",
        roundGroups: [
          {
            turn: 6,
            narrative: "",
            modelSteps: [],
            toolIds: [],
          },
        ],
      }),
    ).toBe("");
  });

  it("streams msg.content in real time during streaming_model", () => {
    const partial = "根据代码确认，**弹窗背景不是透明的**";
    expect(
      resolveLiveAgentAnswerText({
        agentTurn: 7,
        agentPhase: "streaming_model",
        content: partial,
        roundGroups: [
          {
            turn: 7,
            narrative: "`-primary)` resolves to",
            modelSteps: [],
            toolIds: [],
          },
        ],
      }),
    ).toBe(partial);
  });

  it("falls back to the last round when agentTurn is missing", () => {
    expect(
      resolveLiveAgentAnswerPreview({
        roundGroups: [
          { turn: 1, narrative: "探索阶段", modelSteps: [], toolIds: [] },
          { turn: 2, narrative: "最新 narrative", modelSteps: [], toolIds: [] },
        ],
      }),
    ).toBe("最新 narrative");
  });

  it("ignores english tool narration", () => {
    expect(
      resolveLiveAgentAnswerPreview({
        agentTurn: 1,
        roundGroups: [
          { turn: 1, narrative: "Now let me search for the controller", modelSteps: [], toolIds: [] },
        ],
      }),
    ).toBe("");
  });

  it("keeps preview during waiting_model to avoid flicker", () => {
    expect(
      resolveLiveAgentAnswerPreview({
        agentTurn: 2,
        agentPhase: "waiting_model",
        roundGroups: [
          { turn: 2, narrative: "## 分析结论\n正文足够长以便在阶段切换时保持可见", modelSteps: [], toolIds: [] },
        ],
      }),
    ).toBe("## 分析结论\n正文足够长以便在阶段切换时保持可见");
  });

  it("falls back to marked progress narrative when active turn is tool preamble", () => {
    const progress = `${AGENT_PROGRESS_MARKER}\n当前假设是路由层未转发 focus。已读 src/foo.ts 与 handler。下一步 patch。`;
    expect(
      resolveLiveAgentAnswerPreview({
        agentTurn: 2,
        roundGroups: [
          {
            turn: 1,
            narrative: progress,
            modelSteps: [],
            toolIds: [],
            response: { assistantText: "", hasToolCalls: true, isFinal: false, toolCalls: [] },
          },
          {
            turn: 2,
            narrative: "Now let me read the handler",
            modelSteps: [],
            toolIds: [],
            response: { assistantText: "", hasToolCalls: true, isFinal: false, toolCalls: [] },
          },
        ],
      }),
    ).toBe("当前假设是路由层未转发 focus。已读 src/foo.ts 与 handler。下一步 patch。");
  });
});

describe("resolveLatestAgentProgressNarrative", () => {
  it("prefers marked multi-sentence progress on the active turn", () => {
    const progress = `${AGENT_PROGRESS_MARKER}\n第一句假设。第二句已读文件。第三句下一步。`;
    expect(
      resolveLatestAgentProgressNarrative({
        agentTurn: 2,
        roundGroups: [
          { turn: 1, narrative: "旧摘要", modelSteps: [], toolIds: [] },
          { turn: 2, narrative: progress, modelSteps: [], toolIds: [] },
        ],
      }),
    ).toBe("第一句假设。第二句已读文件。第三句下一步。");
  });

  it("accepts unmarked substantive progress with multiple sentences", () => {
    const progress =
      "第一句假设足够长以便通过长度门槛并描述当前排查方向。第二句说明已读 src/foo.ts 与 handler 符号。";
    expect(isSubstantiveProgressSummary(progress)).toBe(true);
    expect(
      resolveLatestAgentProgressNarrative({
        agentTurn: 1,
        roundGroups: [{ turn: 1, narrative: progress, modelSteps: [], toolIds: [] }],
      }),
    ).toBe(progress);
  });
});

describe("resolveAgentTimelineAnswer", () => {
  it("streams live preview while running without active tools", () => {
    expect(
      resolveAgentTimelineAnswer(
        {
          agentTurn: 1,
          roundGroups: [{ turn: 1, narrative: "流式片段", modelSteps: [], toolIds: [] }],
        },
        "",
        true,
        false,
      ),
    ).toBe("流式片段");
  });

  it("keeps live preview while a tool is running to avoid UI flicker", () => {
    expect(
      resolveAgentTimelineAnswer(
        {
          agentTurn: 1,
          roundGroups: [{ turn: 1, narrative: "流式片段", modelSteps: [], toolIds: [] }],
        },
        "",
        true,
        true,
      ),
    ).toBe("流式片段");
  });

  it("uses completed content after the run finishes", () => {
    expect(
      resolveAgentTimelineAnswer(
        {
          agentTurn: 1,
          roundGroups: [{ turn: 1, narrative: "流式片段", modelSteps: [], toolIds: [] }],
        },
        "## 完整回答",
        false,
        false,
      ),
    ).toBe("## 完整回答");
  });

  it("marks streaming while live preview is visible", () => {
    expect(
      isAgentTimelineAnswerStreaming(
        {
          agentTurn: 1,
          roundGroups: [{ turn: 1, narrative: "流式片段", modelSteps: [], toolIds: [] }],
        },
        true,
        false,
      ),
    ).toBe(true);
    expect(
      isAgentTimelineAnswerStreaming(
        {
          agentTurn: 1,
          roundGroups: [{ turn: 1, narrative: "流式片段", modelSteps: [], toolIds: [] }],
        },
        true,
        true,
      ),
    ).toBe(true);
  });

  it("does not show progress fallback in timeline answer slot while running", () => {
    const progress = `${AGENT_PROGRESS_MARKER}\n第一句假设。第二句已读文件。第三句下一步。`;
    expect(
      resolveAgentTimelineAnswer(
        {
          agentTurn: 2,
          roundGroups: [
            {
              turn: 1,
              narrative: progress,
              modelSteps: [],
              toolIds: [],
            },
            {
              turn: 2,
              narrative: "Now let me read the handler",
              modelSteps: [],
              toolIds: [],
              response: { assistantText: "", hasToolCalls: true, isFinal: false, toolCalls: [] },
            },
          ],
        },
        "",
        true,
        false,
      ),
    ).toBe("");
  });

  it("uses finalized bubble text after isFinal even while run is still open", () => {
    const finalAnswer = "## 完整回答\n\n正文内容。";
    expect(
      resolveAgentTimelineAnswer(
        {
          content: finalAnswer,
          agentTurn: 1,
          roundGroups: [
            {
              turn: 1,
              narrative: "流式片段",
              modelSteps: [],
              toolIds: [],
              response: { assistantText: finalAnswer, hasToolCalls: false, isFinal: true, toolCalls: [] },
            },
          ],
        },
        finalAnswer,
        true,
        false,
      ),
    ).toBe(finalAnswer);
  });

  it("keeps longer streamed narrative when isFinal snapshot is shorter", () => {
    const streamed = "这是一段较长的流式输出内容，用于验证不会被更短的响应覆盖。";
    const shortFinal = "这是一段较长的流式";
    expect(
      resolveAgentTimelineAnswer(
        {
          content: streamed,
          agentTurn: 1,
          roundGroups: [
            {
              turn: 1,
              narrative: streamed,
              modelSteps: [],
              toolIds: [],
              response: {
                assistantText: shortFinal,
                hasToolCalls: false,
                isFinal: true,
                toolCalls: [],
              },
            },
          ],
        },
        "",
        true,
        false,
      ),
    ).toBe(streamed);
  });

  it("marks streaming during streaming_model even before visible text arrives", () => {
    expect(
      isAgentTimelineAnswerStreaming(
        { agentTurn: 3, agentPhase: "streaming_model", roundGroups: [{ turn: 3, modelSteps: [], toolIds: [] }] },
        true,
        false,
      ),
    ).toBe(true);
  });

  it("streams short deltas from msg.content during streaming_model", () => {
    expect(
      resolveAgentTimelineAnswer(
        {
          agentTurn: 3,
          agentPhase: "streaming_model",
          content: "你好",
          roundGroups: [{ turn: 3, narrative: "你好", modelSteps: [], toolIds: [] }],
        },
        "",
        true,
        false,
      ),
    ).toBe("你好");
  });

  it("does not mark streaming when preview is only progress fallback", () => {
    const progress = `${AGENT_PROGRESS_MARKER}\n当前假设是路由层未转发 focus。已读 src/foo.ts 与 handler。下一步 patch。`;
    expect(
      isAgentTimelineAnswerStreaming(
        {
          agentTurn: 2,
          roundGroups: [
            {
              turn: 1,
              narrative: progress,
              modelSteps: [],
              toolIds: [],
              response: { assistantText: "", hasToolCalls: true, isFinal: false, toolCalls: [] },
            },
            {
              turn: 2,
              narrative: "Now let me read the handler",
              modelSteps: [],
              toolIds: [],
              response: { assistantText: "", hasToolCalls: true, isFinal: false, toolCalls: [] },
            },
          ],
        },
        true,
        false,
      ),
    ).toBe(false);
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

  it("can suppress all thoughts during live preview when explicitly requested", () => {
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

  it("removes short thought fragments contained in the answer bubble", () => {
    const fragment: CursorFeedItem = {
      kind: "thought",
      key: "t-frag",
      text: "这是一个很有意思的功能构想。",
    };
    const bubble =
      "这是一个很有意思的功能构想。让我先理清当前的 Git 集成现状，再分析可行性。\n\n## 当前现状";
    const items = filterDuplicateFeedThoughts([fragment, action], bubble);
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

describe("commitAgentFinalAnswerIfMissing", () => {
  it("writes isFinal from substantive content when roundGroups lack a final marker", () => {
    const msg = {
      content: "这是最终答复正文，说明项目历史下拉背景为不透明实色。".repeat(8),
      tools: [{ running: false, turn: 13 }],
      roundGroups: [{ turn: 13, maxTurns: 40, modelSteps: [], toolIds: ["t1"] }],
    };
    expect(hasAgentFinalAnswer(msg)).toBe(false);
    expect(commitAgentFinalAnswerIfMissing(msg, 13, 40)).toBe(true);
    expect(hasAgentFinalAnswer(msg)).toBe(true);
    expect(msg.roundGroups?.at(-1)?.response?.isFinal).toBe(true);
  });

  it("returns false when isFinal already exists", () => {
    const msg = {
      content: "ignored",
      roundGroups: [
        {
          turn: 2,
          modelSteps: [],
          toolIds: [],
          response: { assistantText: "done", toolCalls: [], hasToolCalls: false, isFinal: true },
        },
      ],
    };
    expect(commitAgentFinalAnswerIfMissing(msg, 2)).toBe(false);
  });
});
