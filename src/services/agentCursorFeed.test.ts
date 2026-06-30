import { describe, expect, it } from "vitest";
import {
  buildAgentExplorationProgress,
  buildAgentExplorationTimeline,
  buildCursorAgentFeed,
  buildCursorAgentTimeline,
  computeExplorationStats,
  computeLineDelta,
  formatCursorActionLabel,
  formatExplorationSummary,
  cursorActionClass,
  cursorPlanningLabel,
  shouldSuppressFeedPlanningStatus,
  layoutCursorFeedBlocks,
  getRecentFeedActions,
  shouldUseCompactAgentFeed,
} from "./agentCursorFeed";
import { buildUnifiedAgentTimeline, buildAgentLiveFooterStatus, summarizeCursorProcessBlocks } from "./agentCompactStatus";
import { formatToolMeta } from "../utils/vibeHelpers";
import type { CursorFeedItem } from "./agentCursorFeed";
import type { AgentRoundGroupView } from "./agentRoundGroups";

describe("agentCursorFeed", () => {
  it("formats web_search tool meta with query", () => {
    const meta = formatToolMeta("web_search", {
      query: "Monaco Editor minimap settings",
      max_results: 3,
    });
    expect(meta.title).toBe("联网搜索");
    expect(meta.detail).toBe("「Monaco Editor minimap settings」");
    expect(meta.label).toContain("Monaco Editor minimap settings");
    expect(formatCursorActionLabel({
      id: "1",
      name: "web_search",
      icon: "🌐",
      title: meta.title,
      detail: meta.detail,
      label: meta.label,
      summary: "fetch failed",
      ok: false,
      args: { query: "Monaco Editor minimap settings" },
    })).toContain("Monaco Editor minimap settings");
  });

  it("formats policy-blocked read_file as skipped duplicate", () => {
    expect(formatCursorActionLabel({
      id: "1",
      name: "read_file",
      icon: "📄",
      title: "读取",
      detail: "src/a.ts",
      label: "读取",
      summary: "src/a.ts 行 1–134 与已读片段高度重叠（第 4 次），请基于已有内容 patch_file",
      ok: false,
      args: { path: "src/a.ts" },
    })).toBe("Skipped duplicate read src/a.ts");
    expect(cursorActionClass({
      id: "1",
      name: "read_file",
      icon: "📄",
      title: "读取",
      detail: "src/a.ts",
      label: "读取",
      summary: "src/a.ts 行 1–134 与已读片段高度重叠（第 4 次）",
      ok: false,
      args: { path: "src/a.ts" },
    })).toBe("skipped");
  });

  it("formats missing-file read_file as failed", () => {
    expect(formatCursorActionLabel({
      id: "1",
      name: "read_file",
      icon: "📄",
      title: "读取",
      detail: "src/missing.ts",
      label: "读取",
      summary: "错误：src/missing.ts 不存在或无法读取",
      ok: false,
      args: { path: "src/missing.ts" },
    })).toBe("Read failed src/missing.ts");
  });

  it("formats tool actions like Cursor", () => {
    expect(formatCursorActionLabel({
      id: "1",
      name: "write_file",
      icon: "✏️",
      title: "写入",
      detail: "src/components/ChatComposerEditor.vue",
      label: "写入",
      summary: "已写入",
      ok: true,
      lineDelta: 5,
      args: { path: "src/components/ChatComposerEditor.vue", content: "a\nb\nc\nd\ne" },
    })).toBe("Edited src/components/ChatComposerEditor.vue +5");
  });

  it("formats run_command with the shell command", () => {
    expect(formatCursorActionLabel({
      id: "1",
      name: "run_command",
      icon: "▶️",
      title: "run_command",
      detail: "",
      label: "run_command",
      summary: "exit 0",
      ok: true,
      args: { command: "npm test" },
    })).toBe("$ npm test");
    expect(formatCursorActionLabel({
      id: "2",
      name: "run_command",
      icon: "▶️",
      title: "run_command",
      detail: "",
      label: "run_command",
      summary: "failed",
      ok: false,
      running: true,
      args: { command: "npm run build" },
    })).toBe("$ npm run build");
    expect(formatCursorActionLabel({
      id: "3",
      name: "run_command",
      icon: "▶️",
      title: "run_command",
      detail: "",
      label: "run_command",
      summary: "failed",
      ok: false,
      args: { command: "npm run build" },
    })).toBe("$ npm run build · 失败");
  });

  it("computes line delta from before and after", () => {
    expect(computeLineDelta("a\nb", "a\nb\nc\nd\ne")).toBe(3);
    expect(computeLineDelta("", "new file", true)).toBe(1);
  });

  it("localizes planning labels for connect phases", () => {
    expect(cursorPlanningLabel(undefined)).toBeNull();
    expect(cursorPlanningLabel("connecting_local")).toBe("连接本地服务…");
    expect(cursorPlanningLabel("connected", "读取项目上下文")).toContain("启动 Agent");
    expect(cursorPlanningLabel("building_context")).toBe("准备上下文…");
  });

  it("builds thought then action sequence", () => {
    const groups: AgentRoundGroupView[] = [{
      turn: 1,
      modelSteps: [],
      toolIds: ["t1"],
      narrative: "好的，我先读取文件。",
      tools: [{
        id: "t1",
        turn: 1,
        name: "read_file",
        icon: "📄",
        title: "读取",
        detail: "a.ts",
        label: "读取",
        summary: "读取 10 行内容",
        ok: true,
        args: { path: "a.ts" },
      }],
    }];

    const feed = buildCursorAgentFeed({ groups, isRunning: false });
    expect(feed[0].kind).toBe("thought");
    expect(feed[1].kind).toBe("action");
  });

  it("suppresses thinking status while answer preview is streaming", () => {
    const feed = buildCursorAgentFeed({
      groups: [],
      isRunning: true,
      agentPhase: "streaming_model",
      answerPreview: "正在输出的正文",
      streaming: true,
    });
    expect(feed.some((item) => item.kind === "status")).toBe(false);
  });

  it("keeps waiting status before answer preview arrives", () => {
    const feed = buildCursorAgentFeed({
      groups: [],
      isRunning: true,
      agentPhase: "waiting_model",
      answerPreview: "",
      streaming: false,
    });
    expect(feed.find((item) => item.kind === "status")?.kind).toBe("status");
    if (feed[0]?.kind === "status") {
      expect(feed[0].text).toContain("整合信息中");
    }
  });

  it("shouldSuppressFeedPlanningStatus covers streaming and preview cases", () => {
    expect(
      shouldSuppressFeedPlanningStatus({
        agentPhase: "streaming_model",
        answerPreview: "已有正文",
        streaming: false,
      }),
    ).toBe(true);
    expect(
      shouldSuppressFeedPlanningStatus({
        agentPhase: "waiting_model",
        answerPreview: "上一轮遗留",
        streaming: false,
      }),
    ).toBe(false);
  });

  it("appends answer to process timeline without mixing into scroll blocks", () => {
    const actions: CursorFeedItem[] = [{
      kind: "action",
      key: "a-1",
      step: {
        id: "a-1",
        turn: 1,
        name: "read_file",
        icon: "📄",
        title: "读取",
        detail: "a.ts",
        label: "读取",
        summary: "ok",
        ok: true,
        args: { path: "a.ts" },
      },
    }];

    const timeline = buildCursorAgentTimeline(actions, "最终回答正文", { streaming: false });
    expect(timeline.processBlocks).toHaveLength(1);
    expect(timeline.processBlocks[0]?.kind).toBe("actions");
    expect(timeline.answer).toEqual({ text: "最终回答正文", streaming: false });
    expect(timeline.blocks).toHaveLength(2);
    expect(timeline.blocks.at(-1)).toEqual({
      kind: "answer",
      key: "timeline-answer",
      text: "最终回答正文",
      streaming: false,
    });
  });

  it("adds placeholder answer block while streaming before text arrives", () => {
    const timeline = buildCursorAgentTimeline([], "", { streaming: true });
    expect(timeline.answer).toEqual({ text: "", streaming: true });
    expect(timeline.blocks).toEqual([
      { kind: "answer", key: "timeline-answer", text: "", streaming: true },
    ]);
  });

  it("omits answer block when not streaming and no text", () => {
    const timeline = buildCursorAgentTimeline([], "", { streaming: false });
    expect(timeline.answer).toBeNull();
    expect(timeline.blocks).toEqual([]);
  });

  it("collapses long action batches but keeps recent steps visible", () => {
    const actions: CursorFeedItem[] = Array.from({ length: 8 }, (_, index) => ({
      kind: "action" as const,
      key: `a-${index}`,
      step: {
        id: `a-${index}`,
        turn: 1,
        name: "read_file",
        icon: "📄",
        title: "读取",
        detail: `file-${index}.ts`,
        label: "读取",
        summary: "ok",
        ok: true,
        args: { path: `file-${index}.ts` },
      },
    }));

    const blocks = layoutCursorFeedBlocks(actions, { keepVisible: 4, collapseAfter: 5 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("actions");
    if (blocks[0].kind !== "actions") return;
    expect(blocks[0].collapsed).toHaveLength(4);
    expect(blocks[0].visible).toHaveLength(4);
  });

  it("summarizes exploration stats for compact feed", () => {
    const stats = computeExplorationStats([
      {
        id: "1",
        turn: 1,
        name: "read_file",
        icon: "📄",
        title: "读取",
        detail: "a.ts",
        label: "读取",
        summary: "ok",
        ok: true,
      },
      {
        id: "2",
        turn: 1,
        name: "grep",
        icon: "🔍",
        title: "搜索",
        detail: "foo",
        label: "搜索",
        summary: "ok",
        ok: true,
      },
    ]);
    expect(formatExplorationSummary(stats, true)).toContain("读 1 个文件");
    expect(formatExplorationSummary(stats, true)).toContain("搜索 1 次");
    expect(shouldUseCompactAgentFeed(6, true, false)).toBe(true);
    expect(shouldUseCompactAgentFeed(6, true, true)).toBe(false);
  });

  it("keeps recent actions visible in compact feed", () => {
    const actions: CursorFeedItem[] = Array.from({ length: 10 }, (_, index) => ({
      kind: "action" as const,
      key: `a-${index}`,
      step: {
        id: `a-${index}`,
        turn: 1,
        name: "read_file",
        icon: "📄",
        title: "读取",
        detail: `file-${index}.ts`,
        label: "读取",
        summary: "ok",
        ok: true,
        args: { path: `file-${index}.ts` },
      },
    }));
    const { recent, hiddenCount } = getRecentFeedActions(actions, 6);
    expect(recent).toHaveLength(6);
    expect(hiddenCount).toBe(4);
    expect(recent[5]?.key).toBe("a-9");
  });

  it("builds exploration progress for running agent without final answer", () => {
    expect(
      buildAgentExplorationProgress({
        isRunning: true,
        agentTurn: 6,
        agentMaxTurns: 20,
        tools: [
          {
            id: "1",
            name: "read_file",
            icon: "📄",
            title: "读取",
            detail: "ChatPanel.vue",
            label: "读取",
            summary: "ok",
            ok: true,
          },
          {
            id: "2",
            name: "read_file",
            icon: "📄",
            title: "读取",
            detail: "ChatPanel.vue",
            label: "读取",
            summary: "",
            ok: true,
            running: true,
          },
        ],
      }),
    ).toEqual({
      summary: "探索代码库 · 读 2 个文件",
      detail: "第 6/20 轮",
      activeTool: "读取 · ChatPanel.vue",
    });
  });

  it("builds horizontal exploration timeline chips", () => {
    expect(
      buildAgentExplorationTimeline([
        {
          id: "1",
          name: "read_file",
          icon: "📄",
          title: "读取",
          detail: "src/a.ts",
          label: "读取",
          summary: "ok",
          ok: true,
        },
        {
          id: "2",
          name: "grep",
          icon: "🔍",
          title: "搜索",
          detail: "pattern",
          label: "搜索",
          summary: "ok",
          ok: true,
        },
      ]),
    ).toEqual([
      { key: "file:src/a.ts", kind: "file", path: "src/a.ts", label: "a.ts" },
      { key: "search:batch", kind: "search", path: undefined, label: "搜索 ×1" },
    ]);
  });

  it("builds unified timeline with answer as last block", () => {
    const groups: AgentRoundGroupView[] = [{
      turn: 1,
      modelSteps: [],
      toolIds: ["t1"],
      narrative: "我先读文件。",
      tools: [{
        id: "t1",
        turn: 1,
        name: "read_file",
        icon: "📄",
        title: "读取",
        detail: "a.ts",
        label: "读取",
        summary: "ok",
        ok: true,
        args: { path: "a.ts" },
      }],
    }];

    const timeline = buildUnifiedAgentTimeline({
      roundGroups: groups,
      answerPreview: "这是最终回答",
      answerStreaming: false,
      isRunning: false,
      activityDetailed: false,
      compactFeed: false,
    });

    expect(timeline.blocks.at(-1)?.kind).toBe("answer");
    expect(timeline.blocks.some((block) => block.kind === "thought")).toBe(true);
    expect(timeline.blocks.some((block) => block.kind === "actions")).toBe(true);
  });

  it("hides thought blocks in compact running feed", () => {
    const groups: AgentRoundGroupView[] = [{
      turn: 1,
      modelSteps: [],
      toolIds: [],
      narrative: "中间推理不应显示",
      tools: [],
    }];

    const timeline = buildUnifiedAgentTimeline({
      roundGroups: groups,
      answerPreview: "",
      answerStreaming: false,
      isRunning: true,
      activityDetailed: false,
      compactFeed: true,
    });

    expect(timeline.blocks.some((block) => block.kind === "thought")).toBe(true);
  });

  it("shows placeholder answer while streaming_model before preview text", () => {
    const timeline = buildUnifiedAgentTimeline({
      roundGroups: [{
        turn: 1,
        modelSteps: [],
        toolIds: ["t1"],
        narrative: "",
        tools: [{
          id: "t1",
          turn: 1,
          name: "grep",
          icon: "🔍",
          title: "代码搜索",
          detail: "minimap",
          label: "搜索",
          summary: "ok",
          ok: true,
          args: { pattern: "minimap" },
        }],
      }],
      answerPreview: "",
      answerStreaming: true,
      isRunning: true,
      activityDetailed: false,
      compactFeed: false,
      agentPhase: "streaming_model",
    });

    const answerBlock = timeline.blocks.find((block) => block.kind === "answer");
    expect(answerBlock).toEqual({
      kind: "answer",
      key: "timeline-answer",
      text: "",
      streaming: true,
    });
  });

  it("buildAgentLiveFooterStatus suppresses exploration summary when tools are visible", () => {
    expect(
      buildAgentLiveFooterStatus({
        currentStatus: "探索代码库 · 搜索 1 次",
        isRunning: true,
        hasAnswer: false,
        hasActionBlocks: true,
      }),
    ).toBeNull();

    expect(
      buildAgentLiveFooterStatus({
        currentStatus: "等待模型响应… · 第 2/24 轮 · 已等待 0s",
        isRunning: true,
        hasAnswer: false,
        hasActionBlocks: true,
      }),
    ).toBe("等待模型响应… · 第 2/24 轮 · 已等待 0s");
  });

  it("keeps three recent actions visible while running without compact feed", () => {
    const groups: AgentRoundGroupView[] = [{
      turn: 1,
      modelSteps: [],
      toolIds: Array.from({ length: 8 }, (_, index) => `t${index}`),
      narrative: "",
      tools: Array.from({ length: 8 }, (_, index) => ({
        id: `t${index}`,
        turn: 1,
        name: "read_file",
        icon: "📄",
        title: "读取",
        detail: `file-${index}.ts`,
        label: "读取",
        summary: "ok",
        ok: true,
        args: { path: `file-${index}.ts` },
      })),
    }];

    const timeline = buildUnifiedAgentTimeline({
      roundGroups: groups,
      answerPreview: "",
      answerStreaming: false,
      isRunning: true,
      activityDetailed: false,
      compactFeed: false,
    });

    const actions = timeline.processBlocks.find((block) => block.kind === "actions");
    expect(actions?.kind).toBe("actions");
    if (actions?.kind !== "actions") return;
    expect(actions.visible).toHaveLength(3);
    expect(actions.collapsed).toHaveLength(5);
  });

  it("summarizes cursor process blocks for completed details", () => {
    const summary = summarizeCursorProcessBlocks(
      [{
        kind: "actions",
        key: "actions-0",
        collapsed: [],
        visible: [{
          kind: "action",
          key: "a-1",
          step: {
            id: "a-1",
            turn: 1,
            name: "grep",
            icon: "🔍",
            title: "搜索",
            detail: "foo",
            label: "搜索",
            summary: "ok",
            ok: true,
          },
        }],
      }],
      1,
      false,
    );
    expect(summary).toContain("1 步");
    expect(summary).toContain("搜索");
  });

  it("includes status blocks in unified timeline before answer", () => {
    const timeline = buildUnifiedAgentTimeline({
      roundGroups: [],
      answerPreview: "",
      answerStreaming: false,
      isRunning: true,
      activityDetailed: false,
      compactFeed: false,
      agentPhase: "waiting_model",
    });

    expect(timeline.processBlocks.some((block) => block.kind === "status")).toBe(true);
  });
});
