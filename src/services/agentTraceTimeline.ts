import type { AgentRoundGroupView } from "./agentRoundGroups";
import {
  DEFAULT_AGENT_TRACE_VIEW,
  collapseTracePreview,
  shouldExpandTraceKind,
  truncateTraceDetail,
  type AgentTraceEntryKind,
  type AgentTraceViewConfig,
} from "./agentTraceView";

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
   * 当前配置下该条目正文默认展开。由**显示配置**决定（不是条目自身性质）——
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

/** 统一收口：给每条条目按配置打上"默认是否展开"。 */
function withDetail(
  entry: Omit<AgentTraceEntry, "expandedByDefault">,
  view: AgentTraceViewConfig,
): AgentTraceEntry {
  return {
    ...entry,
    expandedByDefault: shouldExpandTraceKind(entry.kind, view),
  };
}

function requestEntry(turn: AgentRoundGroupView, view: AgentTraceViewConfig): AgentTraceEntry[] {
  const request = turn.request;
  if (!request) return [];
  const messages = request.messages || [];
  if (!messages.length) return [];

  const roleLabel = (role: string): string =>
    role === "user" ? "用户" : role === "assistant" ? "助手" : role === "system" ? "系统" : role;
  const preview = (content: string): string => collapseTracePreview(content, view);

  // 逐条线性列出，**保持 messages 原始顺序**（system → 历史 → 本轮 user）。
  // 早先按「历史合并一行 + 最后一条单独一行」分组，会把 system 算进「历史」，
  // 首轮就显示成「1 条历史消息」，与实际不符；system 也可能不在首位。
  // 现在每条一个条目：system 单独可见，历史不再与 system 混计。
  const entries: AgentTraceEntry[] = [];
  const withChars = (content: string): string => {
    const count = content.length;
    return count >= 1000 ? `${(count / 1000).toFixed(1)}K 字符` : `${count} 字符`;
  };

  messages.forEach((message, index) => {
    const isSystem = message.role === "system";
    const chars = withChars(message.content);
    const body = preview(message.content) || "（空）";
    entries.push(
      withDetail(
        {
          key: `req-${turn.turn}-${index}-${message.role}`,
          kind: "request",
          label: isSystem
            ? `系统提示词（${chars}）：${body}`
            : `发给模型 · ${roleLabel(message.role)}（${chars}）：${body}`,
          detail: truncateTraceDetail(
            formatJson({
              role: message.role,
              content: message.content,
              ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
            }),
            view,
          ),
          ok: true,
        },
        view,
      ),
    );
  });
  return entries;
}

/**
 * 思考（provider reasoning channel）作为**独立条目**。
 *
 * 展开与否由显示配置决定（默认就是展开的）——思考是「过程」，要能边跑边看。
 *
 * 运行态由调用方传入，且**只在最新一轮**为真（见 `buildAgentTraceTurns` 的
 * `activeTurn`）。这里**绝不能**再退回 `isRunning && !turn.response?.isFinal`：
 * 后端的 `isFinal` 语义是「本轮没有工具调用」（`run_stream.rs`：
 * `is_final = accumulated_tool_calls.is_empty()`），于是**任何调过工具的轮次
 * 其 `isFinal` 恒为 false**。用它当运行判据，会让每一轮的思考条目在整个运行期间
 * 永远挂着「思考中…」——用户看到的正是「第 1、2 轮早跑完了还显示思考中」。
 */
function reasoningEntry(
  turn: AgentRoundGroupView,
  view: AgentTraceViewConfig,
  isRunning: boolean,
): AgentTraceEntry[] {
  const text = turn.reasoning?.trim() ?? "";
  if (!text) return [];
  const streaming = isRunning;
  const label = streaming
    ? `思考中…（${text.length} 字符）`
    : `思考过程（${text.length} 字符）`;
  return [
    withDetail(
      {
        key: `reason-${turn.turn}`,
        kind: "reasoning",
        label,
        detail: truncateTraceDetail(text, view),
        ok: true,
        streaming,
        chars: text.length,
      },
      view,
    ),
  ];
}

