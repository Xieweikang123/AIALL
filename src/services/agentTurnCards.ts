import type { AgentRoundGroupView } from "./agentRoundGroups";
import type { CursorFeedItem, CursorFeedProcessBlock } from "./agentCursorFeed";
import { layoutCursorFeedBlocks } from "./agentCursorFeed";
import { filterDuplicateFeedThoughts, isAgentToolTurnNarration } from "./agentMessageDisplay";
import { stripTextToolCallMarkup } from "./textToolCallMarkup";

export type TurnActionsBlock = Extract<CursorFeedProcessBlock, { kind: "actions" }>;

export type AgentTurnCardModel = {
  key: string;
  text: string;
  actions: TurnActionsBlock[];
  isLatest: boolean;
};

export type BuildTurnCardsOptions = {
  finalAnswer?: string;
  activityDetailed?: boolean;
  isRunning?: boolean;
  answerStreaming?: boolean;
};

export function buildTurnCardsFromRoundGroups(
  roundGroups: AgentRoundGroupView[],
  options: BuildTurnCardsOptions = {},
): AgentTurnCardModel[] {
  const items: CursorFeedItem[] = [];
  const answer = (options.finalAnswer || "").trim();

  for (const group of roundGroups) {
    if (group.turn <= 0 && !group.narrative) continue;
    const narrativeText = stripTextToolCallMarkup(group.narrative || "").trim();
    if (narrativeText) {
      items.push({ kind: "thought", key: `thought-${group.turn}`, text: narrativeText });
    }
    for (const tool of group.tools) {
      items.push({ kind: "action", key: tool.id, step: tool });
    }
  }

  const filtered = filterDuplicateFeedThoughts(items, answer, {
    suppressAllWhenBubble: Boolean(options.isRunning && answer),
  });
  const detailed = options.activityDetailed === true;
  const collapseAfter = options.isRunning ? 999 : detailed ? 10 : 5;
  const blocks = layoutCursorFeedBlocks(filtered, {
    keepVisible: detailed ? 8 : 6,
    collapseAfter,
  });

  const turns: AgentTurnCardModel[] = [];
  let current: AgentTurnCardModel | null = null;

  for (const block of blocks) {
    if (block.kind === "thought") {
      if (isAgentToolTurnNarration(block.text)) continue;
      if (current) turns.push(current);
      current = { key: block.key, text: block.text, actions: [], isLatest: false };
    } else if (block.kind === "actions") {
      if (current) {
        current.actions.push(block);
      } else if (turns.length) {
        turns[turns.length - 1].actions.push(block);
      } else {
        turns.push({ key: block.key, text: "", actions: [block], isLatest: false });
        current = turns[turns.length - 1];
      }
    }
  }
  if (current) turns.push(current);

  if (turns.length) turns[turns.length - 1].isLatest = true;
  return turns;
}

/** Merge tool steps from all turns (dedupe by step id) for a single chip row. */
export function mergeTurnActionsForDisplay(turns: AgentTurnCardModel[]): TurnActionsBlock[] {
  const seen = new Set<string>();
  const merged: TurnActionsBlock[] = [];

  for (const turn of turns) {
    for (const block of turn.actions) {
      const visible = block.visible.filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });
      const collapsed = block.collapsed.filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });
      if (visible.length || collapsed.length) {
        merged.push({ ...block, visible, collapsed });
      }
    }
  }
  return merged;
}

export function turnHasToolSteps(turn: Pick<AgentTurnCardModel, "actions">): boolean {
  return turn.actions.some((block) => block.visible.length > 0 || block.collapsed.length > 0);
}

export type AgentTurnCardView = {
  key: string;
  turn: AgentTurnCardModel;
  running: boolean;
  showTools: boolean;
};

export function buildVisibleTurnViews(input: {
  turns: AgentTurnCardModel[];
  visibleTurns: AgentTurnCardModel[];
  isRunning: boolean;
}): AgentTurnCardView[] {
  const mergedActions = mergeTurnActionsForDisplay(input.turns);
  const mergedTurn: AgentTurnCardModel = {
    key: "merged-tools",
    text: "",
    actions: mergedActions,
    isLatest: true,
  };
  const showMergedTools = turnHasToolSteps(mergedTurn);

  return input.visibleTurns.map((turn) => ({
    key: turn.key,
    running: turn.isLatest && input.isRunning,
    turn: turn.isLatest
      ? { ...turn, actions: mergedActions }
      : { ...turn, actions: [] }, // 清空非最新 turn 的 actions，避免工具步骤重复显示
    showTools: turn.isLatest && showMergedTools,
  }));
}
