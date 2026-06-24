import { describe, expect, it } from "vitest";
import type { AgentRoundGroupView } from "./agentRoundGroups";
import {
  buildMergedToolTurn,
  buildTurnCardsFromRoundGroups,
  buildVisibleTurnViews,
  mergeTurnActionsForDisplay,
  turnHasToolSteps,
} from "./agentTurnCards";

function tool(id: string, name: string, path?: string) {
  return {
    id,
    turn: 1,
    name,
    icon: name === "grep" ? "🔍" : "📄",
    title: name === "grep" ? "搜索" : "读取",
    detail: path || id,
    label: name,
    summary: "ok",
    ok: true,
    args: path ? { path } : { pattern: "foo" },
  };
}

describe("agentTurnCards", () => {
  it("builds multiple turns when non-narration thoughts split action batches", () => {
    const groups: AgentRoundGroupView[] = [
      {
        turn: 1,
        modelSteps: [],
        toolIds: ["t1", "t2"],
        narrative: "## 截图描述\n重复的工具卡片。",
        tools: [tool("t1", "grep"), tool("t2", "read_file", "EditorPanel.vue")],
      },
      {
        turn: 2,
        modelSteps: [],
        toolIds: ["t3", "t4"],
        narrative: "## 分析\n继续排查父组件。",
        tools: [tool("t3", "grep"), tool("t4", "read_file", "AppToolbar.vue")],
      },
    ];

    const turns = buildTurnCardsFromRoundGroups(groups, { activityDetailed: true });
    expect(turns.length).toBeGreaterThanOrEqual(2);
    expect(turns.every((t) => t.actions.some((b) => b.visible.length > 0))).toBe(true);
  });

  it("merges duplicate tool steps across turns by step id", () => {
    const turns = buildTurnCardsFromRoundGroups(
      [
        {
          turn: 1,
          modelSteps: [],
          toolIds: ["t1"],
          tools: [tool("t1", "grep")],
        },
        {
          turn: 2,
          modelSteps: [],
          toolIds: ["t1"],
          tools: [tool("t1", "grep")],
        },
      ],
      { activityDetailed: true },
    );

    const merged = mergeTurnActionsForDisplay(turns);
    const visibleCount = merged.reduce((sum, block) => sum + block.visible.length, 0);
    expect(visibleCount).toBe(1);
  });

  it("renders merged tools once via buildMergedToolTurn, not on narrative turns", () => {
    const turns = buildTurnCardsFromRoundGroups(
      [
        {
          turn: 1,
          modelSteps: [],
          toolIds: ["t1", "t2"],
          narrative: "## 第一轮",
          tools: [tool("t1", "grep"), tool("t2", "read_file", "EditorPanel.vue")],
        },
        {
          turn: 2,
          modelSteps: [],
          toolIds: ["t3", "t4"],
          narrative: "## 第二轮",
          tools: [tool("t3", "grep"), tool("t4", "read_file", "AppToolbar.vue")],
        },
      ],
      { activityDetailed: true },
    );

    const views = buildVisibleTurnViews({
      turns,
      visibleTurns: turns,
      isRunning: true,
    });

    expect(views.every((view) => !view.showTools)).toBe(true);
    expect(views.every((view) => view.turn.actions.length === 0)).toBe(true);

    const merged = buildMergedToolTurn(turns);
    expect(merged).not.toBeNull();
    expect(turnHasToolSteps(merged!)).toBe(true);
    expect(mergeTurnActionsForDisplay(turns).reduce((n, b) => n + b.visible.length, 0)).toBe(4);
  });

  it("hides tool row on latest turn when there are no tool steps", () => {
    const turns: ReturnType<typeof buildTurnCardsFromRoundGroups> = [
      { key: "thought-1", text: "纯文字推理", actions: [], isLatest: true },
    ];
    const views = buildVisibleTurnViews({ turns, visibleTurns: turns, isRunning: false });
    expect(views[0]?.showTools).toBe(false);
    expect(buildMergedToolTurn(turns)).toBeNull();
  });

  it("exposes exactly one merged tool turn for multi-round exploration", () => {
    const tools = [
      tool("g1", "grep"),
      tool("g2", "grep"),
      tool("r1", "read_file", "src/components/vibe/AppToolbar.vue"),
      tool("r2", "read_file", "src/components/vibe/AppToolbar.vue"),
      tool("r3", "read_file", "src/components/vibe/AppToolbar.vue"),
      tool("r4", "read_file", "src/components/vibe/AppToolbar.vue"),
    ];

    const groups: AgentRoundGroupView[] = [
      {
        turn: 1,
        modelSteps: [],
        toolIds: tools.map((t) => t.id),
        narrative: "## 排查",
        tools,
      },
      {
        turn: 2,
        modelSteps: [],
        toolIds: tools.map((t) => `2-${t.id}`),
        narrative: "## 继续",
        tools: tools.map((t) => ({ ...t, id: `2-${t.id}` })),
      },
    ];

    const turns = buildTurnCardsFromRoundGroups(groups, { activityDetailed: true, isRunning: true });
    const views = buildVisibleTurnViews({ turns, visibleTurns: turns, isRunning: true });

    expect(views.every((v) => !v.showTools && v.turn.actions.length === 0)).toBe(true);
    expect(buildMergedToolTurn(turns)).not.toBeNull();
  });
});
