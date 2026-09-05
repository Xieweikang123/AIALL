import type { AgentRoundGroupView } from "./agentRoundGroups";

export type AgentTraceEntry = {
  key: string;
  kind: "request" | "response" | "tool" | "phase";
  /** Short one-line label shown in the collapsed row. */
  label: string;
  /** Extended body (JSON / full text) revealed when the row is expanded. */
  detail: string;
  ok?: boolean;
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
  const entries: AgentTraceEntry[] = [];
  const messages = request.messages || [];
  for (const [index, message] of messages.entries()) {
    const isLast = index === messages.length - 1;
    const roleLabel = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : message.role;
    const preview = message.content.replace(/\s+/g, " ").slice(0, 160);
    entries.push({
      key: `req-${turn.turn}-${index}`,
      kind: "request",
      label: `${isLast ? "发给模型" : "上下文"} · ${roleLabel}：${preview || "（空）"}`,
      detail: truncateDetail(
        formatJson({
          role: message.role,
          content: message.content,
          ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
        }),
      ),
      ok: true,
    });
  }
  return entries;
}

function responseEntry(turn: AgentRoundGroupView): AgentTraceEntry[] {
  const response = turn.response;
  if (!response) return [];
  const text = response.assistantText?.trim() ?? "";
  const label = response.isFinal
    ? `最终回复（${text.length} 字符）`
    : `轮次回复（${text.length} 字符，将续跑）`;
  return [
    {
      key: `resp-${turn.turn}`,
      kind: "response",
      label: text ? `${label}：${text.replace(/\s+/g, " ").slice(0, 120)}` : `${label}：（空，仅工具调用）`,
      detail: truncateDetail(text || "（本轮无正文，仅工具调用）"),
      ok: true,
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
  }));
}

function phaseEntries(turn: AgentRoundGroupView): AgentTraceEntry[] {
  return turn.modelSteps.map((step, index) => ({
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