function responseEntry(turn: AgentRoundGroupView, view: AgentTraceViewConfig): AgentTraceEntry[] {
  const response = turn.response;
  if (!response) return [];
  const text = response.assistantText?.trim() ?? "";
  const toolCalls = response.toolCalls || [];
  const baseLabel = response.isFinal ? "最终回复" : "轮次回复";
  // 无正文时不再报「0 字符」——下面会补「（无正文）」，两个括号挨着读着别扭
  const label = text ? `${baseLabel}（${text.length} 字符）` : baseLabel;

  // 工具名兜底：优先取 call 自带字段，其次按 id 从 turn.tools（工具执行后的真实记录）匹配
  const toolName = (call: { id?: string; name?: string; function?: { name?: string } }): string => {
    if (call.name) return call.name;
    if (call.function?.name) return call.function.name;
    const matched = turn.tools.find((tool) => tool.id === call.id);
    return matched?.name || "未知工具";
  };
  const toolArgs = (call: { arguments?: string; function?: { arguments?: string } }): string =>
    (call.arguments ?? call.function?.arguments ?? "").trim();

  // 同名工具连续调用很常见（grep、grep），去重计次比原样罗列清爽
  const toolCounts = new Map<string, number>();
  for (const call of toolCalls) {
    const name = toolName(call);
    toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
  }
  const toolSummary = toolCalls.length
    ? `调用 ${toolCalls.length} 个工具：${[...toolCounts]
        .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
        .join("、")}`
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
          ? `${label}：${collapseTracePreview(text, view)}`
          : toolSummary
            ? `${label}（无正文）· ${toolSummary}`
            : `${label}（无正文）`,
        detail: truncateTraceDetail(detailParts.join("\n\n"), view),
        ok: true,
        elapsedMs,
      },
      view,
    ),
  ];
}

function toolEntries(turn: AgentRoundGroupView, view: AgentTraceViewConfig): AgentTraceEntry[] {
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
          view,
        ),
        ok: tool.ok,
        elapsedMs:
          tool.startTs !== undefined && tool.endTs !== undefined
            ? tool.endTs - tool.startTs
            : undefined,
      },
      view,
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

function phaseEntries(turn: AgentRoundGroupView, view: AgentTraceViewConfig): AgentTraceEntry[] {
  const replied = turn.response != null;
  return turn.modelSteps
    .filter((step) => {
      if (step.phase === "legacy") return true;
      // 未回复的轮次里，这些阶段正是「卡在哪一步」的线索 —— 任何配置都要留
      if (!replied) return true;
      // 已有回复时瞬态 loop 阶段只是噪音，除非配置明确要
      if (view.transientPhases) return true;
      return !TRANSIENT_LOOP_PHASES.has(step.phase);
    })
    .map((step, index) =>
      withDetail(
        {
          key: `phase-${turn.turn}-${index}`,
          kind: "phase" as const,
          label: `⏳ ${step.text}`,
          detail: truncateTraceDetail(step.text, view),
          ok: true,
        },
        view,
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
 * **条目集合不随配置变化**：显示配置只决定 `expandedByDefault`（谁展开）与正文长度。
 * 唯一例外是瞬态 loop 阶段 —— 那是噪音开关，不算"内容消失"。
 */
export function buildAgentTraceTurns(
  groups: AgentRoundGroupView[],
  view: AgentTraceViewConfig = DEFAULT_AGENT_TRACE_VIEW,
  isRunning = false,
): AgentTraceTurn[] {
  /**
   * 「思考中」只属于**最新开跑的那一轮**。
   *
   * `isRunning` 说的是"整个运行还在跑"，不能直接套到每一轮上——跑完的老轮次
   * 也满足它。这里取轮次号最大的那条作为当前轮：它还没产出时才是真的在思考，
   * 老轮次照常显示「思考过程」。
   */
  const activeTurn = groups.reduce((max, group) => (group.turn > max ? group.turn : max), 0);

  const turns: AgentTraceTurn[] = [];
  for (const group of groups) {
    if (group.turn <= 0) continue;
    const entries = [
      ...requestEntry(group, view),
      ...reasoningEntry(group, view, isRunning && group.turn === activeTurn),
      ...responseEntry(group, view),
      ...toolEntries(group, view),
      ...phaseEntries(group, view),
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
