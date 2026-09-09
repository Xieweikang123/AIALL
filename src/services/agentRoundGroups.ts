export type AgentModelStep = {
  id: string;
  text: string;
  phase: string;
};

export type AgentTurnRequestDetail = {
  model?: string;
  contextMessages: number;
  contextChars: number;
  messages: Array<{ role: string; content: string; toolCalls?: string }>;
  /** Epoch ms when the request was sent to the model. */
  ts?: number;
};

export type AgentTurnResponseDetail = {
  assistantText: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  hasToolCalls: boolean;
  isFinal: boolean;
  /** Epoch ms when the response arrived from the model. */
  ts?: number;
};

export type AgentRoundGroup = {
  turn: number;
  maxTurns?: number;
  narrative?: string;
  modelSteps: AgentModelStep[];
  toolIds: string[];
  /** Narrative stream length (chars) at the moment each tool started — enables chronological interleave. */
  toolNarrativeOffsets?: Array<{ toolId: string; narrativeChars: number }>;
  request?: AgentTurnRequestDetail;
  response?: AgentTurnResponseDetail;
};

export type AgentRoundTool = {
  id: string;
  turn?: number;
  name: string;
  icon: string;
  title: string;
  detail: string;
  label: string;
  summary: string;
  ok?: boolean;
  running?: boolean;
  lineDelta?: number;
  fullResult?: string;
  args?: Record<string, unknown>;
  /** Epoch ms when the tool started. */
  startTs?: number;
  /** Epoch ms when the tool finished. */
  endTs?: number;
};

export type AgentRoundGroupView = AgentRoundGroup & {
  tools: AgentRoundTool[];
  active?: boolean;
};

const MODEL_LOOP_PHASES = new Set([
  "compacting_context",
  "sending_request",
  "waiting_model",
  "retrying_model",
  "streaming_model",
  "planning_tools",
  "summarizing_tools",
]);

const SETUP_PHASES = new Set([
  "connecting_local",
  "stream_connected",
  "connected",
  "reconnecting",
  "preparing",
  "starting",
  "building_context",
]);

const ROUND_AUX_PHASES = new Set<string>();

let stepIdCounter = 0;

function nextStepId(): string {
  stepIdCounter += 1;
  return `step-${stepIdCounter}`;
}

export function resetAgentRoundGroupIds(): void {
  stepIdCounter = 0;
}

function resolveTurnForPhase(phase: string, turn?: number): number | null {
  if (MODEL_LOOP_PHASES.has(phase) || ROUND_AUX_PHASES.has(phase)) {
    return turn && turn > 0 ? turn : 1;
  }
  if (SETUP_PHASES.has(phase)) return 0;
  return null;
}

function ensureGroup(groups: AgentRoundGroup[], turn: number): AgentRoundGroup {
  let group = groups.find((item) => item.turn === turn);
  if (!group) {
    group = { turn, modelSteps: [], toolIds: [] };
    groups.push(group);
    groups.sort((a, b) => a.turn - b.turn);
  }
  return group;
}

function upsertModelStep(group: AgentRoundGroup, phase: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const last = group.modelSteps[group.modelSteps.length - 1];
  if (last?.phase === phase) {
    last.text = trimmed;
    return;
  }
  group.modelSteps.push({ id: nextStepId(), text: trimmed, phase });
}

export function recordAgentRoundStatus(
  groups: AgentRoundGroup[] | undefined,
  phase: string,
  statusText: string,
  turn?: number,
  maxTurns?: number,
): AgentRoundGroup[] {
  if (!statusText.trim() || phase === "finished" || phase === "aborted") {
    return groups ? [...groups] : [];
  }

  const resolvedTurn = resolveTurnForPhase(phase, turn);
  if (resolvedTurn === null) return groups ? [...groups] : [];

  const next = groups ? groups.map((group) => ({
    ...group,
    modelSteps: group.modelSteps.map((step) => ({ ...step })),
    toolIds: [...group.toolIds],
    request: group.request ? { ...group.request, messages: (group.request.messages || []).map((m) => ({ ...m })) } : undefined,
    response: group.response
      ? { ...group.response, toolCalls: (group.response.toolCalls || []).map((call) => ({ ...call })) }
      : undefined,
  })) : [];

  const group = ensureGroup(next, resolvedTurn);
  if (maxTurns) group.maxTurns = maxTurns;
  upsertModelStep(group, phase, statusText);
  return next;
}

