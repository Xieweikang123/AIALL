import { describe, expect, it } from "vitest";
import {
  buildAgentExplorationProgress,
  buildPublicToolActionSummary,
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
import { buildUnifiedAgentTimeline, buildAgentLiveFooterStatus, buildCursorCompactLiveStatus, splitAgentLiveStatusLine, isAgentWaitingModelPhase, summarizeCursorProcessBlocks, buildFilteredCursorAgentFeedItems } from "./agentCompactStatus";
import { formatToolMeta } from "../utils/vibeHelpers";
import type { CursorFeedItem } from "./agentCursorFeed";
import type { AgentRoundGroupView, AgentRoundTool } from "./agentRoundGroups";

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

  it("adds a public action summary before tools when a turn has no narrative", () => {
    const feed = buildCursorAgentFeed({
      groups: [{
        turn: 1,
        modelSteps: [],
        toolIds: ["t1", "t2"],
        narrative: "",
        tools: [
          {
            id: "t1",
            turn: 1,
            name: "list_dir",
            icon: "folder",
            title: "浏览目录",
            detail: "src",
            label: "浏览目录",
            summary: "完成",
            ok: true,
            args: { path: "src" },
          },
          {
            id: "t2",
            turn: 1,
            name: "read_file",
            icon: "file",
            title: "读取文件",
            detail: "package.json",
            label: "读取文件",
            summary: "完成",
            ok: true,
            args: { path: "package.json" },
          },
        ],
      }],
      isRunning: false,
    });

    expect(feed[0]).toMatchObject({
      kind: "thought",
      text: "行动摘要 · 我先查看项目结构和关键文件，建立上下文。",
    });
    expect(feed[1]?.kind).toBe("action");
    expect(buildPublicToolActionSummary([])).toBeNull();
  });

  it("does not repeat the same public summary across consecutive tool turns", () => {
    const tool = (id: string, name: "read_file" | "list_dir"): AgentRoundTool => ({
      id,
      turn: 1,
      name,
      icon: "file",
      title: name === "read_file" ? "读取文件" : "浏览目录",
      detail: "src",
      label: name,
      summary: "完成",
      ok: true,
      args: { path: "src" },
    });
    const feed = buildCursorAgentFeed({
      groups: [1, 2, 3].map((turn) => ({
        turn,
        modelSteps: [],
        toolIds: [`t${turn}`],
        narrative: "",
        tools: [tool(`t${turn}`, turn === 2 ? "read_file" : "list_dir")],
      })),
      isRunning: true,
    });

    expect(feed.filter((item) => item.kind === "thought")).toHaveLength(1);
    expect(feed.filter((item) => item.kind === "action")).toHaveLength(3);
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

  it("keeps in-feed planning status while waiting without answer preview", () => {
    const feed = buildCursorAgentFeed({
      groups: [],
      isRunning: true,
      agentPhase: "waiting_model",
      answerPreview: "",
      streaming: false,
    });
    expect(feed.some((item) => item.kind === "status")).toBe(true);
    if (feed[0]?.kind === "status") {
      expect(feed[0].text).toContain("整合信息中");
    }
  });

  it("suppresses in-feed planning status when narrative or tools exist", () => {
    const feed = buildCursorAgentFeed({
      groups: [{
        turn: 1,
        modelSteps: [],
        toolIds: [],
        narrative: "## 截图描述\n正文",
        tools: [],
      }],
      isRunning: true,
      agentPhase: "waiting_model",
      answerPreview: "## 截图描述\n正文",
      streaming: false,
    });
    expect(feed.some((item) => item.kind === "status")).toBe(false);
  });

  it("shouldSuppressFeedPlanningStatus covers streaming and answer preview", () => {
    expect(
      shouldSuppressFeedPlanningStatus({
        agentPhase: "streaming_model",
        streaming: true,
      }),
    ).toBe(true);
    expect(
      shouldSuppressFeedPlanningStatus({
        agentPhase: "waiting_model",
        answerPreview: "已有正文",
        streaming: false,
      }),
    ).toBe(true);
    expect(
      shouldSuppressFeedPlanningStatus({
        agentPhase: "waiting_model",
        answerPreview: "",
        streaming: false,
      }),
    ).toBe(false);
    expect(
      shouldSuppressFeedPlanningStatus({
        agentPhase: "waiting_model",
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

  it("keeps earlier thoughts visible while answer preview is streaming", () => {
    const groups: AgentRoundGroupView[] = [
      {
        turn: 1,
        modelSteps: [],
        toolIds: ["t1"],
        narrative: "我先读取配置文件，确认项目结构后再修改组件。",
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
      },
      {
        turn: 2,
        modelSteps: [],
        toolIds: [],
        narrative: "这是正在流式输出的最终回答正文，内容足够长以便触发去重逻辑。",
        tools: [],
      },
    ];

    const items = buildFilteredCursorAgentFeedItems({
      roundGroups: groups,
      isRunning: true,
      agentPhase: "streaming_model",
      answerPreview: "这是正在流式输出的最终回答正文，内容足够长以便触发去重逻辑。",
      answerStreaming: true,
    });

    expect(items.some((item) => item.kind === "thought" && item.text.includes("我先读取"))).toBe(true);
    expect(items.some((item) => item.kind === "thought" && item.text.includes("最终回答"))).toBe(false);
  });

  it("includes answer-like narrative as thought in single-stream model (no separate answer item)", () => {
    const structured = "## 截图描述\n\n顶部导航栏包含「会话」与「项目」两个 Tab。";
    const feed = buildCursorAgentFeed({
      groups: [{
        turn: 1,
        modelSteps: [],
        toolIds: ["t1"],
        narrative: structured,
        tools: [{
          id: "t1",
          turn: 1,
          name: "grep",
          icon: "🔍",
          title: "代码搜索",
          detail: "panel",
          label: "搜索",
          summary: "ok",
          ok: true,
          args: { pattern: "panel" },
        }],
      }],
      isRunning: true,
      agentPhase: "waiting_model",
      answerPreview: structured,
      streaming: false,
    });
    // In single-stream model, answer-like narrative appears as thought (there's no separate answer item)
    expect(feed.some((item) => item.kind === "thought")).toBe(true);
    expect(feed.some((item) => item.kind === "action")).toBe(true);
  });

  it("includes answer-like narrative as thought while exploring without answer preview", () => {
    const structured = "## 截图描述\n\n顶部导航栏包含「会话」与「项目」两个 Tab。";
    const feed = buildCursorAgentFeed({
      groups: [{
        turn: 1,
        modelSteps: [],
        toolIds: ["t1"],
        narrative: structured,
        tools: [{
          id: "t1",
          turn: 1,
          name: "grep",
          icon: "🔍",
          title: "代码搜索",
          detail: "panel",
          label: "搜索",
          summary: "ok",
          ok: true,
          args: { pattern: "panel" },
        }],
      }],
      isRunning: true,
      agentPhase: "waiting_model",
      answerPreview: "",
      streaming: false,
    });
    expect(feed.some((item) => item.kind === "thought" && item.text.includes("截图描述"))).toBe(true);
  });

  it("includes long streaming narrative as thought while running without answer preview", () => {
    const longNarrative = "让我先梳理一下当前的实现路径，确认入口函数、中间层编排以及最终副作用分别落在哪些模块里。".repeat(2);
    const feed = buildCursorAgentFeed({
      groups: [{
        turn: 1,
        modelSteps: [],
        toolIds: [],
        narrative: longNarrative,
        tools: [],
      }],
      isRunning: true,
      agentPhase: "streaming_model",
      answerPreview: "",
      streaming: true,
    });
    expect(feed.some((item) => item.kind === "thought" && item.text.includes("梳理"))).toBe(true);
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

  it("shows model wait diagnostics instead of a bare waiting label", () => {
    const status = buildCursorCompactLiveStatus({
      msg: {
        id: "assistant-1",
        role: "assistant",
        content: "",
        contextChars: 72000,
        agentTurn: 2,
        agentPhase: "waiting_model",
        roundGroups: [],
        tools: [],
      } as never,
      isRunning: true,
      live: {
        phase: "waiting_model",
        turn: 2,
        maxTurns: 8,
        model: "openai/gpt-5",
        contextChars: 72000,
        waitStartedAt: Date.now() - 52_000,
      },
      liveAgentSource: { agentPhase: "waiting_model", content: "" },
      hasRunningTool: false,
      isActivityDetailed: false,
      roundGroupViews: [],
      answerPreview: "",
    });

    expect(status).toContain("等待模型响应");
    expect(status).toContain("第 2/8 轮");
    expect(status).toContain("gpt-5");
    expect(status).toMatch(/已等待 5[12]s/);
    expect(status).toContain("上下文");
    expect(status).toContain("响应较慢");
  });

  it("buildAgentLiveFooterStatus keeps wait status visible when answer slot is occupied", () => {
    expect(
      buildAgentLiveFooterStatus({
        currentStatus: "正在等待模型响应（第 35/24 轮）…",
        isRunning: true,
        hasAnswer: true,
        agentPhase: "waiting_model",
      }),
    ).toBe("正在等待模型响应（第 35/24 轮）…");
  });

  it("buildAgentLiveFooterStatus keeps thinking status when intermediate narrative exists", () => {
    expect(
      buildAgentLiveFooterStatus({
        currentStatus: "思考中 · 已生成 120 字",
        isRunning: true,
        hasAnswer: true,
        agentPhase: "streaming_model",
      }),
    ).toBe("思考中 · 已生成 120 字");

    expect(
      buildAgentLiveFooterStatus({
        currentStatus: "思考中…",
        isRunning: true,
        hasAnswer: true,
        agentPhase: "planning_tools",
      }),
    ).toBe("思考中…");
  });

  it("splitAgentLiveStatusLine splits phase and meta chips", () => {
    expect(splitAgentLiveStatusLine("")).toEqual({ phase: "运行中…", meta: [] });
    expect(splitAgentLiveStatusLine("Agent 运行中…")).toEqual({
      phase: "Agent 运行中…",
      meta: [],
    });
    expect(splitAgentLiveStatusLine("等待模型响应… · 第 1 轮 · 已等待 1s")).toEqual({
      phase: "等待模型响应…",
      meta: ["第 1 轮", "已等待 1s"],
    });
  });

  it("isAgentWaitingModelPhase detects model wait phases", () => {
    expect(isAgentWaitingModelPhase({ agentPhase: "waiting_model" })).toBe(true);
    expect(isAgentWaitingModelPhase({ statusLine: "等待模型响应… · 第 1 轮" })).toBe(true);
    expect(isAgentWaitingModelPhase({ hasRunningTool: true, agentPhase: "waiting_model" })).toBe(false);
    expect(isAgentWaitingModelPhase({ agentPhase: "streaming_model" })).toBe(false);
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

  it("includes in-feed planning status while waiting without preview", () => {
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
