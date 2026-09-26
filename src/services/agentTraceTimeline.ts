import type { AgentRoundGroupView } from "./agentRoundGroups";
import {
  DEFAULT_AGENT_TRACE_DETAIL,
  collapseTracePreview,
  resolveAgentTraceDetailSpec,
  shouldExpandTraceKind,
  truncateTraceDetail,
  type AgentTraceDetailLevel,
  type AgentTraceEntryKind,
} from "./agentTraceDetail";

export type { AgentTraceEntryKind };

export type AgentTraceEntry = {
  key: string;
  kind: AgentTraceEntryKind;
  /** Short one-line label shown in the collapsed row. */
  label: string;
  /** Extended body (JSON / full text) revealed when the row is expanded. */
  detail: string;
  ok?: boolean;
  /** Elapsed ms for this entry, when a start/end timestamp pair is available. */
  elapsedMs?: number;
  /** Thinking entry still being produced — drives the live dot / streaming. */
  streaming?: boolean;
  /** Character count for reasoning entries (shown in the collapsed row). */
  chars?: number;
  /**
   * 当前档位下该条目正文默认展开。由**详细度档位**决定（不是条目自身性质）——
   * 用户点箭头仍可临时切换（override 存在面板里）。
   */
  expandedByDefault?: boolean;
};

export type AgentTraceTurn = {
  turn: number;
  model?: string;
  contextChars?: number;
  entries: AgentTraceEntry[];
};

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 统一收口：给每条条目按档位打上"默认是否展开"和 label。 */
function withDetail(entry: Omit<AgentTraceEntry, "expandedByDefault">, level: AgentTraceDetailLevel): AgentTraceEntry {
  return {
    ...entry,
    expandedByDefault: shouldExpandTraceKind(entry.kind, level),
  };
}

function requestEntry(turn: AgentRoundGroupView, level: AgentTraceDetailLevel): AgentTraceEntry[] {
  const request = turn.request;
  if (!request) return [];
  const messages = request.messages || [];
  if (!messages.length) return [];

  const roleLabel = (role: string): string =>
    role === "user" ? "用户" : role === "assistant" ? "助手" : role === "system" ? "系统" : role;
  const preview = (content: string): string => collapseTracePreview(content, level);

  const entries: AgentTraceEntry[] = [];

  // 历史上下文合并为一行，展开可见每条内容，避免逐条刷屏
  if (messages.length > 1) {
    const history = messages.slice(0, -1);
    const chars = history.reduce((sum, m) => sum + m.content.length, 0);
    const charsLabel = chars >= 1000 ? `${(chars / 1000).toFixed(1)}K` : `${chars}`;
    entries.push(
      withDetail(
        {
          key: `req-${turn.turn}-ctx`,
          kind: "request",
          label: `上下文 · ${history.length} 条历史消息（${charsLabel} 字符）`,
          detail: truncateTraceDetail(
            history.map((m, index) => `[${index + 1}] ${m.role}：${m.content}`).join("\n\n"),
            level,
          ),
          ok: true,
        },
        level,
      ),
    );
  }

  const last = messages[messages.length - 1];
  entries.push(
    withDetail(
      {
        key: `req-${turn.turn}-last`,
        kind: "request",
        label: `发给模型 · ${roleLabel(last.role)}：${preview(last.content) || "（空）"}`,
        detail: truncateTraceDetail(
          formatJson({
            role: last.role,
            content: last.content,
            ...(last.toolCalls ? { toolCalls: last.toolCalls } : {}),
          }),
          level,
        ),
        ok: true,
      },
      level,
    ),
  );
  return entries;
}

/**
 * 思考（provider reasoning channel）作为**独立条目**。
 *
 * 展开与否由档位决定（标准档起就默认展开）——思考是「过程」，要能边跑边看。
 * 运行态由调用方传入：**不能**只用 `!turn.response?.isFinal` 判断，中断时
 * 某些轮次永远拿不到 `isFinal`，「思考中…」会一直挂着不收。
 */
function reasoningEntry(
  turn: AgentRoundGroupView,
  level: AgentTraceDetailLevel,
  isRunning: boolean,
): AgentTraceEntry[] {
  const text = turn.reasoning?.trim() ?? "";
  if (!text) return [];
  const streaming = isRunning && !turn.response?.isFinal;
  const label = streaming
    ? `思考中…（${text.length} 字符）`
    : `思考过程（${text.length} 字符）`;
  return [
    withDetail(
      {
        key: `reason-${turn.turn}`,
        kind: "reasoning",
        label,
        detail: truncateTraceDetail(text, level),
        ok: true,
        streaming,
        chars: text.length,
      },
      level,
    ),
  ];
}

