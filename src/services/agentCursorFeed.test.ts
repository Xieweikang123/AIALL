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
  cursorPlanningLabel,
  shouldSuppressFeedPlanningStatus,
  layoutCursorFeedBlocks,
  getRecentFeedActions,
  shouldUseCompactAgentFeed,
} from "./agentCursorFeed";
import type { CursorFeedItem } from "./agentCursorFeed";
import type { AgentRoundGroupView } from "./agentRoundGroups";

describe("agentCursorFeed", () => {
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
});
