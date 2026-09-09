import type { AgentRoundGroupView } from "./agentRoundGroups";

export type AgentTraceEntry = {
  key: string;
  kind: "request" | "response" | "tool" | "phase";
  /** Short one-line label shown in the collapsed row. */
  label: string;
  /** Extended body (JSON / full text) revealed when the row is expanded. */
  detail: string;
  ok?: boolean;
  /** Elapsed ms for this entry, when a start/end timestamp pair is available. */
  elapsedMs?: number;
};

export type AgentTraceTurn = {
  turn: number;
  model?: string;
  contextChars?: number;
  entries: AgentTraceEntry[];
};

const MAX_DETAIL_CHARS = 20_000;

function truncateDetail(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_DETAIL_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_DETAIL_CHARS)}\n…（已截断，共 ${trimmed.length} 字符）`;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function requestEntry(turn: AgentRoundGroupView): AgentTraceEntry[] {
  const request = turn.request;
  if (!request) return [];
  const messages = request.messages || [];
  if (!messages.length) return [];

  const roleLabel = (role: string): string =>
    role === "user" ? "用户" : role === "assistant" ? "助手" : role === "system" ? "系统" : role;
  const preview = (content: string): string => content.replace(/\s+/g, " ").slice(0, 160);

  const entries: AgentTraceEntry[] = [];

  // 历史上下文合并为一行，展开可见每条内容，避免逐条刷屏
  if (messages.length > 1) {
    const history = messages.slice(0, -1);
    const chars = history.reduce((sum, m) => sum + m.content.length, 0);
    const charsLabel = chars >= 1000 ? `${(chars / 1000).toFixed(1)}K` : `${chars}`;
    entries.push({
      key: `req-${turn.turn}-ctx`,
      kind: "request",
      label: `上下文 · ${history.length} 条历史消息（${charsLabel} 字符）`,
      detail: truncateDetail(
        history.map((m, index) => `[${index + 1}] ${m.role}：${m.content}`).join("\n\n"),
      ),
      ok: true,
    });
  }

  const last = messages[messages.length - 1];
  entries.push({
    key: `req-${turn.turn}-last`,
    kind: "request",
    label: `发给模型 · ${roleLabel(last.role)}：${preview(last.content) || "（空）"}`,
    detail: truncateDetail(
      formatJson({
        role: last.role,
        content: last.content,
        ...(last.toolCalls ? { toolCalls: last.toolCalls } : {}),
      }),
    ),
    ok: true,
  });
  return entries;
}

function responseEntry(turn: AgentRoundGroupView): AgentTraceEntry[] {
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

  // 正文为空时，模型实际回复的是「要调用哪些工具」——把工具调用内容露出来
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
    {
      key: `resp-${turn.turn}`,
      kind: "response",
      label: text
        ? `${label}：${text.replace(/\s+/g, " ").slice(0, 120)}`
        : toolSummary
          ? `${label}（无正文）· ${toolSummary}`
          : `${label}（无正文）`,
      detail: truncateDetail(detailParts.join("\n\n")),
      ok: true,
      elapsedMs,
    },
  ];
}

function toolEntries(turn: AgentRoundGroupView): AgentTraceEntry[] {
  return (turn.tools ?? []).map((tool) => ({
    key: `tool-${tool.id}`,
    kind: "tool" as const,
    label: `${tool.icon} ${tool.title}：${tool.detail || tool.label}`,
    detail: truncateDetail(
      [
        tool.args ? `参数：\n${formatJson(tool.args)}` : "",
        `结果：${tool.summary || "（无摘要）"}`,
        tool.fullResult ? `\n完整结果：\n${tool.fullResult}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
    ok: tool.ok,
    elapsedMs:
      tool.startTs !== undefined && tool.endTs !== undefined
        ? tool.endTs - tool.startTs
        : undefined,
  }));
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

function phaseEntries(turn: AgentRoundGroupView): AgentTraceEntry[] {
  const replied = turn.response != null;
  return turn.modelSteps
    .filter((step) => !(replied && TRANSIENT_LOOP_PHASES.has(step.phase)))
    .map((step, index) => ({
      key: `phase-${turn.turn}-${index}`,
      kind: "phase" as const,
      label: `⏳ ${step.text}`,
      detail: step.text,
      ok: true,
    }));
}

/** Build the full data-flow trace (what was sent / replied / executed) per turn. */
export function buildAgentTraceTurns(groups: AgentRoundGroupView[]): AgentTraceTurn[] {
  const turns: AgentTraceTurn[] = [];
  for (const group of groups) {
    if (group.turn <= 0) continue;
    const entries = [
      ...requestEntry(group),
      ...responseEntry(group),
      ...toolEntries(group),
      ...phaseEntries(group),
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