export function recordAgentRoundNarrative(
  groups: AgentRoundGroup[] | undefined,
  turn: number,
  narrative: string | undefined,
  maxTurns?: number,
): AgentRoundGroup[] {
  const text = (narrative ?? "").trim();
  if (!text || turn <= 0) return groups ? [...groups] : [];

  const next = groups ? groups.map((group) => ({
    ...group,
    modelSteps: group.modelSteps.map((step) => ({ ...step })),
    toolIds: [...group.toolIds],
    toolNarrativeOffsets: group.toolNarrativeOffsets?.map((entry) => ({ ...entry })),
    request: group.request ? { ...group.request, messages: (group.request.messages || []).map((m) => ({ ...m })) } : undefined,
    response: group.response
      ? { ...group.response, toolCalls: (group.response.toolCalls || []).map((call) => ({ ...call })) }
      : undefined,
  })) : [];

  const group = ensureGroup(next, turn);
  group.narrative = text;
  if (maxTurns) group.maxTurns = maxTurns;
  return next;
}

export function recordAgentRoundToolStart(
  groups: AgentRoundGroup[] | undefined,
  toolId: string,
  turn?: number,
): AgentRoundGroup[] {
  if (!toolId) return groups ? [...groups] : [];
  const resolvedTurn = turn && turn > 0 ? turn : 1;

  const next = groups ? groups.map((group) => ({
    ...group,
    modelSteps: group.modelSteps.map((step) => ({ ...step })),
    toolIds: [...group.toolIds],
    toolNarrativeOffsets: group.toolNarrativeOffsets?.map((entry) => ({ ...entry })),
    request: group.request ? { ...group.request, messages: (group.request.messages || []).map((m) => ({ ...m })) } : undefined,
    response: group.response
      ? { ...group.response, toolCalls: (group.response.toolCalls || []).map((call) => ({ ...call })) }
      : undefined,
  })) : [];

  const group = ensureGroup(next, resolvedTurn);
  if (!group.toolIds.includes(toolId)) {
    group.toolIds.push(toolId);
    if (!group.toolNarrativeOffsets) group.toolNarrativeOffsets = [];
    if (!group.toolNarrativeOffsets.some((entry) => entry.toolId === toolId)) {
      group.toolNarrativeOffsets.push({ toolId, narrativeChars: group.narrative?.length ?? 0 });
    }
  }
  return next;
}

function cloneRoundGroups(groups: AgentRoundGroup[] | undefined): AgentRoundGroup[] {
  return groups
    ? groups.map((group) => ({
        ...group,
        modelSteps: group.modelSteps.map((step) => ({ ...step })),
        toolIds: [...group.toolIds],
        toolNarrativeOffsets: group.toolNarrativeOffsets?.map((entry) => ({ ...entry })),
        request: group.request
          ? {
              ...group.request,
              messages: (group.request.messages || []).map((message) => ({ ...message })),
            }
          : undefined,
        response: group.response
          ? {
              ...group.response,
              toolCalls: (group.response.toolCalls || []).map((call) => ({ ...call })),
            }
          : undefined,
      }))
    : [];
}

/** Keep streamed narrative when turn_response arrives with a shorter server snapshot. */
function mergeRoundNarrative(existing: string, incoming: string): string {
  const prev = existing.trim();
  const next = incoming.trim();
  if (!prev) return next;
  if (!next) return prev;
  if (prev === next) return prev;
  if (prev.includes(next)) return prev;
  if (next.includes(prev)) return next;
  if (next.length >= prev.length * 0.85) return next;
  return prev;
}

/** Highest turn that still lacks `isFinal` (stream / tools in progress). */
export function resolveIncompleteStreamTurn(msg: {
  roundGroups?: AgentRoundGroup[];
  agentTurn?: number;
}): number | undefined {
  const groups = msg.roundGroups || [];
  const active = msg.agentTurn;
  if (active && active > 0) {
    const group = groups.find((g) => g.turn === active);
    if (group && !group.response?.isFinal) return active;
  }
  const incomplete = groups
    .filter((g) => g.turn > 0 && !g.response?.isFinal)
    .sort((a, b) => b.turn - a.turn);
  return incomplete[0]?.turn;
}

/**
 * Highest turn slot occupied by an assistant message's original run — the offset
 * a resumed connection shifts its per-connection turns by, so roundGroups slots
 * stay unique and resumed rounds append after the original ones.
 */
export function resolveResumeTurnOffset(msg: {
  roundGroups?: AgentRoundGroup[];
  agentTurn?: number;
}): number {
  const fromGroups = (msg.roundGroups ?? []).reduce(
    (max, group) => (group.turn > max ? group.turn : max),
    0,
  );
  // agentTurn is the in-flight turn; slots below it are already occupied.
  const fromActive = msg.agentTurn && msg.agentTurn > 0 ? msg.agentTurn - 1 : 0;
  return Math.max(fromGroups, fromActive, 0);
}

/** Drop streamed narrative on an incomplete turn; keep tools / request / steps. */
export function truncateIncompleteTurnNarrative(
  groups: AgentRoundGroup[] | undefined,
  turn: number,
): AgentRoundGroup[] {
  if (!groups?.length || turn <= 0) return groups ? cloneRoundGroups(groups) : [];
  const next = cloneRoundGroups(groups);
  const group = next.find((g) => g.turn === turn);
  if (group && !group.response?.isFinal) {
    group.narrative = undefined;
  }
  return next;
}