function responseEntry(turn: AgentRoundGroupView, level: AgentTraceDetailLevel): AgentTraceEntry[] {
  const response = turn.response;
  if (!response) return [];
  const text = response.assistantText?.trim() ?? "";
  const toolCalls = response.toolCalls || [];
  const label = response.isFinal
    ? `最终回复（${text.length} 字符）`
    : `轮次回复（${text.length} 字符）`;

  // 工具名兜底：优先取 call 自带字段，其次按 id 从 turn.tools（工具执行后的真实记录）匹配
  const toolName = (call: { id?: string; name?: string; function?: { name?: string } }): string => {
    if (call.name) return call.name;
    if (call.function?.name) return call.function.name;
    const matched = turn.tools.find((tool) => tool.id === call.id);
    return matched?.name || "未知工具";
  };
  const toolArgs = (call: { arguments?: string; function?: { arguments?: string } }): string =>
    (call.arguments ?? call.function?.arguments ?? "").trim();

  const toolSummary = toolCalls.length
    ? `调用 ${toolCalls.length} 个工具：${toolCalls.map(toolName).join("、")}`
    : "";

  const elapsedMs =
    response.ts !== undefined && turn.request?.ts !== undefined
      ? response.ts - turn.request.ts
      : undefined;

  const detailParts: string[] = [];
  if (text) detailParts.push(text);
  if (toolCalls.length) {
    detailParts.push(
      toolCalls
        .map((call) => {
          const args = toolArgs(call);
          return `工具调用：${toolName(call)}${args ? `\n参数：\n${args}` : ""}`;
        })
        .join("\n\n"),
    );
  }
  if (!detailParts.length) detailParts.push("（本轮无正文，也无工具调用）");

  return [
    withDetail(
      {
        key: `resp-${turn.turn}`,
        kind: "response",
        label: text
          ? `${label}：${collapseTracePreview(text, level)}`
          : toolSummary
            ? `${label}（无正文）· ${toolSummary}`
            : `${label}（无正文）`,
        detail: truncateTraceDetail(detailParts.join("\n\n"), level),
        ok: true,
        elapsedMs,
      },
      level,
    ),
  ];
}

function toolEntries(turn: AgentRoundGroupView, level: AgentTraceDetailLevel): AgentTraceEntry[] {
  return (turn.tools ?? []).map((tool) =>
    withDetail(
      {
        key: `tool-${tool.id}`,
        kind: "tool" as const,
        label: `${tool.icon} ${tool.title}：${tool.detail || tool.label}`,
        detail: truncateTraceDetail(
          [
            tool.args ? `参数：\n${formatJson(tool.args)}` : "",
            `结果：${tool.summary || "（无摘要）"}`,
            tool.fullResult ? `\n完整结果：\n${tool.fullResult}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          level,
        ),
        ok: tool.ok,
        elapsedMs:
          tool.startTs !== undefined && tool.endTs !== undefined
            ? tool.endTs - tool.startTs
            : undefined,
      },
      level,
    ),
  );
}

/** Transient model-loop states — implied by the request/response/tool rows once a reply exists. */
const TRANSIENT_LOOP_PHASES = new Set([
  "compacting_context",
  "sending_request",
  "waiting_model",
  "streaming_model",
  "planning_tools",
  "summarizing_tools",
]);

function phaseEntries(turn: AgentRoundGroupView, level: AgentTraceDetailLevel): AgentTraceEntry[] {
  const spec = resolveAgentTraceDetailSpec(level);
  const replied = turn.response != null;
  return turn.modelSteps
    .filter((step) => {
      if (step.phase === "legacy") return true;
      // 未回复的轮次里，这些阶段正是「卡在哪一步」的线索 —— 任何档位都要留
      if (!replied) return true;
      // 已有回复时瞬态 loop 阶段只是噪音，除非档位明确要
      if (spec.transientPhases) return true;
      return !TRANSIENT_LOOP_PHASES.has(step.phase);
    })
    .map((step, index) =>
      withDetail(
        {
          key: `phase-${turn.turn}-${index}`,
          kind: "phase" as const,
          label: `⏳ ${step.text}`,
          detail: truncateTraceDetail(step.text, level),
          ok: true,
        },
        level,
      ),
    );
}

/**
 * 折叠行标题该取哪条条目。
 *
 * **不能取最后一条**：phase 条目排在最后，而它记的是「那一轮开头发请求时的等待快照」，
 * 之后模型回复 / 工具执行都不会回头改写它（只有 SSE `status` 事件会写 modelSteps，
 * 服务端每轮只 emit 一次 `waiting_model`）。于是每轮折叠行都停在
 * 「⏳ 正在等待模型响应（第 N/M 轮）」—— 看着像卡住，其实那轮早跑完了。
 *
 * 取值优先级：
 *   1. response —— 这轮真正产出了什么（正文 / 工具调用），已回复轮次的正确答案
 *   2. 其他非 phase 条目里最后一条 —— 未回复但已经在读文件 / 跑工具时，显示最后一步动作
 *   3. phase —— 只在这轮**什么都还没有**（只有等待态）时兜底，此时它才是真实当前状态
 */
export function pickTurnHeadlineEntry(turn: AgentTraceTurn): AgentTraceEntry | undefined {
  const response = turn.entries.find((entry) => entry.kind === "response");
  if (response) return response;
  const lastReal = [...turn.entries].reverse().find((entry) => entry.kind !== "phase");
  if (lastReal) return lastReal;
  return turn.entries[turn.entries.length - 1];
}

/**
 * Build the full data-flow trace (what was sent / replied / thought / executed) per turn.
 *
 * **条目集合不随档位变化**：档位只决定 `expandedByDefault`（谁展开）与正文长度。
 * 唯一例外是瞬态 loop 阶段 —— 那是噪音开关，不算"内容消失"。
 */
export function buildAgentTraceTurns(
  groups: AgentRoundGroupView[],
  level: AgentTraceDetailLevel = DEFAULT_AGENT_TRACE_DETAIL,
  isRunning = false,
): AgentTraceTurn[] {
  const turns: AgentTraceTurn[] = [];
  for (const group of groups) {
    if (group.turn <= 0) continue;
    const entries = [
      ...requestEntry(group, level),
      ...reasoningEntry(group, level, isRunning),
      ...responseEntry(group, level),
      ...toolEntries(group, level),
      ...phaseEntries(group, level),
    ];
    if (!entries.length) continue;
    turns.push({
      turn: group.turn,
      model: group.request?.model,
      contextChars: group.request?.contextChars,
      entries,
    });
  }
  return turns;
}