export function recordAgentRoundRequest(
  groups: AgentRoundGroup[] | undefined,
  turn: number,
  detail: AgentTurnRequestDetail,
  maxTurns?: number,
): AgentRoundGroup[] {
  if (turn <= 0) return groups ? cloneRoundGroups(groups) : [];
  const next = cloneRoundGroups(groups);
  const group = ensureGroup(next, turn);
  group.request = detail;
  if (maxTurns) group.maxTurns = maxTurns;
  return next;
}

export function recordAgentRoundResponse(
  groups: AgentRoundGroup[] | undefined,
  turn: number,
  detail: AgentTurnResponseDetail,
  maxTurns?: number,
): AgentRoundGroup[] {
  if (turn <= 0) return groups ? cloneRoundGroups(groups) : [];
  const next = cloneRoundGroups(groups);
  const group = ensureGroup(next, turn);
  group.response = {
    ...detail,
    toolCalls: (detail.toolCalls || []).map((call) => ({ ...call })),
  };
  if (detail.assistantText.trim()) {
    // On isFinal, replace corrupt/partial stream with the authoritative snapshot.
    group.narrative = detail.isFinal
      ? detail.assistantText.trim()
      : mergeRoundNarrative(group.narrative || "", detail.assistantText.trim());
  }
  if (maxTurns) group.maxTurns = maxTurns;
  return next;
}

export function recordAgentRoundStreamDelta(
  groups: AgentRoundGroup[] | undefined,
  turn: number,
  delta: string,
  maxTurns?: number,
): AgentRoundGroup[] {
  const chunk = delta;
  if (!chunk || turn <= 0) return groups ? cloneRoundGroups(groups) : [];
  const next = cloneRoundGroups(groups);
  const group = ensureGroup(next, turn);
  group.narrative = `${group.narrative || ""}${delta}`;
  if (maxTurns) group.maxTurns = maxTurns;
  return next;
}

export function buildRoundGroupsFromLegacy(input: {
  turnTraces?: Array<{ turn: number; maxTurns?: number; assistantText: string }>;
  statusLog?: string[];
  tools?: AgentRoundTool[];
}): AgentRoundGroup[] {
  const traces = input.turnTraces || [];
  if (traces.length) {
    const groups: AgentRoundGroup[] = traces.map((trace) => ({
      turn: trace.turn,
      maxTurns: trace.maxTurns,
      narrative: trace.assistantText,
      modelSteps: [],
      toolIds: [],
    }));
    const tools = input.tools || [];
    if (tools.length) {
      const last = groups[groups.length - 1];
      last.toolIds = tools.filter((tool) => tool.turn === undefined || tool.turn === last.turn).map((tool) => tool.id);
      const unassigned = tools.filter((tool) => tool.turn !== undefined && tool.turn !== last.turn);
      for (const tool of unassigned) {
        const group = groups.find((item) => item.turn === tool.turn);
        if (group && !group.toolIds.includes(tool.id)) group.toolIds.push(tool.id);
      }
    }
    return groups;
  }

  const statusLog = (input.statusLog || []).filter(Boolean);
  if (!statusLog.length) return [];

  return [{
    turn: 0,
    modelSteps: statusLog.map((line) => ({
      id: nextStepId(),
      text: line,
      phase: "legacy",
    })),
    toolIds: (input.tools || []).map((tool) => tool.id),
  }];
}

export function buildAgentRoundGroupViews(input: {
  roundGroups?: AgentRoundGroup[];
  turnTraces?: Array<{ turn: number; maxTurns?: number; assistantText: string }>;
  statusLog?: string[];
  tools?: AgentRoundTool[];
  activeTurn?: number;
  activePhase?: string;
}): AgentRoundGroupView[] {
  const groups = input.roundGroups?.length
    ? input.roundGroups
    : buildRoundGroupsFromLegacy({
        turnTraces: input.turnTraces,
        statusLog: input.statusLog,
        tools: input.tools,
      });

  const toolMap = new Map((input.tools || []).map((tool) => [tool.id, tool]));

  return groups
    .map((group) => ({
      ...group,
      tools: group.toolIds.map((id) => toolMap.get(id)).filter((tool): tool is AgentRoundTool => Boolean(tool)),
      active: input.activeTurn === group.turn && Boolean(input.activePhase),
    }))
    .filter((group) =>
      group.turn === 0 ||
      group.narrative ||
      group.modelSteps.length ||
      group.tools.length ||
      group.request ||
      group.response,
    );
}

export function isModelLoopPhase(phase?: string): boolean {
  return Boolean(phase && MODEL_LOOP_PHASES.has(phase));
}
